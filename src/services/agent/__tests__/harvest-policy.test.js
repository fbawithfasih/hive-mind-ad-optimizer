/**
 * The policy that decides what the agent does to live ad spend.
 *
 * Everything here is pure, so these tests are the real safety net: in shadow
 * mode a wrong decision is a wrong line in a review queue, but once an action
 * type graduates, a wrong decision is a keyword added to a paying customer's
 * account. The thresholds are asserted at their boundaries, because "12 clicks"
 * is only a meaningful rule if 11 behaves differently.
 */

import {
  decideHarvest, aggregateRows, adGroupAov, promotionBid, isBrandTerm, DEFAULT_OBJECTIVE,
} from '../harvest-policy.js';

/** One report row, with sensible defaults so tests state only what they mean. */
const row = (over = {}) => ({
  campaignId: 'c1', campaignName: 'Camp', adGroupId: 'g1', adGroupName: 'Group',
  matchType: 'BROAD', targeting: 'some keyword', searchTerm: 'blue widget',
  impressions: 500, clicks: 0, cost: 0, purchases14d: 0, sales14d: 0,
  ...over,
});

const only = (result, actionType) => result.candidates.filter(c => c.actionType === actionType);
const reasons = (result) => result.skipped.map(s => s.reason);

describe('aggregating rows before deciding', () => {
  it('sums a term that was matched by more than one target', () => {
    // The bug this prevents: Amazon emits one row per (term × matching target),
    // so a term pulled in by both a broad and a phrase keyword arrives twice.
    // Judged row by row it never reaches the click threshold; judged together it
    // has taken 13 clicks and earned nothing.
    const rows = [
      row({ clicks: 6, cost: 3.00, matchType: 'BROAD',  targeting: 'widget' }),
      row({ clicks: 7, cost: 3.50, matchType: 'PHRASE', targeting: 'blue widget' }),
    ];

    const [term] = aggregateRows(rows);

    expect(term.clicks).toBe(13);
    expect(term.cost).toBeCloseTo(6.5, 2);
    expect(term.rowCount).toBe(2);
  });

  it('negates the split term that per-row logic would have missed', () => {
    const rows = [
      row({ clicks: 6, cost: 3.00, matchType: 'BROAD' }),
      row({ clicks: 7, cost: 3.50, matchType: 'PHRASE' }),
    ];

    expect(only(decideHarvest(rows), 'ADD_NEGATIVE')).toHaveLength(1);
  });

  it('keeps the same term in different ad groups separate', () => {
    // A negative is added at ad-group level, so these are genuinely two
    // different decisions and must not be merged.
    const rows = [
      row({ adGroupId: 'g1', clicks: 20 }),
      row({ adGroupId: 'g2', clicks: 20 }),
    ];

    expect(aggregateRows(rows)).toHaveLength(2);
    expect(only(decideHarvest(rows), 'ADD_NEGATIVE')).toHaveLength(2);
  });

  it('treats casing and padding as the same term', () => {
    const rows = [row({ searchTerm: 'Blue Widget', clicks: 6 }), row({ searchTerm: ' blue  widget ', clicks: 7 })];

    expect(aggregateRows(rows)).toHaveLength(1);
  });

  it('drops rows with no search term or no ad group', () => {
    const rows = [row({ searchTerm: '' }), row({ searchTerm: null }), row({ adGroupId: null })];

    expect(aggregateRows(rows)).toEqual([]);
  });

  it('computes ACoS as a percentage, and null without sales', () => {
    const [withSales] = aggregateRows([row({ clicks: 10, cost: 25, purchases14d: 2, sales14d: 100 })]);
    const [without]   = aggregateRows([row({ clicks: 10, cost: 25 })]);

    expect(withSales.acos).toBeCloseTo(25, 5);
    expect(without.acos).toBeNull();
  });
});

