/**
 * When has an action type earned the right to act on its own?
 *
 * The exit criterion for shadow mode: an agreement rate over a minimum number
 * of reviewed decisions, per action type, computed from the verdicts a human
 * recorded against shadow output.
 *
 * ── Why this is a gate and not a switch ──────────────────────────────────────
 *
 * Being eligible is not the same as being live. This module answers "has it
 * cleared the bar", and a person still decides. Automatic promotion would mean
 * the system that proposes the actions also decides when to stop supervising
 * them, which is the one judgement it should not make about itself.
 *
 * ── What counts ──────────────────────────────────────────────────────────────
 *
 * Only decisions carrying a human verdict. Unreviewed ones are not evidence in
 * either direction, and counting them as agreement would let a reviewer earn
 * autonomy by not reviewing.
 *
 * Ordered newest-first and capped at a window, so a run of early mistakes does
 * not haunt an action type forever once the thresholds have been tuned — and,
 * more importantly, so the rate reflects how the agent behaves now rather than
 * how it behaved on its first week of data.
 */

export const DEFAULT_GATE = {
  /** Reviewed decisions required before a rate means anything. */
  minDecisions: 200,
  /** Share of those that must be AGREE. */
  minRate: 0.95,
  /** Only the most recent this many reviewed decisions count. */
  window: 500,
};

/** Action types that can graduate independently. */
export const GRADUATABLE = ['ADD_NEGATIVE', 'ADD_EXACT'];

/**
 * Agreement over a set of decisions.
 *
 * @param {Array<{humanVerdict: string|null}>} decisions newest first
 * @returns {{ reviewed: number, agreed: number, disagreed: number, rate: number|null }}
 */
export function agreementRate(decisions = [], window = DEFAULT_GATE.window) {
  const reviewed = decisions
    .filter((d) => d?.humanVerdict === 'AGREE' || d?.humanVerdict === 'DISAGREE')
    .slice(0, window);

  const agreed = reviewed.filter((d) => d.humanVerdict === 'AGREE').length;

  return {
    reviewed:   reviewed.length,
    agreed,
    disagreed:  reviewed.length - agreed,
    rate:       reviewed.length > 0 ? agreed / reviewed.length : null,
  };
}

/**
 * Whether one action type has cleared the bar, and what is missing if not.
 *
 * `shortfall` is the point of the return value: "not yet" is far less useful to
 * a reviewer than "42 more decisions" or "the rate is 0.91 against a bar of
 * 0.95". A gate that cannot say what it wants is a gate people route around.
 */
export function graduationStatus(decisions = [], gate = {}) {
  const g = { ...DEFAULT_GATE, ...gate };
  const stats = agreementRate(decisions, g.window);

  const enoughVolume = stats.reviewed >= g.minDecisions;
  const enoughRate   = stats.rate !== null && stats.rate >= g.minRate;

  const shortfall = [];
  if (!enoughVolume) {
    shortfall.push(`${g.minDecisions - stats.reviewed} more reviewed decisions`);
  }
  if (stats.reviewed > 0 && !enoughRate) {
    shortfall.push(`agreement ${(stats.rate * 100).toFixed(1)}% against a bar of ${(g.minRate * 100).toFixed(0)}%`);
  }

  return {
    ...stats,
    eligible: enoughVolume && enoughRate,
    gate: { minDecisions: g.minDecisions, minRate: g.minRate, window: g.window },
    shortfall,
  };
}

/**
 * Group decisions by action type and evaluate each independently.
 *
 * Negatives and promotions are different judgements with different risk — a
 * negative can be removed, a keyword starts spending — so one is allowed to
 * graduate while the other is still watched.
 */
export function graduationByActionType(decisions = [], gate = {}) {
  const out = {};
  for (const actionType of GRADUATABLE) {
    out[actionType] = graduationStatus(
      decisions.filter((d) => d?.actionType === actionType),
      gate,
    );
  }
  return out;
}

export default graduationByActionType;
