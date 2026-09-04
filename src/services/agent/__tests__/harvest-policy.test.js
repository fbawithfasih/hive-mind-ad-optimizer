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
  minClicksFor, observedCvr, decisionKey, isAsinTerm,
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

    expect(only(decideHarvest(rows, { minClicks: 12 }), 'ADD_NEGATIVE')).toHaveLength(1);
  });

  it('keeps the same term in different ad groups separate', () => {
    // A negative is added at ad-group level, so these are genuinely two
    // different decisions and must not be merged.
    const rows = [
      row({ adGroupId: 'g1', clicks: 20 }),
      row({ adGroupId: 'g2', clicks: 20 }),
    ];

    expect(aggregateRows(rows)).toHaveLength(2);
    expect(only(decideHarvest(rows, { minClicks: 12 }), 'ADD_NEGATIVE')).toHaveLength(2);
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
    const result = decideHarvest([row({ clicks: 12, cost: 6 })], { minClicks: 12 });

    const [c] = only(result, 'ADD_NEGATIVE');
    expect(c.reason).toBe('NO_CONVERSION');
    expect(c.matchType).toBe('negativeExact');
    expect(c.searchTerm).toBe('blue widget');
  });

  it('holds off one click below the threshold', () => {
    // The boundary is the point of the rule. Negating on thin data is the
    // classic harvesting mistake, and purchases14d is a 14-day attribution
    // window, so a term that looks dead today may be credited tomorrow.
    const result = decideHarvest([row({ clicks: 11, cost: 5.5 })], { minClicks: 12 });

    expect(only(result, 'ADD_NEGATIVE')).toHaveLength(0);
    expect(reasons(result)).toContain('INSUFFICIENT_CLICKS');
  });

  it('respects a profile that has set its own threshold', () => {
    const result = decideHarvest([row({ clicks: 5, cost: 2 })], { minClicks: 5 });

    expect(only(result, 'ADD_NEGATIVE')).toHaveLength(1);
  });

  it('never negates a term that has converted', () => {
    const result = decideHarvest([row({ clicks: 50, cost: 40, purchases14d: 1, sales14d: 30 })], { minClicks: 12 });

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
      { brandTerms: ['hive mind'], minClicks: 12 });

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

    expect(decideHarvest([already], { minClicks: 12 }).candidates).toHaveLength(0);
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
    ], { targetAcos: 30, minClicks: 12 });

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

describe('ASIN search terms, which no keyword can express', () => {
  // Every one of these reached a review queue in production on 2026-09-04.
  const REAL = ['b0926qf71k', 'b003pbhghg', 'b0gfgx7529'];

  it.each(REAL)('recognises %s as an ASIN', (asin) => {
    expect(isAsinTerm(asin)).toBe(true);
  });

  it('is not fooled by a query that merely starts with b0', () => {
    expect(isAsinTerm('b0 something')).toBe(false);
    expect(isAsinTerm('b0926qf71')).toBe(false);   // nine characters
    expect(isAsinTerm('b0926qf71kk')).toBe(false); // eleven
  });

  it('leaves a ten-digit ISBN alone, because a bare number is a plausible query', () => {
    // Skipping a real query is the worse failure of the two: it silently
    // removes a term the account could have harvested, and nothing reports it.
    expect(isAsinTerm('0306406152')).toBe(false);
  });

  it('does not promote a converting ASIN as an exact keyword', () => {
    // b0926qf71k: 284 clicks, 6 sales, 27.3% ACoS — the strongest-looking row
    // in the queue, and an exact keyword for it would match almost nobody.
    const result = decideHarvest([row({
      searchTerm: 'b0926qf71k', impressions: 38791, clicks: 284, cost: 34.40,
      purchases14d: 6, sales14d: 125.94,
    })], { targetAcos: 30 });

    expect(only(result, 'ADD_EXACT')).toHaveLength(0);
    expect(reasons(result)).toContain('ASIN_TARGET');
  });

  it('does not negate a wasteful ASIN either', () => {
    // The costlier half of the bug: a negative keyword does not block a product
    // placement, so the spend survives the decision — and decisionKey then
    // suppresses the term for 90 days.
    const result = decideHarvest([row({
      searchTerm: 'b003pbhghg', clicks: 60, cost: 45,
    })], { minClicks: 12 });

    expect(only(result, 'ADD_NEGATIVE')).toHaveLength(0);
    expect(reasons(result)).toContain('ASIN_TARGET');
  });

  it('still judges the ordinary queries in the same report', () => {
    const result = decideHarvest([
      row({ searchTerm: 'b0926qf71k', clicks: 284, cost: 34.40, purchases14d: 6, sales14d: 125.94 }),
      row({ searchTerm: 'salt cellar', clicks: 44, cost: 29.55, purchases14d: 6, sales14d: 102.74 }),
    ], { targetAcos: 30 });

    const promoted = only(result, 'ADD_EXACT');
    expect(promoted).toHaveLength(1);
    expect(promoted[0].searchTerm).toBe('salt cellar');
  });
});