describe('negating a term that does not convert', () => {
  it('negates once clicks reach the threshold with no sales', () => {
    const result = decideHarvest([row({ clicks: 12, cost: 6 })]);

    const [c] = only(result, 'ADD_NEGATIVE');
    expect(c.reason).toBe('NO_CONVERSION');
    expect(c.matchType).toBe('negativeExact');
    expect(c.searchTerm).toBe('blue widget');
  });

  it('holds off one click below the threshold', () => {
    // The boundary is the point of the rule. Negating on thin data is the
    // classic harvesting mistake, and purchases14d is a 14-day attribution
    // window, so a term that looks dead today may be credited tomorrow.
    const result = decideHarvest([row({ clicks: 11, cost: 5.5 })]);

    expect(only(result, 'ADD_NEGATIVE')).toHaveLength(0);
    expect(reasons(result)).toContain('INSUFFICIENT_CLICKS');
  });

  it('respects a profile that has set its own threshold', () => {
    const result = decideHarvest([row({ clicks: 5, cost: 2 })], { minClicks: 5 });

    expect(only(result, 'ADD_NEGATIVE')).toHaveLength(1);
  });

  it('never negates a term that has converted', () => {
    const result = decideHarvest([row({ clicks: 50, cost: 40, purchases14d: 1, sales14d: 30 })]);

    expect(only(result, 'ADD_NEGATIVE')).toHaveLength(0);
  });
});

describe('negating a term on wasted spend', () => {
  // A term can burn real money on few clicks if the CPC is high. Clicks alone
  // would let that run.
  const converting = row({ searchTerm: 'converting term', clicks: 10, cost: 20, purchases14d: 2, sales14d: 100 });

  it('negates below the click threshold when spend passes 2x target CPA', () => {
    // AOV 50, target 30% → CPA 15. Waste multiplier 2 → 30.
    const waster = row({ searchTerm: 'expensive dud', clicks: 4, cost: 31 });

    const result = decideHarvest([converting, waster], { targetAcos: 30 });

    const [c] = only(result, 'ADD_NEGATIVE');
    expect(c.searchTerm).toBe('expensive dud');
    expect(c.reason).toBe('WASTED_SPEND');
  });

  it('leaves it alone just under the spend bar', () => {
    const waster = row({ searchTerm: 'expensive dud', clicks: 4, cost: 29 });

    expect(only(decideHarvest([converting, waster], { targetAcos: 30 }), 'ADD_NEGATIVE')).toHaveLength(0);
  });

  it('skips the spend rule entirely when the ad group has no sales to price from', () => {
    // With no AOV there is no defensible CPA. Guessing one would mean negating
    // on a number nobody can justify.
    const result = decideHarvest([row({ clicks: 3, cost: 500 })]);

    expect(only(result, 'ADD_NEGATIVE')).toHaveLength(0);
    expect(reasons(result)).toContain('INSUFFICIENT_CLICKS');
  });

  it('prices CPA from the term\'s own ad group, not the account', () => {
    const richGroup = row({ adGroupId: 'rich', searchTerm: 'a', clicks: 5, cost: 10, purchases14d: 1, sales14d: 500 });
    const leanGroup = row({ adGroupId: 'lean', searchTerm: 'b', clicks: 5, cost: 10, purchases14d: 1, sales14d: 20 });
    const dudInLean = row({ adGroupId: 'lean', searchTerm: 'dud', clicks: 2, cost: 13 });

    const result = decideHarvest([richGroup, leanGroup, dudInLean], { targetAcos: 30 });

    // lean AOV 20 → CPA 6 → bar 12. $13 clears it. Against the rich group's
    // AOV it would not have.
    expect(only(result, 'ADD_NEGATIVE').map(c => c.searchTerm)).toEqual(['dud']);
  });
});

describe('brand terms', () => {
  it('never negates a branded term, however badly it performs', () => {
    const result = decideHarvest([row({ searchTerm: 'hive mind widget', clicks: 200, cost: 400 })],
      { brandTerms: ['hive mind'] });

    expect(only(result, 'ADD_NEGATIVE')).toHaveLength(0);
    expect(reasons(result)).toContain('BRAND_TERM');
  });

  it('matches whole words, not substrings', () => {
    // A brand called "ase" must not make "case" branded.
    expect(isBrandTerm('phone case', ['ase'])).toBe(false);
    expect(isBrandTerm('ase phone', ['ase'])).toBe(true);
  });

  it('handles a multi-word brand', () => {
    expect(isBrandTerm('buy hive mind widget', ['hive mind'])).toBe(true);
    expect(isBrandTerm('hive widget', ['hive mind'])).toBe(false);
  });

  it('is not confused by regex characters in a brand name', () => {
    expect(() => isBrandTerm('a+b widget', ['a+b'])).not.toThrow();
    expect(isBrandTerm('a+b widget', ['a+b'])).toBe(true);
  });

  it('ignores empty entries in the brand list', () => {
    expect(isBrandTerm('blue widget', ['', '   '])).toBe(false);
  });
});

