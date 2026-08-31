/**
 * Plan limit enforcement.
 *
 * The pricing page has sold "100 listing optimizations/mo", "5 bulk
 * operations/mo" and profile caps since billing shipped, and nothing enforced
 * any of them — trackUsage wrote counters nothing read, and no limit table
 * existed at all.
 *
 * The risky part is not the check, it is switching it on: customers have been
 * running without a limit, so some are already above one. Hence warn mode by
 * default, and the tests below care as much about what warn mode does NOT do as
 * about what strict mode does.
 */
import express from 'express';
import request from 'supertest';

jest.mock('../../db/prisma.js', () => ({
  prisma: {
    organization:  { findUnique: jest.fn() },
    usageMetric:   { findFirst: jest.fn() },
    sellerProfile: { count: jest.fn() },
  },
}));

import {
  checkPlanLimit, enforcePlanLimit, applyProfileCap,
  planLimitMode, planLimitStats, resetPlanLimitStats, limitFor,
} from '../plan-limits.js';
import { prisma } from '../../db/prisma.js';

function app(middleware) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.tenant = { orgId: 'org-1' }; next(); });
  a.post('/thing', middleware, (_req, res) => res.json({ ok: true }));
  return a;
}

const onTier = (tier) => prisma.organization.findUnique.mockResolvedValue({ tier });
const used   = (field, n) => prisma.usageMetric.findFirst.mockResolvedValue({ [field]: n });

beforeEach(() => {
  jest.clearAllMocks();
  resetPlanLimitStats();
  delete process.env.PLAN_LIMITS_MODE;
  onTier('BASIC');
  prisma.usageMetric.findFirst.mockResolvedValue(null);
  prisma.sellerProfile.count.mockResolvedValue(0);
});

describe('the limit table', () => {
  it.each([
    ['BASIC', 'listingsOptimized', 100],
    ['BASIC', 'bulkOperations',      5],
    ['BASIC', 'reportsGenerated',   10],
    ['BASIC', 'profiles',            1],
    ['PRO',   'bulkOperations',     50],
    ['PRO',   'profiles',            5],
  ])('%s %s → %i, matching what the pricing page sells', (tier, field, expected) => {
    expect(limitFor(tier, field)).toBe(expected);
  });

  it.each([
    ['PRO',        'listingsOptimized'],
    ['PRO',        'reportsGenerated'],
    ['ENTERPRISE', 'bulkOperations'],
    ['ENTERPRISE', 'profiles'],
    ['CUSTOM',     'listingsOptimized'],
  ])('%s %s is unlimited', (tier, field) => {
    expect(limitFor(tier, field)).toBeNull();
  });

  it('falls back to the most restrictive plan for an unknown tier', () => {
    expect(limitFor('MYSTERY', 'bulkOperations')).toBe(5);
  });
});

describe('checkPlanLimit', () => {
  it('allows a request that fits', async () => {
    used('bulkOperations', 3);
    expect(await checkPlanLimit('org-1', 'bulkOperations')).toMatchObject({ allowed: true, used: 3, limit: 5 });
  });

  it('allows the one that reaches the limit exactly', async () => {
    used('bulkOperations', 4);
    expect((await checkPlanLimit('org-1', 'bulkOperations')).allowed).toBe(true);
  });

  it('refuses the one after that', async () => {
    used('bulkOperations', 5);
    expect((await checkPlanLimit('org-1', 'bulkOperations')).allowed).toBe(false);
  });

  it('accounts for a request consuming several at once', async () => {
    used('bulkOperations', 3);
    expect((await checkPlanLimit('org-1', 'bulkOperations', 3)).allowed).toBe(false);
    expect((await checkPlanLimit('org-1', 'bulkOperations', 2)).allowed).toBe(true);
  });

  it('treats a missing usage row as zero used', async () => {
    prisma.usageMetric.findFirst.mockResolvedValue(null);
    expect(await checkPlanLimit('org-1', 'bulkOperations')).toMatchObject({ allowed: true, used: 0 });
  });

  it('never blocks on an unlimited field', async () => {
    onTier('PRO');
    expect(await checkPlanLimit('org-1', 'listingsOptimized')).toMatchObject({ allowed: true, unlimited: true });
    expect(prisma.usageMetric.findFirst).not.toHaveBeenCalled();  // no query needed
  });

  it('counts profiles as a standing total, not a monthly one', async () => {
    prisma.sellerProfile.count.mockResolvedValue(1);
    expect((await checkPlanLimit('org-1', 'profiles')).allowed).toBe(false);
    expect(prisma.sellerProfile.count).toHaveBeenCalledWith({ where: { orgId: 'org-1' } });
  });

  it('allows when the check itself fails', async () => {
    // A broken limit check must not take down the operation it was guarding.
    prisma.organization.findUnique.mockRejectedValue(new Error('database unreachable'));
    expect((await checkPlanLimit('org-1', 'bulkOperations')).allowed).toBe(true);
  });

  it('reads the current UTC month', async () => {
    await checkPlanLimit('org-1', 'bulkOperations');
    const { month } = prisma.usageMetric.findFirst.mock.calls[0][0].where;
    expect(month.getUTCDate()).toBe(1);
    expect(month.getUTCHours()).toBe(0);
  });
});

