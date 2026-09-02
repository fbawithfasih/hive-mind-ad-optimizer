/**
 * The reviewer — judgment and voice, layered over a policy that owns the numbers.
 *
 * The policy has already decided what is defensible. This step exists for what a
 * threshold cannot see: that "widget for iphone" is a competitor's product line,
 * that a term the numbers call wasteful is a seasonal line about to matter, that
 * of forty defensible negatives these six are the ones worth doing first. It
 * also writes the sentence a human reads when reviewing shadow output, which is
 * what makes the agreement-rate gate reviewable at all.
 *
 * ── The asymmetry that keeps this safe ───────────────────────────────────────
 *
 * A veto is honoured. An approval is not.
 *
 * The model can only ever *remove* from the action set or reorder it. Anything
 * the policy rejected stays rejected, and no field of a surviving candidate can
 * be changed — not the bid, not the term, not the ad group. `mergeReview` reads
 * exactly three things out of the response (verdict, rationale, rank) and takes
 * every other value from the candidate the policy produced.
 *
 * That matters because model output is untrusted input like any other. A
 * hallucinated search term, a bid nudged by a digit, an ad group id that belongs
 * to another campaign — none of those can survive the merge, because none of
 * them are read from it.
 *
 * ── Degradation ──────────────────────────────────────────────────────────────
 *
 * The reviewer is an enhancement, not a dependency. If the model times out,
 * errors, or returns something unparseable, the run continues with the policy's
 * candidates and a null verdict on each. Losing a night's decisions because an
 * API was briefly unavailable would be a worse failure than shipping them
 * unranked — in shadow mode nothing is applied anyway, and in live mode the
 * guardrails still stand between the candidates and the account.
 */

import { createLogger } from '../../api/utils/logger.js';

const logger = createLogger('AGENT_REVIEW');

/** Beyond this, the prompt costs more than the ranking is worth. */
export const MAX_REVIEWED = 150;

/** Rationales are shown in a review table; long ones are the model rambling. */
const MAX_RATIONALE = 300;

export const REVIEW_SYSTEM_PROMPT = `You are a senior Amazon Ads manager reviewing a junior analyst's proposed changes to a Sponsored Products account.

The analyst has already applied the account's numeric rules. Every proposal you see is defensible on the numbers. Your job is the judgment the numbers cannot carry.

For each proposal, decide:
- "veto" if acting would harm the account for a reason the metrics do not show. Legitimate reasons: the term is the seller's own brand or a variant of it; the term is clearly a different product the seller does not sell but which signals a catalogue gap worth keeping visible; the term is seasonal and currently out of season; negating it would cut off a whole product line.
- "approve" otherwise.

Also assign a rank, 1 being the most valuable action to take first.

Rules:
- Respond ONLY with valid JSON, no markdown fences: {"reviews":[{"id":"d1","verdict":"approve","rank":1,"rationale":"..."}]}
- Include every id you were given, exactly once.
- rationale: one sentence, plain English, under 200 characters, explaining the decision to a seller.
- Never invent an id. Never suggest a different search term, bid, campaign or ad group — you are reviewing these proposals, not writing new ones.
- Veto sparingly. The numbers are usually right; you are looking for the exception.`;

/** Stable, opaque handles for the round trip. Index-based — nothing leaks. */
export function withReviewIds(candidates = []) {
  return candidates.map((c, i) => ({ ...c, reviewId: `d${i + 1}` }));
}

/**
 * The user message: the proposals, and the account context needed to judge them.
 *
 * Only the fields a reviewer needs. Sending whole report rows would cost tokens
 * for data the model has no use for.
 */
export function buildReviewPrompt(candidates, context = {}) {
  const proposals = candidates.map((c) => ({
    id:         c.reviewId,
    action:     c.actionType === 'ADD_NEGATIVE' ? 'add negative keyword' : 'add exact keyword',
    searchTerm: c.searchTerm,
    campaign:   c.campaignName ?? c.campaignId,
    adGroup:    c.adGroupName ?? c.adGroupId,
    why:        c.detail,
    metrics:    c.inputs,
    ...(c.bid ? { proposedBid: c.bid } : {}),
  }));

  return JSON.stringify({
    account: {
      targetAcos: context.targetAcos ?? null,
      brandTerms: context.brandTerms ?? [],
      profile:    context.profileName ?? context.profileId ?? null,
    },
    proposals,
  });
}