describe('promoting a term that converts', () => {
  const winner = row({ clicks: 20, cost: 20, purchases14d: 4, sales14d: 100 }); // 20% ACoS

  it('promotes a term converting under the target', () => {
    const result = decideHarvest([winner], { targetAcos: 30 });

    const [c] = only(result, 'ADD_EXACT');
    expect(c.reason).toBe('CONVERTS_AT_TARGET');
    expect(c.matchType).toBe('exact');
  });

  it('does not promote above the target ACoS', () => {
    const result = decideHarvest([winner], { targetAcos: 15 });

    expect(only(result, 'ADD_EXACT')).toHaveLength(0);
    expect(reasons(result)).toContain('ABOVE_TARGET_ACOS');
  });

  it('promotes exactly at the target', () => {
    expect(only(decideHarvest([winner], { targetAcos: 20 }), 'ADD_EXACT')).toHaveLength(1);
  });

  it('waits for enough sales to be worth a keyword', () => {
    const oneSale = row({ clicks: 10, cost: 5, purchases14d: 1, sales14d: 50 });

    const result = decideHarvest([oneSale], { targetAcos: 30 });

    expect(only(result, 'ADD_EXACT')).toHaveLength(0);
    expect(reasons(result)).toContain('TOO_FEW_SALES');
  });

  it('never promotes a term that is already an exact keyword', () => {
    // Otherwise the agent proposes the same keyword every single day.
    const already = row({ matchType: 'EXACT', targeting: 'blue widget',
      clicks: 20, cost: 20, purchases14d: 4, sales14d: 100 });

    const result = decideHarvest([already], { targetAcos: 30 });

    expect(result.candidates).toHaveLength(0);
    expect(reasons(result)).toContain('ALREADY_EXACT');
  });

  it('never negates a term that is already an exact keyword either', () => {
    const already = row({ matchType: 'EXACT', targeting: 'blue widget', clicks: 40, cost: 30 });

    expect(decideHarvest([already]).candidates).toHaveLength(0);
  });

  it('recognises the exact keyword even when a broad row appears first', () => {
    const rows = [
      row({ matchType: 'BROAD', targeting: 'widget',      clicks: 5,  cost: 4 }),
      row({ matchType: 'EXACT', targeting: 'blue widget', clicks: 30, cost: 20 }),
    ];

    expect(aggregateRows(rows)[0].alreadyExact).toBe(true);
    expect(decideHarvest(rows).candidates).toHaveLength(0);
  });
});

describe('the opening bid for a promoted term', () => {
  it('never bids above what a click can be worth at target', () => {
    // 100 sales / 20 clicks = $5 revenue per click. At 30% target a click is
    // worth at most $1.50 — bidding the $4 it currently costs would guarantee
    // the new keyword misses target from its first impression.
    const pricey = { clicks: 20, cost: 80, sales: 100, cpc: 4 };

    expect(promotionBid(pricey, 30)).toBeCloseTo(1.5, 2);
  });

  it('does not bid up a term that is already winning clicks cheaply', () => {
    const cheap = { clicks: 20, cost: 10, sales: 100, cpc: 0.5 };

    // Worth up to $1.50, but $0.50 already wins the click.
    expect(promotionBid(cheap, 30)).toBeCloseTo(0.5, 2);
  });

  it('floors at Amazon\'s minimum bid', () => {
    const tiny = { clicks: 100, cost: 1, sales: 2, cpc: 0.01 };

    expect(promotionBid(tiny, 10)).toBe(0.02);
  });

  it('returns null rather than a nonsense bid when there is nothing to price from', () => {
    expect(promotionBid({ clicks: 0, cost: 0, sales: 0, cpc: 0 }, 30)).toBeNull();
  });

  it('attaches a usable bid to every promotion candidate', () => {
    const result = decideHarvest([row({ clicks: 20, cost: 20, purchases14d: 4, sales14d: 100 })], { targetAcos: 30 });

    for (const c of only(result, 'ADD_EXACT')) {
      expect(c.bid).toBeGreaterThanOrEqual(0.02);
      expect(Number.isFinite(c.bid)).toBe(true);
    }
  });
});

