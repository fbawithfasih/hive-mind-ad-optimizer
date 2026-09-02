/**
 * The agent worker — the first part of this system that is not inert.
 *
 * Everything upstream (policy, reviewer, guardrails) computes. This reads real
 * reports, writes AgentRun/AgentDecision rows, and — for an action type whose
 * ProfileObjective has graduated to LIVE — adds keywords to a customer's
 * account. In SHADOW, which is the default and where every profile starts,
 * decisions are recorded and nothing is applied.
 *
 * job.data:
 *   { __sweep: true }                     — fan out one job per enabled profile
 *   { orgId, profileId }                  — run the agent for one profile
 *
 * ── Idempotency ──────────────────────────────────────────────────────────────
 *
 * Same shape as automation.worker.js, for the same reason: BullMQ retries, and
 * re-delivers a stalled job when a deploy kills the process mid-run — which
 * these workers share with the API. A run claims (orgId, profileId, slotKey)
 * as a plain insert against a unique index before doing anything, so the
 * database decides the race.
 *
 * The claim is taken before the report is even fetched, which costs a day when
 * a run crashes mid-fetch. That is the right direction to fail in twice over:
 * a missed day is corrected by tomorrow's sweep, whereas a duplicated run adds
 * the same keywords twice AND doubles that day's rows in the evidence base the
 * graduation gate is computed from. Amazon would return DUPLICATE_VALUE for the
 * keywords, but nothing would correct the skewed denominator.
 *
 * ── Why the report window stops short of today ───────────────────────────────
 *
 * The window ends two days before the run, not yesterday. Amazon attributes a
 * sale to the click that earned it, which can be up to 14 days earlier, so the
 * most recent days of any report are still filling in. Ending the window at
 * yesterday would systematically under-count conversions on exactly the newest
 * terms — and every rule that fires on "clicks with no sales" would read that
 * as licence to negate. The bias is entirely in one direction, which is what
 * makes it dangerous rather than merely noisy.
 */

import { UnrecoverableError } from 'bullmq';

import { prisma } from '../db/prisma.js';
import { createLogger } from '../api/utils/logger.js';
import { loadOrgCredential } from '../services/credentials.js';
import { createAdsClient, default as defaultAdsClient } from '../services/amazon-ads.js';
import { decideHarvest } from '../services/agent/harvest-policy.js';
import { reviewCandidates } from '../services/agent/llm-review.js';
import { applyGuardrails } from '../services/agent/guardrails.js';
import { enqueueAgentSweep } from '../services/agent/agent-scheduler.js';

const logger = createLogger('AGENT_WORKER');

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days of history each run asks Amazon for. */
export const LOOKBACK_DAYS = 30;

/**
 * Days between the end of the window and the run.
 *
 * Two, because attribution is still landing on the most recent days. See the
 * module comment — this number is the difference between a policy that judges
 * settled data and one biased toward negation.
 */
export const ATTRIBUTION_BUFFER_DAYS = 2;

/** Same derivation as automation.worker.js: the occurrence, not the clock. */
export function occurrenceDate(job) {
  const scheduled = /^repeat:.*:(\d{10,})$/.exec(String(job?.id ?? ''))?.[1];
  const at = new Date(Number(scheduled) || job?.timestamp || Date.now());
  return Number.isNaN(at.getTime()) ? new Date() : at;
}

export function slotKeyFor(job) {
  return `agent:${occurrenceDate(job).toISOString().slice(0, 10)}`;
}

/**
 * The report window for a run, and the metadata guardrails check it against.
 *
 * @returns {{ startDate: string, endDate: string, dataThroughDate: Date, lookbackDays: number }}
 */
export function reportWindow(occurredAt, lookbackDays = LOOKBACK_DAYS) {
  const end = new Date(occurredAt.getTime() - ATTRIBUTION_BUFFER_DAYS * DAY_MS);
  const start = new Date(end.getTime() - (lookbackDays - 1) * DAY_MS);
  const iso = (d) => d.toISOString().slice(0, 10);
  return {
    startDate: iso(start),
    endDate: iso(end),
    dataThroughDate: new Date(`${iso(end)}T00:00:00.000Z`),
    lookbackDays,
  };
}

/** The objective a profile runs under, with the schema defaults as the fallback. */
export function objectiveFor(record) {
  return {
    targetAcos:            record?.targetAcos ?? 30,
    minClicks:             record?.minClicks ?? 12,
    minPurchasesToPromote: record?.minPurchasesToPromote ?? 2,
    wasteMultiplier:       record?.wasteMultiplier ?? 2,
    brandTerms:            record?.brandTerms ?? [],
  };
}

/** Whether this action type may actually be applied for this profile. */
export function isLive(objective, actionType) {
  return actionType === 'ADD_NEGATIVE'
    ? objective?.negativeMode === 'LIVE'
    : objective?.promotionMode === 'LIVE';
}

