/**
 * The last thing between an agent decision and a customer's account.
 *
 * Runs after the policy has decided and after the LLM has reviewed, on the
 * final action set. Deliberately last: the LLM may veto a candidate, but it can
 * never talk its way past these. Anything here that trips either drops the
 * offending action or aborts the whole run.
 *
 * Pure — the caller supplies the campaign state and report metadata. That keeps
 * the rules testable, and it means the same function guards a shadow run and a
 * live one.
 *
 * ── On the spend ceiling ─────────────────────────────────────────────────────
 *
 * "The agent may never raise total daily spend" is the one hard limit set for
 * this system. Worth being honest about what it does today: harvesting adds
 * keywords and negatives, neither of which changes a campaign's daily budget, so
 * every v1 action has a budget delta of exactly zero and the ceiling is
 * trivially satisfied. It is implemented now anyway, and asserted, because the
 * moment budget reallocation arrives in a later phase this is the check that has
 * to already exist and already be trusted — not one written in a hurry
 * alongside the feature it is supposed to restrain.
 *
 * ── On stale data ────────────────────────────────────────────────────────────
 *
 * The Brand Analytics work is the precedent: a sweep asked Amazon for a period
 * it had not published yet, got a confident-looking error, and the wrong
 * conclusion was drawn twice before anyone read the actual reason. Acting on a
 * report that is old, or that covers too few days, produces decisions that look
 * just as reasonable and are just as wrong. A run refuses rather than guesses.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_LIMITS = {
  /** Refuse a report whose data ends more than this many days ago. */
  maxReportAgeDays: 3,
  /** Refuse a report covering fewer than this many days. */
  minLookbackDays: 7,
  /** Most negatives one run may add across the whole profile. */
  maxNegativesPerRun: 50,
  /** Most new keywords one run may add across the whole profile. */
  maxPromotionsPerRun: 25,
  /** Most of a single ad group's terms one run may touch, as a fraction. */
  maxAdGroupTermFraction: 0.25,
  /** Total daily budget across the profile may not rise by more than this. */
  maxBudgetIncrease: 0,
};

/** Actions that change what a campaign is allowed to spend per day. */
const BUDGET_ACTIONS = new Set(['SET_BUDGET', 'INCREASE_BUDGET', 'DECREASE_BUDGET']);

/**
 * How much this action set would move total daily budget.
 *
 * Harvesting actions carry no budget field and contribute zero. Anything that
 * does carry one must state both sides so the delta is computable — an action
 * that changes budget without saying what it changes it from cannot be checked,
 * and is rejected by `checkBudgetDelta` rather than assumed harmless.
 */
export function budgetDelta(actions = []) {
  let delta = 0;
  for (const a of actions) {
    if (!BUDGET_ACTIONS.has(a?.actionType)) continue;
    const from = Number(a?.currentBudget);
    const to   = Number(a?.newBudget);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null; // uncheckable
    delta += to - from;
  }
  return +delta.toFixed(2);
}

/**
 * Is this report fresh enough, and does it cover enough time, to act on?
 *
 * @param {{ dataThroughDate: Date|string, lookbackDays: number }} report
 */
export function checkReportFreshness(report, limits, now = new Date()) {
  const through = report?.dataThroughDate ? new Date(report.dataThroughDate) : null;
  if (!through || Number.isNaN(through.getTime())) {
    return { ok: false, reason: 'REPORT_DATE_UNKNOWN', detail: 'report has no usable data-through date' };
  }

  const ageDays = (now.getTime() - through.getTime()) / DAY_MS;
  if (ageDays > limits.maxReportAgeDays) {
    return {
      ok: false, reason: 'REPORT_STALE',
      detail: `data ends ${ageDays.toFixed(1)} days ago (limit ${limits.maxReportAgeDays})`,
    };
  }

  const lookback = Number(report?.lookbackDays);
  if (!Number.isFinite(lookback) || lookback < limits.minLookbackDays) {
    return {
      ok: false, reason: 'LOOKBACK_TOO_SHORT',
      detail: `report covers ${lookback || 0} days (minimum ${limits.minLookbackDays})`,
    };
  }

  return { ok: true };
}

