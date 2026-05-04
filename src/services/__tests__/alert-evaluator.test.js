/**
 * Tests for the alert evaluator's pure logic — condition matching, metric
 * mapping (CAMPAIGN_PERFORMANCE field names vs frontend-flat names), and
 * dedup against the recent-fires set.
 */

import { __testables } from '../alert-evaluator.js';

const { meetsCondition, readMetric, pureEvaluate } = __testables;

describe('meetsCondition', () => {
  it('compares with the four valid operators', () => {
    expect(meetsCondition(50, 'gt',  40)).toBe(true);
    expect(meetsCondition(40, 'gt',  40)).toBe(false);
    expect(meetsCondition(40, 'gte', 40)).toBe(true);
    expect(meetsCondition(30, 'lt',  40)).toBe(true);
    expect(meetsCondition(40, 'lt',  40)).toBe(false);
    expect(meetsCondition(40, 'lte', 40)).toBe(true);
  });

  it('returns false for null/undefined values (no data → no fire)', () => {
    expect(meetsCondition(null, 'gt', 1)).toBe(false);
    expect(meetsCondition(undefined, 'lt', 100)).toBe(false);
  });

  it('rejects unknown operators', () => {
    expect(meetsCondition(99, 'eq', 99)).toBe(false);
    expect(meetsCondition(99, '!=', 99)).toBe(false);
  });
});

describe('readMetric — dual report shape support', () => {
  it('reads frontend-flat fields (acos, spend, etc.)', () => {
    const row = { acos: 0.42, spend: 100.5, ctr: 0.012 };
    expect(readMetric(row, 'acos')).toBe(0.42);
    expect(readMetric(row, 'spend')).toBe(100.5);
    expect(readMetric(row, 'ctr')).toBe(0.012);
  });

  it('reads SP-API CAMPAIGN_PERFORMANCE field names', () => {
    const row = { acosClicks14d: 0.33, cost: 250, clickThroughRate: 0.018 };
    expect(readMetric(row, 'acos')).toBe(0.33);
    expect(readMetric(row, 'spend')).toBe(250);
    expect(readMetric(row, 'ctr')).toBe(0.018);
  });

  it('prefers the frontend-flat value when both shapes are present', () => {
    const row = { acos: 0.5, acosClicks14d: 0.99 };
    expect(readMetric(row, 'acos')).toBe(0.5);
  });

  it('returns null when neither shape has the metric', () => {
    expect(readMetric({}, 'roas')).toBe(null);
    expect(readMetric(null, 'roas')).toBe(null);
  });
});

describe('pureEvaluate', () => {
  const acosAlert = {
    id: 'a1', isActive: true, name: 'High ACoS',
    metric: 'acos', condition: 'gt', threshold: 0.30,
  };
  const spendAlert = {
    id: 'a2', isActive: true, name: 'Spend ceiling',
    metric: 'spend', condition: 'gte', threshold: 100,
  };
  const inactiveAlert = {
    id: 'a3', isActive: false, name: 'Low CTR',
    metric: 'ctr', condition: 'lt', threshold: 0.005,
  };

  const campaigns = [
    { campaignId: 'c1', name: 'Brand defence', acos: 0.45, spend: 50,  ctr: 0.001 },
    { campaignId: 'c2', name: 'Generic',       acos: 0.20, spend: 150, ctr: 0.020 },
    { campaignId: 'c3', name: 'Halo',          acos: 0.35, spend: 200, ctr: 0.003 },
  ];

  it('emits one fire per (alert, campaign) match', () => {
    const fires = pureEvaluate([acosAlert, spendAlert], campaigns, new Set());
    // ACoS > 30%: c1 (0.45), c3 (0.35) → 2 fires
    // Spend >= 100: c2, c3 → 2 fires
    expect(fires).toHaveLength(4);
    const keys = fires.map(f => f.dedupKey).sort();
    expect(keys).toEqual(['a1::c1', 'a1::c3', 'a2::c2', 'a2::c3'].sort());
  });

  it('skips inactive alerts', () => {
    const fires = pureEvaluate([inactiveAlert], campaigns, new Set());
    expect(fires).toEqual([]);
  });

  it('skips dedup-set matches', () => {
    // c1 already fired in the last 4h
    const dedup = new Set(['a1::c1']);
    const fires = pureEvaluate([acosAlert], campaigns, dedup);
    expect(fires.map(f => f.dedupKey)).toEqual(['a1::c3']);
  });

  it('does not double-fire within the same batch', () => {
    // Same campaign appears twice in the input — one fire, not two
    const dupes = [...campaigns, { campaignId: 'c1', name: 'dup', acos: 0.45 }];
    const fires = pureEvaluate([acosAlert], dupes, new Set());
    const c1Fires = fires.filter(f => f.campaignId === 'c1');
    expect(c1Fires).toHaveLength(1);
  });

  it('falls back to row.id when campaignId is missing', () => {
    const rows = [{ id: 'cx', name: 'No-cid', acos: 0.99 }];
    const fires = pureEvaluate([acosAlert], rows, new Set());
    expect(fires).toHaveLength(1);
    expect(fires[0].campaignId).toBe('cx');
  });

  it('drops rows without any campaign identifier', () => {
    const rows = [{ name: 'orphan', acos: 0.99 }];
    const fires = pureEvaluate([acosAlert], rows, new Set());
    expect(fires).toEqual([]);
  });
});
