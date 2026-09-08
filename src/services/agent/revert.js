/**
 * Undoing what the agent did.
 *
 * A LIVE run adds keywords to a real account. Every action it applied stored
 * an `inverse` — the keyword id that would take it back — and until now
 * nothing could execute one, so the agent's worst day was permanent by
 * omission. This is the verb for that data.
 *
 * Two things make this narrower than it sounds.
 *
 * Archiving is terminal at Amazon. There is no un-revert; a reverted keyword
 * can only be recreated, losing its history. So a revert is offered as a
 * deliberate act, never inferred, and never applied in bulk to anything the
 * operator did not name.
 *
 * And a revert must only ever touch keywords this system created. A decision
 * qualifies on three counts, all of them necessary: it was APPLIED, it has an
 * inverse, and its outcome was not DUPLICATE. That last one is the trap —
 * Amazon answers DUPLICATE_VALUE when the keyword was already there, which
 * means the seller put it there. Archiving it would be this system deleting a
 * customer's own work on the strength of a coincidence. Decisions written
 * before that was understood may still carry an inverse, so the check lives
 * here rather than resting on what the writer did.
 */

/** Undo verb → the client method that performs it. */
const UNDO_METHOD = {
  REMOVE_NEGATIVE_KEYWORD: 'archiveNegativeKeyword',
  ARCHIVE_KEYWORD:         'archiveKeyword',
};

/**
 * Can this decision be taken back?
 *
 * @returns {string|null} null when it can, otherwise why it cannot — phrased
 *   for an operator, because it is the body of a 4xx.
 */
export function revertBlocker(decision) {
  if (!decision) return 'Decision not found';
  if (decision.status === 'REVERTED') return 'Already reverted';
  if (decision.status !== 'APPLIED') {
    return `Only an applied decision can be reverted; this one is ${decision.status}`;
  }
  if (decision.outcome === 'DUPLICATE') {
    return 'This keyword already existed before the agent proposed it, so the agent did not create it';
  }
  const inverse = decision.inverse ?? null;
  if (!inverse?.keywordId) return 'No recorded inverse — nothing to undo';
  if (!UNDO_METHOD[inverse.undo]) return `Unrecognised undo verb: ${inverse.undo}`;
  return null;
}

/** The revertable subset of a run's decisions, in a stable order. */
export function revertable(decisions = []) {
  return decisions.filter((d) => revertBlocker(d) === null);
}

/**
 * Map an archive result onto a decision outcome.
 *
 * NOT_FOUND counts as success. The keyword is gone, which is what was asked
 * for; a retry after a half-finished bulk revert must not read as failure.
 */
export function outcomeFromArchive(apiResult) {
  const code = apiResult?.code ?? 'SUCCESS';
  if (code === 'SUCCESS')   return { status: 'REVERTED', outcome: 'REVERTED' };
  if (code === 'NOT_FOUND') return { status: 'REVERTED', outcome: 'REVERTED_ALREADY_GONE' };
  return {
    status:  'APPLIED',
    outcome: `REVERT_FAILED: ${code}${apiResult?.details ? ` ${apiResult.details}` : ''}`.slice(0, 200),
  };
}

/**
 * Archive one decision's keyword.
 *
 * Sequential by design at the call site: 75 is the run cap, an archive is one
 * small request, and a half-applied revert is far easier to reason about when
 * the order it happened in is the order it was asked for.
 */
export async function revertOne(decision, { adsClient, profileId }) {
  const method = UNDO_METHOD[decision.inverse.undo];
  try {
    const result = await adsClient[method](profileId, decision.inverse.keywordId);
    return outcomeFromArchive(result);
  } catch (err) {
    return { status: 'APPLIED', outcome: `REVERT_FAILED: ${err.message ?? 'unknown'}`.slice(0, 200) };
  }
}

export default revertOne;
