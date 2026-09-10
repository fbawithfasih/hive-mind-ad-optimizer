/**
 * What the Monday email is allowed to claim.
 *
 * The digest has two clocks and must not conflate them. The agent's counts
 * really are the last seven days. The performance figures are whatever period
 * the seller's latest report covers — presenting that as "your week" would be
 * a wrong number nobody would think to question.
 */
import {
  summariseCampaigns, reportIsFresh, worthSending, canReceiveDigest,
  windowStart, DIGEST_WINDOW_DAYS, REPORT_STALE_DAYS,
} from '../digest.js';

const NOW = new Date('2026-09-14T07:00:00Z');   // a Monday
const DAY = 86_400_000;
const isEntitled = (sub) => sub?.status === 'ACTIVE';

describe('summarising a report', () => {
  it('totals the campaign rows and derives ACoS and ROAS', () => {
    const s = summariseCampaigns([
      { impressions: 1000, clicks: 50, cost: 25, sales14d: 100, purchases14d: 4 },
      { impressions: 500,  clicks: 20, cost: 15, sales14d: 50,  purchases14d: 2 },
    ]);
    expect(s).toMatchObject({ campaigns: 2, impressions: 1500, clicks: 70, spend: 40, sales: 150, orders: 6 });
    expect(s.acos).toBeCloseTo(26.7, 1);
    expect(s.roas).toBeCloseTo(3.75, 2);
  });

  it('reports ACoS as unknown when there were no sales, but ROAS as zero', () => {
    // Not symmetrical, and deliberately so. ACoS is spend/sales, which is
    // undefined with no sales — and "0% ACoS" reads as spectacular when it
    // means the opposite. ROAS is sales/spend, which with spend and no sales
    // is a true and useful number: nothing came back.
    const s = summariseCampaigns([{ clicks: 40, cost: 30, sales14d: 0 }]);
    expect(s.acos).toBeNull();
    expect(s.roas).toBe(0);
    expect(s.spend).toBe(30);
  });

  it('reports ROAS as unknown when nothing was spent', () => {
    expect(summariseCampaigns([{ clicks: 0, cost: 0, sales14d: 0 }]).roas).toBeNull();
  });

  it('accepts either the Amazon column names or the flattened ones', () => {
    const amazon = summariseCampaigns([{ cost: 10, sales14d: 20, purchases14d: 1 }]);
    const flat   = summariseCampaigns([{ spend: 10, sales: 20, orders: 1 }]);
    expect(flat).toMatchObject({ spend: amazon.spend, sales: amazon.sales, orders: amazon.orders });
  });

  it('survives an empty or ragged report', () => {
    expect(summariseCampaigns([])).toMatchObject({ campaigns: 0, spend: 0, acos: null });
    expect(summariseCampaigns([null, {}, { cost: 'x' }]).spend).toBe(0);
  });
});

describe('how old a report may be', () => {
  it('quotes one completed inside the staleness window', () => {
    expect(reportIsFresh({ completedAt: new Date(NOW - (REPORT_STALE_DAYS - 1) * DAY) }, NOW)).toBe(true);
  });

  it('refuses one older than the window', () => {
    // Repeating a fortnight-old number every Monday makes the email look
    // automatic in the bad sense.
    expect(reportIsFresh({ completedAt: new Date(NOW - (REPORT_STALE_DAYS + 1) * DAY) }, NOW)).toBe(false);
  });

  it('refuses a report that never completed', () => {
    expect(reportIsFresh(null, NOW)).toBe(false);
    expect(reportIsFresh({ completedAt: null }, NOW)).toBe(false);
    expect(reportIsFresh({ completedAt: 'not a date' }, NOW)).toBe(false);
  });
});

describe('whether to send at all', () => {
  const nothing = { agent: { proposed: 0, applied: 0, awaitingVerdict: 0 }, alerts: 0, performance: null };

  it('stays quiet when there is nothing to say', () => {
    // An empty digest every Monday is how a sender teaches a reader to filter.
    expect(worthSending(nothing)).toBe(false);
    expect(worthSending(null)).toBe(false);
  });

  it.each([
    ['a proposal',          { agent: { proposed: 1, applied: 0, awaitingVerdict: 0 } }],
    ['something applied',   { agent: { proposed: 0, applied: 1, awaitingVerdict: 0 } }],
    ['a pending verdict',   { agent: { proposed: 0, applied: 0, awaitingVerdict: 3 } }],
    ['an alert',            { alerts: 1 }],
    ['fresh performance',   { performance: { spend: 10 } }],
  ])('sends when there is %s', (_label, over) => {
    expect(worthSending({ ...nothing, ...over })).toBe(true);
  });
});

describe('who may receive one', () => {
  it('includes an org still inside its trial', () => {
    expect(canReceiveDigest({ trialEndsAt: new Date(NOW.getTime() + DAY), subscriptions: [] }, isEntitled, NOW)).toBe(true);
  });

  it('includes an org with a subscription that still counts', () => {
    expect(canReceiveDigest({ trialEndsAt: null, subscriptions: [{ status: 'ACTIVE' }] }, isEntitled, NOW)).toBe(true);
  });

  it('excludes a lapsed org', () => {
    // It keeps its account and history, but a weekly email about an agent it
    // cannot act on is not a service to anyone.
    expect(canReceiveDigest({ trialEndsAt: new Date(NOW.getTime() - DAY), subscriptions: [{ status: 'CANCELLED' }] }, isEntitled, NOW)).toBe(false);
    expect(canReceiveDigest({ trialEndsAt: null, subscriptions: [] }, isEntitled, NOW)).toBe(false);
  });

  it('ignores an unreadable trial date rather than treating it as valid', () => {
    expect(canReceiveDigest({ trialEndsAt: 'someday', subscriptions: [] }, isEntitled, NOW)).toBe(false);
  });
});

it('counts the agent over exactly seven days', () => {
  expect(windowStart(NOW)).toEqual(new Date(NOW.getTime() - DIGEST_WINDOW_DAYS * DAY));
  expect(DIGEST_WINDOW_DAYS).toBe(7);
});
