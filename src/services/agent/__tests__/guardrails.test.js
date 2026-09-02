/**
 * The guardrails, which run last and cannot be argued with.
 *
 * The policy decides and the LLM reviews, but neither can talk its way past
 * these. The distinction asserted throughout is abort vs block: a bad *run*
 * (stale data, spend ceiling) applies nothing at all, while a single action
 * over a cap is dropped and the rest proceeds. Partially applying a run drawn
 * from untrustworthy inputs is the failure mode worth preventing.
 */

import {
  applyGuardrails, checkReportFreshness, checkBudgetDelta, budgetDelta, DEFAULT_LIMITS,
} from '../guardrails.js';

const NOW = new Date('2026-09-02T00:00:00Z');

/** A report that passes freshness, so tests state only what they mean. */
const freshReport = (over = {}) => ({
  dataThroughDate: new Date('2026-09-01T00:00:00Z'),
  lookbackDays: 30,
  ...over,
});

const negative = (over = {}) => ({
  actionType: 'ADD_NEGATIVE', campaignId: 'c1', adGroupId: 'g1', searchTerm: 'dud term', ...over,
});
const promotion = (over = {}) => ({
  actionType: 'ADD_EXACT', campaignId: 'c1', adGroupId: 'g1', searchTerm: 'good term', bid: 0.8, ...over,
});

const run = (actions, context = {}) =>
  applyGuardrails(actions, { report: freshReport(), now: NOW, ...context });

describe('refusing to act on data that cannot be trusted', () => {
  it('aborts on a report whose data ends too long ago', () => {
    const result = run([negative()], { report: freshReport({ dataThroughDate: new Date('2026-08-20T00:00:00Z') }) });

    expect(result.aborted).toBe(true);
    expect(result.abortReason).toBe('REPORT_STALE');
  });

  it('applies nothing at all when it aborts, not even valid actions', () => {
    // The whole point. A decision drawn from untrustworthy inputs is not made
    // trustworthy by being individually well-formed.
    const result = run([negative(), promotion()], {
      report: freshReport({ dataThroughDate: new Date('2026-08-01T00:00:00Z') }),
    });

    expect(result.allowed).toEqual([]);
    expect(result.blocked).toEqual([]);
  });

  it('accepts a report from within the freshness window', () => {
    expect(run([negative()]).aborted).toBe(false);
  });

  it('aborts on a lookback too short to mean anything', () => {
    // Three days of search-term data will show almost every term with zero
    // sales, which would read as a licence to negate the account.
    const result = run([negative()], { report: freshReport({ lookbackDays: 3 }) });

    expect(result.aborted).toBe(true);
    expect(result.abortReason).toBe('LOOKBACK_TOO_SHORT');
  });

  it('aborts when the report cannot say how current it is', () => {
    for (const bad of [undefined, null, 'not a date']) {
      expect(run([negative()], { report: freshReport({ dataThroughDate: bad }) }).abortReason)
        .toBe('REPORT_DATE_UNKNOWN');
    }
  });

  it('reports the actual age in the detail, so the log explains itself', () => {
    const result = checkReportFreshness(
      freshReport({ dataThroughDate: new Date('2026-08-25T00:00:00Z') }), DEFAULT_LIMITS, NOW);

    expect(result.detail).toMatch(/8\.0 days/);
  });
});

describe('the spend ceiling', () => {
  it('lets harvesting through, because it moves no budget', () => {
    // Being precise about what this guardrail does today: adding keywords and
    // negatives never changes a campaign's daily budget, so v1 satisfies the
    // ceiling by construction.
    expect(budgetDelta([negative(), promotion()])).toBe(0);
    expect(run([negative(), promotion()]).aborted).toBe(false);
  });

  it('aborts a run that would raise total daily budget', () => {
    const raise = { actionType: 'SET_BUDGET', campaignId: 'c1', currentBudget: 50, newBudget: 60 };

    const result = run([raise]);

    expect(result.aborted).toBe(true);
    expect(result.abortReason).toBe('SPEND_CEILING');
  });

  it('permits a reallocation that nets to zero', () => {
    const down = { actionType: 'SET_BUDGET', campaignId: 'c1', currentBudget: 50, newBudget: 40 };
    const up   = { actionType: 'SET_BUDGET', campaignId: 'c2', currentBudget: 30, newBudget: 40 };

    expect(run([down, up]).aborted).toBe(false);
  });

  it('permits a net decrease', () => {
    const down = { actionType: 'SET_BUDGET', campaignId: 'c1', currentBudget: 50, newBudget: 20 };

    expect(run([down]).aborted).toBe(false);
  });

  it('refuses a budget action that does not say what it is changing from', () => {
    // An unstated current value makes the delta uncomputable. Treating that as
    // harmless is how a ceiling gets bypassed without anyone noticing.
    const vague = { actionType: 'SET_BUDGET', campaignId: 'c1', newBudget: 60 };

    expect(budgetDelta([vague])).toBeNull();
    expect(run([vague]).abortReason).toBe('BUDGET_DELTA_UNCHECKABLE');
  });

  it('respects a ceiling raised deliberately', () => {
    const raise = { actionType: 'SET_BUDGET', campaignId: 'c1', currentBudget: 50, newBudget: 55 };

    expect(checkBudgetDelta([raise], { ...DEFAULT_LIMITS, maxBudgetIncrease: 10 }).ok).toBe(true);
  });
});