describe('the click floor under a promotion', () => {
  // Every one of these shapes reached Queenza's review queue. purchases14d
  // counts orders and sales14d revenue, so one click really can carry three
  // units bought over the following fortnight — the rows are real, and
  // unmeasured, which is a different complaint.
  it('does not promote a term with one click and two attributed orders', () => {
    const result = decideHarvest([row({
      searchTerm: 'small salt container with spoon',
      clicks: 1, cost: 1.97, purchases14d: 2, sales14d: 33.00,
    })], { targetAcos: 30 });

    expect(only(result, 'ADD_EXACT')).toHaveLength(0);
    expect(reasons(result)).toContain('TOO_FEW_CLICKS_TO_PROMOTE');
  });

  it('promotes at the floor exactly', () => {
    // The boundary is the rule. Five behaves differently from four or it is
    // not a threshold, it is a mood.
    const at = decideHarvest([row({ clicks: 5, cost: 2.18, purchases14d: 2, sales14d: 39.98 })],
      { targetAcos: 30 });
    expect(only(at, 'ADD_EXACT')).toHaveLength(1);

    const below = decideHarvest([row({ clicks: 4, cost: 1.74, purchases14d: 2, sales14d: 39.98 })],
      { targetAcos: 30 });
    expect(only(below, 'ADD_EXACT')).toHaveLength(0);
  });

  it('lets a profile pin its own floor', () => {
    const result = decideHarvest([row({ clicks: 8, cost: 4, purchases14d: 2, sales14d: 40 })],
      { targetAcos: 30, minClicksToPromote: 20 });

    expect(only(result, 'ADD_EXACT')).toHaveLength(0);
    expect(reasons(result)).toContain('TOO_FEW_CLICKS_TO_PROMOTE');
  });

  it('treats a null floor as the policy default, not as no floor', () => {
    // The minClicks lesson: null has to mean something the code decides, or a
    // profile stored with null quietly loses the guard entirely.
    const result = decideHarvest([row({ clicks: 1, cost: 0.48, purchases14d: 3, sales14d: 40.23 })],
      { targetAcos: 30, minClicksToPromote: null });

    expect(only(result, 'ADD_EXACT')).toHaveLength(0);
    expect(reasons(result)).toContain('TOO_FEW_CLICKS_TO_PROMOTE');
  });

  it('reports the floor it used, so a reviewer can check it', () => {
    const result = decideHarvest([row({ clicks: 5, purchases14d: 2, sales14d: 40, cost: 2 })], {});
    expect(result.stats.minClicksToPromoteUsed).toBe(DEFAULT_OBJECTIVE.minClicksToPromote);
  });

  it('does not steal the reason from a term that simply never converted', () => {
    // A one-click term with no sales is thin, but what is true of it is that it
    // has no sales. Checking the floor before the conversion test would label
    // it TOO_FEW_CLICKS_TO_PROMOTE and hide that.
    const result = decideHarvest([row({ clicks: 1, cost: 0.5 })], { minClicks: 40 });
    expect(reasons(result)).toContain('INSUFFICIENT_CLICKS');
    expect(reasons(result)).not.toContain('TOO_FEW_CLICKS_TO_PROMOTE');
  });

  it('leaves negation alone — the floor is a promotion rule', () => {
    // 44 clicks, no sales: negation is governed by minClicks and must not be
    // affected by a threshold about promoting.
    const result = decideHarvest([row({ clicks: 44, cost: 29 })],
      { minClicks: 40, minClicksToPromote: 500 });

    expect(only(result, 'ADD_NEGATIVE')).toHaveLength(1);
  });
});