const VERDICTS = new Set(['approve', 'veto']);

/** Parse a model response into reviews, tolerating fences and stray prose. */
export function parseReviewResponse(text) {
  if (typeof text !== 'string' || !text.trim()) return null;

  const stripped = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();

  let payload;
  try {
    payload = JSON.parse(stripped);
  } catch {
    // Some models wrap JSON in a sentence. Take the outermost object.
    const start = stripped.indexOf('{');
    const end   = stripped.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try { payload = JSON.parse(stripped.slice(start, end + 1)); } catch { return null; }
  }

  const reviews = Array.isArray(payload) ? payload : payload?.reviews;
  return Array.isArray(reviews) ? reviews : null;
}

/**
 * Fold reviews back onto the candidates the policy produced.
 *
 * Reads exactly three fields from each review — verdict, rationale, rank — and
 * matches them by id. Everything else on the returned candidate comes from the
 * policy. An unknown id is dropped; a candidate the model did not mention keeps
 * a null verdict and is treated as un-reviewed, not as vetoed.
 */
export function mergeReview(candidates = [], reviews) {
  if (!Array.isArray(reviews)) {
    return candidates.map((c) => ({ ...c, llmVerdict: null, llmRationale: null, rank: null }));
  }

  const byId = new Map();
  for (const r of reviews) {
    const id = r?.id;
    if (typeof id !== 'string' || byId.has(id)) continue; // first mention wins
    byId.set(id, r);
  }

  return candidates.map((c) => {
    const r = byId.get(c.reviewId);
    if (!r) return { ...c, llmVerdict: null, llmRationale: null, rank: null };

    const verdict = String(r.verdict ?? '').toLowerCase();
    const rank    = Number.isInteger(r.rank) && r.rank > 0 ? r.rank : null;
    const rationale = typeof r.rationale === 'string' && r.rationale.trim()
      ? r.rationale.trim().slice(0, MAX_RATIONALE)
      : null;

    return {
      ...c,
      // Anything that is not a recognised verdict is not a veto. Silence, or a
      // word the model invented, must not remove an action the policy defended.
      llmVerdict:   VERDICTS.has(verdict) ? verdict : null,
      llmRationale: rationale,
      rank,
    };
  });
}

/** Reviewed candidates split into what survives and what the model vetoed. */
export function partitionByVerdict(reviewed = []) {
  const kept   = reviewed.filter((c) => c.llmVerdict !== 'veto');
  const vetoed = reviewed.filter((c) => c.llmVerdict === 'veto');
  // Ranked first, then whatever the model did not rank, in policy order.
  kept.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
  return { kept, vetoed };
}

/**
 * Review a candidate set.
 *
 * @param {Array<object>} candidates  from the policy
 * @param {object} context            targetAcos, brandTerms, profile
 * @param {{ callModel: (system: string, user: string) => Promise<string> }} deps
 * @returns {Promise<{ kept, vetoed, reviewed, reviewError }>}
 */
export async function reviewCandidates(candidates = [], context = {}, deps = {}) {
  const withIds = withReviewIds(candidates);
  if (withIds.length === 0) return { kept: [], vetoed: [], reviewed: [], reviewError: null };

  // Beyond the cap the tail is passed through un-reviewed rather than dropped:
  // the policy already defended it, and an unranked action is still a valid one.
  const toReview = withIds.slice(0, MAX_REVIEWED);
  const overflow = withIds.slice(MAX_REVIEWED)
    .map((c) => ({ ...c, llmVerdict: null, llmRationale: null, rank: null }));

  let reviews = null;
  let reviewError = null;

  try {
    if (typeof deps.callModel !== 'function') throw new Error('no model available');
    const raw = await deps.callModel(REVIEW_SYSTEM_PROMPT, buildReviewPrompt(toReview, context));
    reviews = parseReviewResponse(raw);
    if (reviews === null) reviewError = 'unparseable model response';
  } catch (err) {
    reviewError = err?.message ?? String(err);
  }

  if (reviewError) {
    logger.warn(`Reviewer unavailable, continuing on policy alone: ${reviewError}`);
  }

  const reviewed = [...mergeReview(toReview, reviews), ...overflow];
  return { ...partitionByVerdict(reviewed), reviewed, reviewError };
}

export default reviewCandidates;