describe('per-run caps', () => {
  it('blocks negatives past the cap but keeps the ones under it', () => {
    const actions = Array.from({ length: 5 }, (_, i) => negative({ searchTerm: `dud ${i}` }));

    const result = run(actions, { limits: { maxNegativesPerRun: 3 } });

    expect(result.aborted).toBe(false);
    expect(result.allowed).toHaveLength(3);
    expect(result.blocked.map(b => b.reason)).toEqual(['RUN_CAP_NEGATIVES', 'RUN_CAP_NEGATIVES']);
  });

  it('counts negatives and promotions against separate caps', () => {
    const actions = [
      ...Array.from({ length: 3 }, (_, i) => negative({ searchTerm: `dud ${i}` })),
      ...Array.from({ length: 3 }, (_, i) => promotion({ searchTerm: `good ${i}` })),
    ];

    const result = run(actions, { limits: { maxNegativesPerRun: 2, maxPromotionsPerRun: 3 } });

    expect(result.allowed.filter(a => a.actionType === 'ADD_NEGATIVE')).toHaveLength(2);
    expect(result.allowed.filter(a => a.actionType === 'ADD_EXACT')).toHaveLength(3);
  });

  it('does not abort the run just because a cap was reached', () => {
    const actions = Array.from({ length: 200 }, (_, i) => negative({ searchTerm: `dud ${i}` }));

    const result = run(actions);

    expect(result.aborted).toBe(false);
    expect(result.allowed).toHaveLength(DEFAULT_LIMITS.maxNegativesPerRun);
  });
});

describe('not reshaping an ad group in one night', () => {
  const counts = new Map([['g1', 20]]);

  it('stops after a quarter of the ad group\'s terms', () => {
    // A policy bug that flags most of an ad group should surface as a blocked
    // batch to look at, not as an ad group quietly negated into silence.
    const actions = Array.from({ length: 12 }, (_, i) => negative({ searchTerm: `dud ${i}` }));

    const result = run(actions, { adGroupTermCounts: counts });

    expect(result.allowed).toHaveLength(5); // floor(20 * 0.25)
    expect(result.blocked[0].reason).toBe('AD_GROUP_CAP');
  });

  it('caps each ad group independently', () => {
    const actions = [
      ...Array.from({ length: 8 }, (_, i) => negative({ adGroupId: 'g1', searchTerm: `a${i}` })),
      ...Array.from({ length: 8 }, (_, i) => negative({ adGroupId: 'g2', searchTerm: `b${i}` })),
    ];

    const result = run(actions, { adGroupTermCounts: new Map([['g1', 20], ['g2', 40]]) });

    expect(result.allowed.filter(a => a.adGroupId === 'g1')).toHaveLength(5);
    expect(result.allowed.filter(a => a.adGroupId === 'g2')).toHaveLength(8);
  });

  it('always allows at least one action in a tiny ad group', () => {
    // floor(3 * 0.25) is 0, which would make small ad groups permanently
    // untouchable rather than merely protected.
    const result = run([negative()], { adGroupTermCounts: new Map([['g1', 3]]) });

    expect(result.allowed).toHaveLength(1);
  });

  it('skips the cap when the ad group size is unknown', () => {
    const actions = Array.from({ length: 10 }, (_, i) => negative({ searchTerm: `dud ${i}` }));

    expect(run(actions, { adGroupTermCounts: new Map() }).allowed).toHaveLength(10);
  });
});

describe('duplicates within a run', () => {
  it('drops a repeated action', () => {
    const result = run([negative(), negative()]);

    expect(result.allowed).toHaveLength(1);
    expect(result.blocked[0].reason).toBe('DUPLICATE_IN_RUN');
  });

  it('does not confuse a negation and a promotion of the same term', () => {
    // Different action types on one term are not duplicates. The policy will
    // not produce both, but the guardrail must not be the thing that assumes it.
    const result = run([negative({ searchTerm: 'x' }), promotion({ searchTerm: 'x' })]);

    expect(result.allowed).toHaveLength(2);
  });

  it('does not confuse the same term in different ad groups', () => {
    const result = run([negative({ adGroupId: 'g1' }), negative({ adGroupId: 'g2' })]);

    expect(result.allowed).toHaveLength(2);
  });
});

describe('edges', () => {
  it('handles an empty action set on a good report', () => {
    expect(run([])).toMatchObject({ aborted: false, allowed: [], blocked: [] });
  });

  it('still checks the report even with nothing to do', () => {
    // Otherwise an empty run would silently "succeed" on stale data and the
    // staleness would never be surfaced.
    expect(run([], { report: freshReport({ lookbackDays: 1 }) }).aborted).toBe(true);
  });

  it('does not throw on malformed actions', () => {
    expect(() => run([null, undefined, {}, { actionType: 'UNKNOWN' }])).not.toThrow();
  });

  it('lets an unrecognised action type through to be handled downstream', () => {
    // Guardrails bound known risks; they are not an allow-list. The applier is
    // what refuses to execute something it does not understand.
    const result = run([{ actionType: 'SOMETHING_NEW', adGroupId: 'g1', searchTerm: 't' }]);

    expect(result.allowed).toHaveLength(1);
  });
});