describe('the default objective', () => {
  it('is genuinely conservative about negation out of the box', () => {
    // 12 was the original value, chosen by feel. At a 6% conversion rate — what
    // Queenza's US account actually does — a healthy term shows zero sales
    // after 12 clicks 48% of the time.
    expect(DEFAULT_OBJECTIVE.minClicks).toBeGreaterThanOrEqual(30);
    expect(DEFAULT_OBJECTIVE.minPurchasesToPromote).toBeGreaterThanOrEqual(2);
  });

  it('negates nothing at all on a report where every term is thin', () => {
    const rows = Array.from({ length: 50 }, (_, i) => row({ searchTerm: `t${i}`, clicks: 3, cost: 1.2 }));

    expect(decideHarvest(rows).candidates).toHaveLength(0);
  });
});


describe('calibrating the click threshold to the account', () => {
  /**
   * The threshold is not a matter of taste. A term converting at the account's
   * baseline still shows zero sales with probability (1 - cvr)^clicks, so the
   * only defensible threshold falls out of the account's own conversion rate
   * and how often you are willing to negate something healthy.
   *
   * The original default of 12 was chosen by feel. Queenza's US account
   * converts at 5.97% — 356 purchases on 5,960 brand clicks in Q2 2026 — and at
   * that rate 12 clicks means a 48% chance of being wrong.
   */
  it('needs ~38 clicks at a 6% conversion rate to be wrong only 10% of the time', () => {
    expect(minClicksFor(0.06, 0.10)).toBe(38);
  });

  it('needs far fewer clicks when an account converts well', () => {
    expect(minClicksFor(0.20, 0.10)).toBeLessThan(minClicksFor(0.06, 0.10));
  });

  it('demands more evidence for a stricter tolerance', () => {
    expect(minClicksFor(0.06, 0.05)).toBeGreaterThan(minClicksFor(0.06, 0.10));
  });

  it('would have called the old default of 12 wrong for this account', () => {
    // The check that names the mistake: at Queenza's rate, 12 clicks carries
    // close to a coin-flip chance of negating a good term.
    const chanceOfNegatingHealthyTerm = (1 - 0.0597) ** 12;

    expect(chanceOfNegatingHealthyTerm).toBeGreaterThan(0.45);
    expect(minClicksFor(0.0597)).toBeGreaterThan(12);
  });

  it('bounds a freakishly high converter, so it cannot negate on noise', () => {
    expect(minClicksFor(0.60, 0.10)).toBeGreaterThanOrEqual(15);
  });

  it('bounds a very low converter, rather than demanding hundreds of clicks', () => {
    expect(minClicksFor(0.005, 0.10)).toBeLessThanOrEqual(80);
  });

  it.each([[0], [1], [-0.1], [NaN], [null], ['0.06']])('returns null for an unusable rate (%p)', (bad) => {
    expect(minClicksFor(bad)).toBeNull();
  });

  it('measures the account rate across the whole report, not per term', () => {
    // A single term never has enough data to estimate its own rate, which is
    // the entire reason a threshold is needed.
    const terms = aggregateRows([
      row({ searchTerm: 'a', clicks: 100, purchases14d: 6, sales14d: 300 }),
      row({ searchTerm: 'b', clicks: 100, purchases14d: 6, sales14d: 300 }),
    ]);

    expect(observedCvr(terms)).toBeCloseTo(0.06, 4);
  });

  it('returns no rate when nothing converted', () => {
    expect(observedCvr(aggregateRows([row({ clicks: 50 })]))).toBeNull();
  });

  it('derives the threshold when the objective does not pin one', () => {
    // The rate is measured across the WHOLE report, so the fixture totals
    // 200 clicks and 12 purchases → 6% → 38. The 30-click term is spared;
    // under the old default of 12 it would have been negated.
    const rows = [
      row({ searchTerm: 'converter', clicks: 170, cost: 100, purchases14d: 12, sales14d: 600 }),
      row({ searchTerm: 'marginal',  clicks: 30,  cost: 15 }),
    ];

    const result = decideHarvest(rows, { minClicks: null, targetAcos: 50 });

    expect(result.stats.minClicksUsed).toBe(38);
    expect(only(result, 'ADD_NEGATIVE')).toHaveLength(0);
  });

  it('still negates a term that clears the derived threshold', () => {
    const rows = [
      row({ searchTerm: 'converter', clicks: 155, cost: 100, purchases14d: 12, sales14d: 600 }),
      row({ searchTerm: 'real dud',  clicks: 45,  cost: 20 }),
    ];

    const result = decideHarvest(rows, { minClicks: null, targetAcos: 50 });

    expect(only(result, 'ADD_NEGATIVE').map(c => c.searchTerm)).toEqual(['real dud']);
  });

  it('lets an operator override the calibration', () => {
    const rows = [
      row({ searchTerm: 'converter', clicks: 170, cost: 100, purchases14d: 12, sales14d: 600 }),
      row({ searchTerm: 'marginal',  clicks: 30,  cost: 15 }),
    ];

    const result = decideHarvest(rows, { minClicks: 25, targetAcos: 50 });

    expect(result.stats.minClicksUsed).toBe(25);
    expect(only(result, 'ADD_NEGATIVE')).toHaveLength(1);
  });

  it('falls back to the default when a report has no conversions to calibrate from', () => {
    const rows = Array.from({ length: 5 }, (_, i) => row({ searchTerm: `t${i}`, clicks: 50, cost: 25 }));

    const result = decideHarvest(rows, { minClicks: null });

    expect(result.stats.minClicksUsed).toBe(DEFAULT_OBJECTIVE.minClicks);
  });

  it('reports the rate it calibrated against, so a reviewer can check it', () => {
    const rows = [row({ clicks: 200, cost: 100, purchases14d: 12, sales14d: 600 })];

    expect(decideHarvest(rows, { minClicks: null }).stats.observedCvr).toBe(6);
  });
});