describe('what the policy reports back', () => {
  it('explains every term it passed over', () => {
    // In shadow mode this is how "saw nothing" is told apart from "saw plenty
    // and held off" — the difference between a broken policy and a cautious one.
    const result = decideHarvest([
      row({ searchTerm: 'thin data', clicks: 2, cost: 1 }),
      row({ searchTerm: 'no clicks', clicks: 0 }),
    ]);

    expect(result.skipped).toHaveLength(2);
    expect(reasons(result)).toEqual(expect.arrayContaining(['INSUFFICIENT_CLICKS', 'NO_CLICKS']));
  });

  it('carries the inputs behind each decision', () => {
    // A reviewer has to be able to check the agent's arithmetic without going
    // back to the report.
    const result = decideHarvest([row({ clicks: 20, cost: 20, purchases14d: 4, sales14d: 100 })], { targetAcos: 30 });

    expect(result.candidates[0].inputs).toEqual({
      impressions: 500, clicks: 20, cost: 20, purchases: 4, sales: 100, acos: 20, cpc: 1,
    });
  });

  it('counts what it did', () => {
    const result = decideHarvest([
      row({ searchTerm: 'dud',    clicks: 30, cost: 20 }),
      row({ searchTerm: 'winner', clicks: 20, cost: 20, purchases14d: 4, sales14d: 100 }),
      row({ searchTerm: 'quiet',  clicks: 1,  cost: 1 }),
    ], { targetAcos: 30 });

    expect(result.stats).toMatchObject({ rowsIn: 3, termsAfterAggregation: 3, negatives: 1, promotions: 1, skipped: 1 });
  });

  it('returns empty structures for an empty report rather than throwing', () => {
    expect(decideHarvest([])).toMatchObject({ candidates: [], skipped: [] });
    expect(decideHarvest()).toMatchObject({ candidates: [], skipped: [] });
  });

  it('survives malformed rows', () => {
    // Report payloads have surprised this codebase before.
    const junk = [null, undefined, {}, { searchTerm: 'x' }, { campaignId: 1, adGroupId: 1, searchTerm: 'y', clicks: 'lots' }];

    expect(() => decideHarvest(junk)).not.toThrow();
  });

  it('never emits both a negation and a promotion for the same term', () => {
    // The two rules are mutually exclusive by construction (zero sales vs. two
    // or more), and must stay that way.
    const rows = Array.from({ length: 40 }, (_, i) => row({
      searchTerm: `term ${i}`, clicks: i, cost: i * 0.8,
      purchases14d: i % 3, sales14d: (i % 3) * 40,
    }));

    const seen = new Map();
    for (const c of decideHarvest(rows, { targetAcos: 30 }).candidates) {
      const key = `${c.adGroupId} ${c.searchTerm}`;
      expect(seen.has(key)).toBe(false);
      seen.set(key, c.actionType);
    }
  });
});

describe('the default objective', () => {
  it('is conservative about negation out of the box', () => {
    expect(DEFAULT_OBJECTIVE.minClicks).toBeGreaterThanOrEqual(10);
    expect(DEFAULT_OBJECTIVE.minPurchasesToPromote).toBeGreaterThanOrEqual(2);
  });

  it('negates nothing at all on a report where every term is thin', () => {
    const rows = Array.from({ length: 50 }, (_, i) => row({ searchTerm: `t${i}`, clicks: 3, cost: 1.2 }));

    expect(decideHarvest(rows).candidates).toHaveLength(0);
  });
});