/** How many terms each ad group has, so the ad-group cap has something to measure. */
export function adGroupTermCounts(rows = []) {
  const counts = new Map();
  const seen = new Set();
  for (const r of rows) {
    if (r?.adGroupId == null || !r?.searchTerm) continue;
    const key = `${r.adGroupId} ${String(r.searchTerm).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const id = String(r.adGroupId);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/**
 * What it would take to undo this action.
 *
 * Amazon's batch endpoints return results in request order, so a result is
 * matched to its action by index. Defensive about length: a short response
 * leaves the action without an inverse rather than pairing it with the wrong
 * keyword, which would make a revert delete something the agent never added.
 */
export function inverseFor(action, apiResult) {
  const keywordId = apiResult?.keywordId ?? null;
  if (!keywordId) return null;
  return {
    undo: action.actionType === 'ADD_NEGATIVE' ? 'REMOVE_NEGATIVE_KEYWORD' : 'ARCHIVE_KEYWORD',
    keywordId: String(keywordId),
    campaignId: action.campaignId,
    adGroupId: action.adGroupId,
    searchTerm: action.searchTerm,
  };
}

/** Amazon reports an existing keyword as a duplicate, not an error. */
export function outcomeFrom(apiResult) {
  const code = apiResult?.code ?? 'SUCCESS';
  if (code === 'SUCCESS')         return { status: 'APPLIED', outcome: 'SUCCESS' };
  if (code === 'DUPLICATE_VALUE') return { status: 'APPLIED', outcome: 'DUPLICATE' };
  return { status: 'FAILED', outcome: `${code}${apiResult?.details ? `: ${apiResult.details}` : ''}` };
}

/** A candidate, plus its verdict, as an AgentDecision create payload. */
export function decisionRow(runId, orgId, action, { status, appliedAt = null, outcome = null, inverse = null }) {
  return {
    runId,
    orgId,
    actionType:   action.actionType,
    campaignId:   String(action.campaignId),
    adGroupId:    String(action.adGroupId),
    searchTerm:   action.searchTerm,
    matchType:    action.matchType ?? null,
    bid:          action.bid ?? null,
    reason:       action.reason,
    detail:       action.detail ?? null,
    inputs:       action.inputs ?? {},
    llmVerdict:   action.llmVerdict ?? null,
    llmRationale: action.llmRationale ?? null,
    rank:         action.rank ?? null,
    status,
    appliedAt,
    outcome,
    inverse,
  };
}

/**
 * Claim the slot. Returns the run, or null when this slot already ran.
 *
 * A unique-constraint violation is the expected outcome of a retry, not a
 * failure — the run it collides with either already did the work or is doing it.
 */
async function claimRun({ orgId, profileId, slotKey, mode }) {
  try {
    return await prisma.agentRun.create({
      data: { orgId, profileId, slotKey, mode, status: 'RUNNING' },
    });
  } catch (err) {
    if (err?.code === 'P2002') return null;
    throw err;
  }
}

export async function agentProcessor(job) {
  if (job.data?.__sweep) return enqueueAgentSweep();

  const { orgId, profileId } = job.data ?? {};
  if (!orgId || !profileId) {
    throw new UnrecoverableError('agent job requires orgId and profileId');
  }

  const occurredAt = occurrenceDate(job);
  const slotKey = slotKeyFor(job);
  const tag = `org=${orgId} profile=${profileId} ${slotKey}`;

  const objectiveRecord = await prisma.profileObjective.findFirst({ where: { orgId, profileId } });
  if (!objectiveRecord?.enabled) {
    logger.info(`Agent skipped — objective disabled (${tag})`);
    return { skipped: 'DISABLED' };
  }

  // Both action types shadow means the run as a whole writes nothing.
  const runMode = (objectiveRecord.negativeMode === 'LIVE' || objectiveRecord.promotionMode === 'LIVE')
    ? 'LIVE' : 'SHADOW';

  const run = await claimRun({ orgId, profileId, slotKey, mode: runMode });
  if (!run) {
    logger.info(`Agent slot already claimed, skipping (${tag})`);
    return { skipped: 'ALREADY_RAN' };
  }

  const finish = (data) => prisma.agentRun.update({
    where: { id: run.id },
    data: { completedAt: new Date(), ...data },
  });

  try {
    const cred = await loadOrgCredential(orgId);
    if (!cred?.adsClientId) {
      throw new UnrecoverableError(`No Amazon Ads credential for org ${orgId}`);
    }

    const adsClient = createAdsClient({
      clientId:     cred.adsClientId,
      clientSecret: cred.adsClientSecret,
      refreshToken: cred.adsRefreshToken,
      cacheKey:     `ads:${orgId}`,
    }) ?? defaultAdsClient;

    const regions = await prisma.sellerProfile.findMany({
      where: { orgId }, select: { profileId: true, countryCode: true },
    });
    adsClient.setProfileRegions?.(regions);

    const window = reportWindow(occurredAt, LOOKBACK_DAYS);
    logger.info(`Agent run starting — ${tag} window ${window.startDate}→${window.endDate} mode=${runMode}`);

    const rows = await adsClient.getSearchTermReport(profileId, window.startDate, window.endDate);

    const objective = objectiveFor(objectiveRecord);
    const { candidates, stats } = decideHarvest(rows, objective);

    const { kept, vetoed, reviewError } = await reviewCandidates(candidates, {
      ...objective, profileId,
    }, { callModel: job.data?.callModel ?? defaultReviewer });

    const guarded = applyGuardrails(kept, {
      report: window,
      adGroupTermCounts: adGroupTermCounts(rows),
      now: occurredAt,
    });

    const decisions = [];

    for (const action of vetoed) {
      decisions.push(decisionRow(run.id, orgId, action, { status: 'VETOED' }));
    }
    for (const { action } of guarded.blocked) {
      decisions.push(decisionRow(run.id, orgId, action, { status: 'BLOCKED' }));
    }

    if (guarded.aborted) {
      for (const action of kept) {
        decisions.push(decisionRow(run.id, orgId, action, { status: 'PROPOSED' }));
      }
      await prisma.agentDecision.createMany({ data: decisions });
      logger.warn(`Agent run aborted — ${tag}: ${guarded.abortReason} (${guarded.abortDetail})`);
      return finish({
        status: 'ABORTED', abortReason: guarded.abortReason, abortDetail: guarded.abortDetail,
        rowsIn: rows.length, candidates: candidates.length, blocked: guarded.blocked.length,
      });
    }

    const applied = await applyOrRecord({
      actions: guarded.allowed, objectiveRecord, adsClient, profileId, runId: run.id, orgId, decisions,
    });

    await prisma.agentDecision.createMany({ data: decisions });

    logger.info(
      `Agent run complete — ${tag}: ${stats.negatives} negatives, ${stats.promotions} promotions, ` +
      `${vetoed.length} vetoed, ${guarded.blocked.length} blocked, ${applied} applied` +
      (reviewError ? ` (reviewer unavailable: ${reviewError})` : '')
    );

    return finish({
      status: 'COMPLETED',
      rowsIn: rows.length,
      candidates: candidates.length,
      applied,
      blocked: guarded.blocked.length,
    });
  } catch (err) {
    await finish({ status: 'FAILED', error: err.message?.slice(0, 1000) ?? 'unknown error' }).catch(() => {});
    logger.error(`Agent run failed — ${tag}: ${err.message}`);
    throw err;
  }
}

/**
 * Apply the actions whose type has graduated; record the rest as proposals.
 *
 * Negatives and promotions are submitted as two batches because they are two
 * Amazon endpoints, and each is gated independently — a profile can be live on
 * negatives while still shadowing promotions.
 */
async function applyOrRecord({ actions, objectiveRecord, adsClient, profileId, runId, orgId, decisions }) {
  const groups = {
    ADD_NEGATIVE: actions.filter((a) => a.actionType === 'ADD_NEGATIVE'),
    ADD_EXACT:    actions.filter((a) => a.actionType === 'ADD_EXACT'),
  };

  let applied = 0;

  for (const [actionType, group] of Object.entries(groups)) {
    if (group.length === 0) continue;

    if (!isLive(objectiveRecord, actionType)) {
      for (const action of group) {
        decisions.push(decisionRow(runId, orgId, action, { status: 'PROPOSED' }));
      }
      continue;
    }

    const items = group.map((a) => ({
      campaignId:  a.campaignId,
      adGroupId:   a.adGroupId,
      keywordText: a.searchTerm,
      matchType:   a.matchType,
      ...(a.bid ? { bid: a.bid } : {}),
    }));

    let results = [];
    try {
      results = actionType === 'ADD_NEGATIVE'
        ? await adsClient.addNegativeKeywords(profileId, items)
        : await adsClient.addKeywords(profileId, items);
    } catch (err) {
      // The batch failed as a whole. Record every action in it as failed rather
      // than losing the fact that the agent tried.
      for (const action of group) {
        decisions.push(decisionRow(runId, orgId, action, { status: 'FAILED', outcome: err.message?.slice(0, 200) }));
      }
      continue;
    }

    const now = new Date();
    group.forEach((action, i) => {
      const result = Array.isArray(results) ? results[i] : null;
      const { status, outcome } = result ? outcomeFrom(result) : { status: 'FAILED', outcome: 'NO_RESULT' };
      if (status === 'APPLIED') applied += 1;
      decisions.push(decisionRow(runId, orgId, action, {
        status,
        appliedAt: status === 'APPLIED' ? now : null,
        outcome,
        inverse: status === 'APPLIED' ? inverseFor(action, result) : null,
      }));
    });
  }

  return applied;
}

/**
 * The reviewer's model call, kept out of llm-review.js so that module stays
 * pure and testable. Injected by the processor; overridable from job data in
 * tests.
 */
async function defaultReviewer(system, user) {
  const { callModelForReview } = await import('../services/agent/review-model.js');
  return callModelForReview(system, user);
}

export default agentProcessor;