describe('warn mode (the default)', () => {
  it('is what you get without configuration', () => {
    expect(planLimitMode()).toBe('warn');
  });

  it('lets an over-limit request through', async () => {
    // Customers have been running without a limit; refusing them the moment
    // this deploys would be the first they hear of it.
    used('bulkOperations', 99);

    const res = await request(app(enforcePlanLimit('bulkOperations'))).post('/thing').send({});

    expect(res.status).toBe(200);
  });

  it('records it, so /ready can say whether strict is safe yet', async () => {
    used('bulkOperations', 99);

    await request(app(enforcePlanLimit('bulkOperations'))).post('/thing').send({});

    expect(planLimitStats()).toMatchObject({ total: 1, byField: { 'BASIC:bulkOperations': 1 } });
  });

  it('records nothing when the request was within the limit', async () => {
    used('bulkOperations', 1);

    await request(app(enforcePlanLimit('bulkOperations'))).post('/thing').send({});

    expect(planLimitStats().total).toBe(0);
  });
});

describe('strict mode', () => {
  beforeEach(() => { process.env.PLAN_LIMITS_MODE = 'strict'; });

  it('refuses with 402 and names the limit', async () => {
    used('bulkOperations', 5);

    const res = await request(app(enforcePlanLimit('bulkOperations'))).post('/thing').send({});

    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({ code: 'PLAN_LIMIT_REACHED', field: 'bulkOperations', limit: 5, used: 5 });
    expect(res.body.error).toMatch(/bulk operations/);
  });

  it('still allows a request inside the limit', async () => {
    used('bulkOperations', 2);

    expect((await request(app(enforcePlanLimit('bulkOperations'))).post('/thing').send({})).status).toBe(200);
  });

  it('does not apply to an unlimited plan', async () => {
    onTier('ENTERPRISE');
    used('bulkOperations', 5000);

    expect((await request(app(enforcePlanLimit('bulkOperations'))).post('/thing').send({})).status).toBe(200);
  });
});

describe('off mode', () => {
  it('skips the check entirely', async () => {
    process.env.PLAN_LIMITS_MODE = 'off';

    const res = await request(app(enforcePlanLimit('bulkOperations'))).post('/thing').send({});

    expect(res.status).toBe(200);
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
  });
});

describe('the middleware', () => {
  it('passes through a request with no org context', async () => {
    process.env.PLAN_LIMITS_MODE = 'strict';
    const a = express();
    a.post('/thing', enforcePlanLimit('bulkOperations'), (_req, res) => res.json({ ok: true }));

    expect((await request(a).post('/thing')).status).toBe(200);
  });
});

describe('applyProfileCap', () => {
  const profile = (id) => ({ profileId: id, accountInfo: { name: `Store ${id}` } });

  beforeEach(() => { process.env.PLAN_LIMITS_MODE = 'strict'; });

  it('keeps every profile already connected, even over the cap', async () => {
    // A sync must never disconnect a profile the seller is relying on.
    onTier('BASIC'); // limit 1
    const raw = [profile('a'), profile('b'), profile('c')];

    const { limited, skipped } = await applyProfileCap('org-1', raw, new Set(['a', 'b', 'c']));

    expect(limited).toHaveLength(3);
    expect(skipped).toEqual([]);
  });

  it('refuses additions beyond the cap', async () => {
    onTier('BASIC');
    const raw = [profile('a'), profile('b')];

    const { limited, skipped } = await applyProfileCap('org-1', raw, new Set(['a']));

    expect(limited.map(p => p.profileId)).toEqual(['a']);
    expect(skipped).toEqual([{ profileId: 'b', name: 'Store b' }]);
  });

  it('fills the remaining headroom before refusing', async () => {
    onTier('PRO'); // limit 5
    const raw = ['a', 'b', 'c', 'd', 'e', 'f'].map(profile);

    const { limited, skipped } = await applyProfileCap('org-1', raw, new Set(['a', 'b', 'c']));

    expect(limited.map(p => p.profileId)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(skipped.map(p => p.profileId)).toEqual(['f']);
  });

  it('imports everything on an unlimited plan', async () => {
    onTier('ENTERPRISE');
    const raw = ['a', 'b', 'c'].map(profile);

    expect((await applyProfileCap('org-1', raw, new Set())).limited).toHaveLength(3);
  });

  it('imports everything in warn mode, and records the shortfall', async () => {
    process.env.PLAN_LIMITS_MODE = 'warn';
    onTier('BASIC');
    const raw = ['a', 'b', 'c'].map(profile);

    const { limited, skipped } = await applyProfileCap('org-1', raw, new Set());

    expect(limited).toHaveLength(3);
    expect(skipped).toEqual([]);
    expect(planLimitStats().total).toBe(1);
  });

  it('takes the id from either shape the Ads API returns', async () => {
    onTier('BASIC');
    const raw = [{ id: 'x', name: 'Legacy shape' }, { profileId: 'y', name: 'Current shape' }];

    const { limited } = await applyProfileCap('org-1', raw, new Set(['x']));

    expect(limited.map(p => p.id ?? p.profileId)).toEqual(['x']);
  });
});