describe('terms this profile has already been judged on', () => {
  // Why this exists: in shadow nothing is applied, so nothing about the account
  // changes between runs. The same term is proposed every day, and because
  // graduationStatus counts rows rather than distinct terms, the gate would open
  // on a denominator of repeats.

  const negated = row({ clicks: 40, cost: 30 });
  const converting = row({ searchTerm: 'green widget', clicks: 50, cost: 20, purchases14d: 4, sales14d: 200 });

  it('proposes a negative the first time and not the second', () => {
    const first = decideHarvest([negated], { minClicks: 12 });
    expect(only(first, 'ADD_NEGATIVE')).toHaveLength(1);

    const decided = new Set(first.candidates.map(c => decisionKey(c.actionType, c)));
    const second = decideHarvest([negated], { minClicks: 12 }, decided);

    expect(second.candidates).toHaveLength(0);
    expect(reasons(second)).toContain('ALREADY_DECIDED');
  });

  it('suppresses a promotion the same way', () => {
    const first = decideHarvest([converting], { minClicks: 12, targetAcos: 30 });
    expect(only(first, 'ADD_EXACT')).toHaveLength(1);

    const decided = new Set(first.candidates.map(c => decisionKey(c.actionType, c)));

    expect(decideHarvest([converting], { minClicks: 12, targetAcos: 30 }, decided).candidates).toHaveLength(0);
  });

  it('keys on the action, so negating a term does not silence promoting it', () => {
    // The two are different judgements. Having ruled on one says nothing about
    // the other, and collapsing them would hide a real candidate.
    const decided = new Set([decisionKey('ADD_NEGATIVE', {
      campaignId: 'c1', adGroupId: 'g1', searchTerm: 'green widget',
    })]);

    expect(only(decideHarvest([converting], { minClicks: 12 }, decided), 'ADD_EXACT')).toHaveLength(1);
  });

  it('keys on the ad group, so the same term in another ad group is still new', () => {
    const elsewhere = row({ adGroupId: 'g2', clicks: 40, cost: 30 });
    const decided = new Set([decisionKey('ADD_NEGATIVE', {
      campaignId: 'c1', adGroupId: 'g1', searchTerm: 'blue widget',
    })]);

    expect(only(decideHarvest([elsewhere], { minClicks: 12 }, decided), 'ADD_NEGATIVE')).toHaveLength(1);
  });

  it('counts what it suppressed, so a quiet run is distinguishable from a broken one', () => {
    const decided = new Set([decisionKey('ADD_NEGATIVE', {
      campaignId: 'c1', adGroupId: 'g1', searchTerm: 'blue widget',
    })]);

    const result = decideHarvest([negated], { minClicks: 12 }, decided);

    expect(result.stats.alreadyDecided).toBe(1);
    expect(result.stats.negatives).toBe(0);
  });

  it('changes nothing when no decisions have been recorded yet', () => {
    expect(decideHarvest([negated], { minClicks: 12 }).stats.alreadyDecided).toBe(0);
    expect(only(decideHarvest([negated], { minClicks: 12 }), 'ADD_NEGATIVE')).toHaveLength(1);
  });

  it('matches the term however it was cased or spaced when recorded', () => {
    // decisionKey normalises through termKey; a report that returns "Blue  Widget"
    // one day and "blue widget" the next must not read as two different terms.
    const decided = new Set([decisionKey('ADD_NEGATIVE', {
      campaignId: 'c1', adGroupId: 'g1', searchTerm: '  Blue   Widget ',
    })]);

    expect(decideHarvest([negated], { minClicks: 12 }, decided).candidates).toHaveLength(0);
  });
});

