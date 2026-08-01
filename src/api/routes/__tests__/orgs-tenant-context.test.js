/**
 * Tenant-context coverage for the /api/orgs router.
 *
 * This router is mounted ABOVE withTenant (a user may have no org yet), so it
 * is the one place where guarded-model queries would otherwise run with no
 * tenant context — harmless under TENANT_GUARD_MODE=warn, but a 500 under
 * strict. These tests pin down which context each query runs in, so the router
 * stays safe to run with the guard enforcing.
 *
 * Every prisma call records the tenant context that was active when it ran.
 */

import express from 'express';
import request from 'supertest';
import { getTenantContext } from '../../../db/tenant-context.js';

/** Contexts captured at query time, in call order: { model, ctx }. */
const seen = [];

jest.mock('../../../db/prisma.js', () => {
  const { getTenantContext: ctx } = jest.requireActual('../../../db/tenant-context.js');
  const rec = (model, value) => jest.fn(() => {
    globalThis.__seen.push({ model, ctx: ctx() });
    return Promise.resolve(typeof value === 'function' ? value() : value);
  });
  return {
    prisma: {
      organization: { findUnique: rec('organization', null), update: rec('organization', {}) },
      orgMember: {
        findFirst: rec('orgMember', null),
        findMany:  rec('orgMember', []),
        create:    rec('orgMember', {}),
        count:     rec('orgMember', 0),
        update:    rec('orgMember', {}),
        delete:    rec('orgMember', {}),
      },
      user: { findUnique: rec('user', null) },
      $transaction: jest.fn(async (fn) => {
        globalThis.__seen.push({ model: '$transaction', ctx: ctx() });
        return fn({
          organization: { create: async () => ({ id: 'org-new', name: 'New' }) },
          orgMember:    { create: async () => ({}) },
        });
      }),
    },
  };
});

globalThis.__seen = seen;

import { prisma } from '../../../db/prisma.js';
import orgsRouter from '../orgs.js';

const USER = { userId: 'user-1' };

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = USER; next(); });
  app.use('/', orgsRouter);
  return app;
}

/** The context active for the Nth recorded call of `model`. */
function ctxFor(model, nth = 0) {
  return seen.filter((s) => s.model === model)[nth]?.ctx;
}

beforeEach(() => {
  seen.length = 0;
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap routes — legitimately span organizations, must run as system
// ─────────────────────────────────────────────────────────────────────────────

describe('cross-org bootstrap routes run as system', () => {
  it('GET / lists memberships under system context', async () => {
    const res = await request(makeApp()).get('/');

    expect(res.status).toBe(200);
    expect(ctxFor('orgMember')).toEqual({ mode: 'system' });
  });

  it('POST / creates the org + first member under system context', async () => {
    const res = await request(makeApp())
      .post('/')
      .send({ name: 'Acme Co' });

    expect(res.status).toBe(201);
    // The org does not exist yet, so no tenant context is possible.
    expect(ctxFor('$transaction')).toEqual({ mode: 'system' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Per-org routes — real tenant context, so the guard actually protects them
// ─────────────────────────────────────────────────────────────────────────────

describe('/:orgId routes run inside the org tenant context', () => {
  it('scopes the members query to the org in the URL', async () => {
    prisma.orgMember.findFirst.mockImplementationOnce(() => {
      seen.push({ model: 'orgMember', ctx: getTenantContext() });
      return Promise.resolve({ id: 'm1', role: 'ADMIN', org: { id: 'org-A' } });
    });

    const res = await request(makeApp()).get('/org-A/members');

    expect(res.status).toBe(200);
    // getAccess() is the authorization bootstrap → system.
    expect(ctxFor('orgMember', 0)).toEqual({ mode: 'system' });
    // The actual member listing → scoped to the org from the URL.
    expect(ctxFor('orgMember', 1)).toEqual({ mode: 'tenant', orgId: 'org-A' });
  });

  it('denies access without leaking the org context to a non-member', async () => {
    // getAccess returns null → 403 before any scoped query runs.
    const res = await request(makeApp()).get('/org-B/members');

    expect(res.status).toBe(403);
    expect(seen.filter((s) => s.ctx?.mode === 'tenant')).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /:orgId — org settings, including the brandName field
// ─────────────────────────────────────────────────────────────────────────────

describe('PUT /:orgId brandName', () => {
  beforeEach(() => {
    prisma.orgMember.findFirst.mockImplementation(() =>
      Promise.resolve({ id: 'm1', role: 'ADMIN', org: { id: 'org-A' } })
    );
  });

  it('persists a trimmed brand name', async () => {
    prisma.organization.update.mockResolvedValueOnce({ id: 'org-A', brandName: 'Queenza' });

    const res = await request(makeApp()).put('/org-A').send({ brandName: '  Queenza  ' });

    expect(res.status).toBe(200);
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { brandName: 'Queenza' } })
    );
  });

  it('clears the brand name when given an empty string', async () => {
    prisma.organization.update.mockResolvedValueOnce({ id: 'org-A', brandName: null });

    const res = await request(makeApp()).put('/org-A').send({ brandName: '' });

    expect(res.status).toBe(200);
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { brandName: null } })
    );
  });

  it('leaves brandName untouched when the field is absent', async () => {
    prisma.organization.update.mockResolvedValueOnce({ id: 'org-A', name: 'Renamed' });

    await request(makeApp()).put('/org-A').send({ name: 'Renamed' });

    const { data } = prisma.organization.update.mock.calls.at(-1)[0];
    expect(data).not.toHaveProperty('brandName');
  });

  it('rejects an empty update', async () => {
    const res = await request(makeApp()).put('/org-A').send({});

    expect(res.status).toBe(400);
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('requires ADMIN', async () => {
    prisma.orgMember.findFirst.mockImplementation(() =>
      Promise.resolve({ id: 'm1', role: 'MEMBER', org: { id: 'org-A' } })
    );

    const res = await request(makeApp()).put('/org-A').send({ brandName: 'Queenza' });

    expect(res.status).toBe(403);
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The property that matters: no guarded query ever runs context-less
// ─────────────────────────────────────────────────────────────────────────────

describe('no orgMember query runs without a tenant context', () => {
  const routes = [
    ['get',    '/'],
    ['get',    '/org-A'],
    ['get',    '/org-A/members'],
    ['post',   '/org-A/members'],
    ['put',    '/org-A/members/user-2'],
    ['delete', '/org-A/members/user-2'],
  ];

  it.each(routes)('%s %s', async (method, path) => {
    // Grant ADMIN so handlers proceed past the access check.
    prisma.orgMember.findFirst.mockImplementation(() => {
      seen.push({ model: 'orgMember', ctx: getTenantContext() });
      return Promise.resolve({ id: 'm1', role: 'ADMIN', userId: 'user-2', org: { id: 'org-A' } });
    });
    prisma.user.findUnique.mockImplementation(() => {
      seen.push({ model: 'user', ctx: getTenantContext() });
      return Promise.resolve({ id: 'user-2', email: 'b@c.com' });
    });

    await request(makeApp())[method](path).send({ email: 'b@c.com', role: 'MEMBER' });

    const contextless = seen.filter((s) => s.model === 'orgMember' && s.ctx === undefined);
    expect(contextless).toEqual([]);
  });
});