/** Refuse a set that would raise total daily budget. */
export function checkBudgetDelta(actions, limits) {
  const delta = budgetDelta(actions);
  if (delta === null) {
    return { ok: false, reason: 'BUDGET_DELTA_UNCHECKABLE', detail: 'a budget action did not state its current value' };
  }
  if (delta > limits.maxBudgetIncrease) {
    return {
      ok: false, reason: 'SPEND_CEILING',
      detail: `would raise total daily budget by $${delta.toFixed(2)} (limit $${limits.maxBudgetIncrease})`,
    };
  }
  return { ok: true, delta };
}

/**
 * Apply every guardrail to a final action set.
 *
 * Two kinds of outcome, deliberately distinct:
 *   abort — something is wrong with the run itself (stale data, spend ceiling).
 *           Nothing is applied, including actions that would individually pass.
 *   block — this particular action exceeds a cap. The rest of the run proceeds.
 *
 * A stale report must not partially apply: if the inputs cannot be trusted,
 * neither can any decision drawn from them.
 *
 * @param {Array<object>} actions
 * @param {{ report: object, adGroupTermCounts?: Map<string,number>, limits?: object, now?: Date }} context
 */
export function applyGuardrails(actions = [], context = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(context.limits ?? {}) };
  const now    = context.now ?? new Date();

  const freshness = checkReportFreshness(context.report ?? {}, limits, now);
  if (!freshness.ok) {
    return { aborted: true, abortReason: freshness.reason, abortDetail: freshness.detail, allowed: [], blocked: [] };
  }

  const budget = checkBudgetDelta(actions, limits);
  if (!budget.ok) {
    return { aborted: true, abortReason: budget.reason, abortDetail: budget.detail, allowed: [], blocked: [] };
  }

  const allowed = [];
  const blocked = [];
  const block = (action, reason, detail) => blocked.push({ action, reason, detail });

  const counts = { ADD_NEGATIVE: 0, ADD_EXACT: 0 };
  const perAdGroup = new Map();
  const seen = new Set();

  for (const action of actions) {
    const key = `${action?.actionType} ${action?.adGroupId} ${action?.searchTerm}`;
    if (seen.has(key)) { block(action, 'DUPLICATE_IN_RUN', 'the same action appears twice in this run'); continue; }
    seen.add(key);

    if (action?.actionType === 'ADD_NEGATIVE' && counts.ADD_NEGATIVE >= limits.maxNegativesPerRun) {
      block(action, 'RUN_CAP_NEGATIVES', `run already has ${limits.maxNegativesPerRun} negatives`);
      continue;
    }
    if (action?.actionType === 'ADD_EXACT' && counts.ADD_EXACT >= limits.maxPromotionsPerRun) {
      block(action, 'RUN_CAP_PROMOTIONS', `run already has ${limits.maxPromotionsPerRun} new keywords`);
      continue;
    }

    // Never reshape an ad group in a single run. A policy bug that flags most of
    // an ad group's terms should surface as a blocked batch to look at, not as
    // an ad group quietly negated into silence overnight.
    const total = context.adGroupTermCounts?.get?.(String(action?.adGroupId));
    if (Number.isFinite(total) && total > 0) {
      const used = perAdGroup.get(String(action.adGroupId)) ?? 0;
      const cap  = Math.max(1, Math.floor(total * limits.maxAdGroupTermFraction));
      if (used >= cap) {
        block(action, 'AD_GROUP_CAP', `would touch more than ${Math.round(limits.maxAdGroupTermFraction * 100)}% of this ad group's ${total} terms`);
        continue;
      }
      perAdGroup.set(String(action.adGroupId), used + 1);
    }

    if (action?.actionType in counts) counts[action.actionType] += 1;
    allowed.push(action);
  }

  return { aborted: false, allowed, blocked, budgetDelta: budget.delta };
}

export default applyGuardrails;
