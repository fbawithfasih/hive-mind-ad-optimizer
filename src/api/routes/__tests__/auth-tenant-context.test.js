/**
 * Tenant-context coverage for the /api/auth router.
 *
 * /auth is mounted ABOVE withTenant (you cannot have an org before you have an
 * account), so nothing establishes a tenant context here. OrgMember and
 * Subscription are both guarded models, so every query below would take the
 * guard's "no context" path — silently passed through under
 * TENANT_GUARD_MODE=warn, but a hard throw under strict.
 *
 * That made login, Google SSO and Apple SSO a total outage waiting on a single
 * env-var flip. These tests pin the context each query runs in so the router
 * stays safe with the guard enforcing.
 */

import express from 'express';
import request from 'supertest';
import { sharedServer } from '../../../test/http-server.js';
import { getTenantContext } from '../../../db/tenant-context.js';

/** Contexts captured at query time, in call order. */
const seen = [];

// uuid v13 ships ESM only and jest does not transform node_modules. auth.js
// uses it solely to mint user ids, which is irrelevant here.
jest.mock('uuid', () => ({ v4: () => 'test-uuid-0000' }));

jest.mock('../../../db/prisma.js', () => {
  const { getTenantContext: ctx } = jest.requireActual('../../../db/tenant-context.js');
  const rec = (model, value) => jest.fn(() => {
    globalThis.__authSeen.push({ model, ctx: ctx() });
    return Promise.resolve(typeof value === 'function' ? value() : value);
  });
  return {
    prisma: {
      user: {
        findUnique: rec('user', null),
        create:     rec('user', { id: 'u1', email: 'a@b.com' }),
        update:     rec('user', {}),
      },
      organization: { create: rec('organization', { id: 'org-new', name: 'New' }) },
      orgMember:    { findFirst: rec('orgMember', null), create: rec('orgMember', {}) },
      subscription: { create: rec('subscription', {}) },
      emailVerificationToken: { create: rec('emailVerificationToken', {}) },
    },
  };
});

jest.mock('../../../db/password.js', () => ({
  hashPassword:   jest.fn().mockResolvedValue('$2b$12$fakehashfakehashfakehashfakehashfakehashfakehashfakeha'),
  verifyPassword: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../../services/email.js', () => ({
  sendVerificationEmail:  jest.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../billing.js', () => ({
  consumeClaimToken: jest.fn().mockResolvedValue({ tier: 'PRO', paymentId: 'pay_x' }),
}));

jest.mock('../../../services/apple-auth.js', () => ({
  appleConfigured:      jest.fn().mockReturnValue(false),
  getAppleClientSecret: jest.fn(),
  verifyAppleIdToken:   jest.fn(),
}));

globalThis.__authSeen = seen;

import { prisma } from '../../../db/prisma.js';
import authRouter from '../auth.js';

/** One server for this file — see src/test/http-server.js. */
const serve = sharedServer();

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/', authRouter);
  return serve(app);
}

/** Every context recorded for a guarded model. */
const GUARDED = new Set(['orgMember', 'subscription']);
const guardedContexts = () => seen.filter((s) => GUARDED.has(s.model)).map((s) => s.ctx);

beforeEach(() => {
  seen.length = 0;
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Login — the highest-consequence path. A throw here locks everyone out.
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /login', () => {
  beforeEach(() => {
    prisma.user.findUnique.mockImplementation(() => {
      seen.push({ model: 'user', ctx: getTenantContext() });
      return Promise.resolve({ id: 'u1', email: 'a@b.com', passwordHash: '$2b$12$x' });
    });
  });

  it('resolves the active org under system context', async () => {
    const res = await request(makeApp()).post('/login').send({ email: 'a@b.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(guardedContexts()).toEqual([{ mode: 'system' }]);
  });

  it('never runs a guarded query with no context', async () => {
    await request(makeApp()).post('/login').send({ email: 'a@b.com', password: 'password123' });

    expect(guardedContexts().filter((c) => c === undefined)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Claim-token signup — creates org + member + subscription in one shot
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /signup with a claim token', () => {
  beforeEach(() => {
    // No existing account for this address — clearAllMocks() clears call data
    // but not implementations, so the login block's stub would otherwise leak
    // in and turn every signup into a 409.
    prisma.user.findUnique.mockImplementation(() => {
      seen.push({ model: 'user', ctx: getTenantContext() });
      return Promise.resolve(null);
    });
  });

  it('creates the org, membership and subscription under system context', async () => {
    const res = await request(makeApp())
      .post('/signup')
      .send({ email: 'new@b.com', password: 'password123', claimToken: 'tok_abc' });

    expect(res.status).toBe(201);

    const ctxs = guardedContexts();
    expect(ctxs.length).toBeGreaterThanOrEqual(2); // orgMember + subscription
    for (const c of ctxs) expect(c).toEqual({ mode: 'system' });
  });

  it('plain signup with no claim token touches no guarded model', async () => {
    const res = await request(makeApp())
      .post('/signup')
      .send({ email: 'new@b.com', password: 'password123' });

    expect(res.status).toBe(201);
    expect(guardedContexts()).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The property that matters across the whole router
// ─────────────────────────────────────────────────────────────────────────────

describe('no auth route runs a guarded query without a tenant context', () => {
  const routes = [
    ['post', '/login',  { email: 'a@b.com', password: 'password123' }],
    ['post', '/signup', { email: 'n@b.com', password: 'password123' }],
    ['post', '/signup', { email: 'n@b.com', password: 'password123', claimToken: 'tok' }],
  ];

  it.each(routes)('%s %s', async (method, path, body) => {
    prisma.user.findUnique.mockImplementation(() => {
      seen.push({ model: 'user', ctx: getTenantContext() });
      return Promise.resolve(
        path === '/login' ? { id: 'u1', email: 'a@b.com', passwordHash: '$2b$12$x' } : null
      );
    });

    await request(makeApp())[method](path).send(body);

    const contextless = guardedContexts().filter((c) => c === undefined);
    expect(contextless).toEqual([]);
  });
});