describe('composite keys stay unambiguous and stay text', () => {
  const k = (over = {}) => decisionKey('ADD_NEGATIVE', {
    campaignId: 'c1', adGroupId: 'g1', searchTerm: 'blue widget', ...over,
  });

  it('cannot be made to collide by moving a boundary between fields', () => {
    // Two genuinely different decisions whose fields differ only in where one
    // boundary falls. Joined on any character that can appear in a field — a
    // space, say — both render as "ADD_NEGATIVE 1 2 3 blue widget" and the
    // second silently suppresses the first. This is the property a separator
    // has to earn and JSON gets for free.
    expect(k({ campaignId: '1 2', adGroupId: '3' }))
      .not.toBe(k({ campaignId: '1', adGroupId: '2 3' }));

    expect(k({ campaignId: '1', adGroupId: '23' })).not.toBe(k({ campaignId: '12', adGroupId: '3' }));
  });

  it('survives a search term containing quotes, commas and brackets', () => {
    // Search terms are whatever a shopper typed, so the key format has to hold
    // for punctuation that would break a hand-rolled encoding.
    const nasty = '5", ["widget"] \\ backslash';

    expect(k({ searchTerm: nasty })).not.toBe(k({ searchTerm: 'something else' }));
    expect(JSON.parse(k({ searchTerm: nasty }))).toEqual(
      ['ADD_NEGATIVE', 'c1', 'g1', normaliseLike(nasty)],
    );
  });

  it('contains no control characters, so git and grep treat the source as text', () => {
    // A NUL separator was unambiguous and made this file binary to both git and
    // grep: grep printed nothing at all for it, and a 2kB policy change rendered
    // as "Bin 13840 -> 15945 bytes" in review. See .gitattributes.
    // eslint-disable-next-line no-control-regex
    expect(k()).not.toMatch(/[\u0000-\u001f]/);
  });
});

/** The normalisation decisionKey applies, mirrored so the test states its expectation. */
function normaliseLike(text) {
  return String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}
