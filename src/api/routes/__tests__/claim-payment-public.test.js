/**
 * POST /api/billing/claim-payment must be reachable without a session.
 *
 * It is called server-to-server by the marketing site after a successful
 * Razorpay order payment, so the caller has no session cookie and no org. It was
 * defined on billingRouter, which mounts below requireAuth and withTenant — so
 * its only legitimate caller got a 401 and the signup claim flow could never
 * have worked. It went unnoticed because no payment had ever succeeded.
 *
 * These tests mount the real router tree (the same index.js production uses) so
 * the middleware ordering itself is under test, not just the handler.
 */

import express from 'express';
import request from 'supertest';

const CLAIM_SECRET = 'test-marketing-claim-secret';
process.env.MARKETING_CLAIM_SECRET = CLAIM_SECRET;
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-key-for-testing-only';

/** Redis calls the handler makes, captured. */
const redisSets = [];

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    set: jest.fn((key, value, ...rest) => {
      globalThis.__redisSets.push({ key, value, rest });
      return Promise.resolve('OK');
    }),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1),
    on:  jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
  }));
});

jest.mock('bullmq', () => ({
  Queue:  jest.fn().mockImplementation(() => ({ add: jest.fn().mockResolvedValue({}), close: jest.fn() })),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn(), close: jest.fn() })),
}));

jest.mock('../../../db/prisma.js', () => ({
  prisma: new Proxy({}, {
    get: () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(null) }),
  }),
}));

jest.mock('uuid', () => ({ v4: () => 'test-uuid-0000' }));

// public-stats.js uses import.meta for __dirname, which babel-jest's CommonJS
// transform cannot parse — it is the one module that makes the real router tree
// unimportable here. Stubbed with an empty router; this suite does not touch it.
jest.mock('../public-stats.js', () => ({
  __esModule: true,
  default: require('express').Router(),
}));

globalThis.__redisSets = redisSets;

// Static import: jest hoists the mocks above it, and the handler reads
// MARKETING_CLAIM_SECRET at call time rather than module load.
import routes from '../index.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', routes);
  return app;
}

const body = (over = {}) => ({
  paymentId: 'pay_TEST123',
  orderId:   'order_TEST123',
  planName:  'GROWTH',
  amount:    14900,
  currency:  'USD',
  secret:    CLAIM_SECRET,
  ...over,
});

beforeEach(() => {
  redisSets.length = 0;
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// The regression: reachable with no cookie at all
// ─────────────────────────────────────────────────────────────────────────────

describe('reachability without a session', () => {
  it('accepts a valid claim with no auth cookie — never 401s for missing auth', async () => {
    const res = await request(makeApp()).post('/api/billing/claim-payment').send(body());

    expect(res.status).toBe(200);
    expect(res.body.claimToken).toEqual(expect.any(String));
    expect(res.body.tier).toBe('PRO'); // GROWTH → PRO
  });

  it('stores the claim in Redis with a TTL', async () => {
    await request(makeApp()).post('/api/billing/claim-payment').send(body());

    expect(redisSets).toHaveLength(1);
    expect(redisSets[0].key).toMatch(/^claim:[0-9a-f]{48}$/);
    expect(redisSets[0].rest).toContain('EX');
  });

  it('maps every marketing plan name to a tier', async () => {
    for (const [name, tier] of [['STARTER', 'BASIC'], ['GROWTH', 'PRO'], ['SCALE', 'ENTERPRISE']]) {
      const res = await request(makeApp())
        .post('/api/billing/claim-payment')
        .send(body({ planName: name }));

      expect(res.status).toBe(200);
      expect(res.body.tier).toBe(tier);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Public does not mean unprotected
// ─────────────────────────────────────────────────────────────────────────────

describe('shared-secret enforcement', () => {
  it.each([
    ['wrong secret',   'not-the-secret'],
    ['empty secret',   ''],
    ['missing secret', undefined],
    ['prefix of the real secret', CLAIM_SECRET.slice(0, -1)],
  ])('rejects %s with 401 and writes nothing', async (_label, secret) => {
    const res = await request(makeApp())
      .post('/api/billing/claim-payment')
      .send(body({ secret }));

    expect(res.status).toBe(401);
    expect(redisSets).toHaveLength(0);
  });

  it('validates required fields only after the secret passes', async () => {
    const res = await request(makeApp())
      .post('/api/billing/claim-payment')
      .send(body({ secret: 'wrong', planName: undefined }));

    // 401, not 400 — an unauthenticated caller learns nothing about the schema.
    expect(res.status).toBe(401);
  });

  it('rejects an unknown plan name once authenticated', async () => {
    const res = await request(makeApp())
      .post('/api/billing/claim-payment')
      .send(body({ planName: 'NONSENSE' }));

    expect(res.status).toBe(400);
    expect(redisSets).toHaveLength(0);
  });

  it('requires paymentId', async () => {
    const res = await request(makeApp())
      .post('/api/billing/claim-payment')
      .send(body({ paymentId: undefined }));

    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Other /billing routes must stay behind auth
// ─────────────────────────────────────────────────────────────────────────────

describe('the rest of /billing is unaffected', () => {
  it.each([
    ['get',  '/api/billing/status'],
    ['post', '/api/billing/checkout'],
    ['post', '/api/billing/cancel'],
  ])('%s %s still requires auth', async (method, path) => {
    const res = await request(makeApp())[method](path).send({});

    expect(res.status).toBe(401);
  });
});
