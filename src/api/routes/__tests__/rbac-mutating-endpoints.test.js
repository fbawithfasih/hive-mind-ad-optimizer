/**
 * RBAC coverage for the endpoints that change something.
 *
 * requireRole existed and was applied to 6 of 18 route files. The gap meant a
 * VIEWER — the read-only role — could pause a seller's entire ad account, push
 * negative keywords into live campaigns, and execute automation rules against
 * live budgets.
 *
 * These tests assert the gate rejects VIEWER *before* the handler runs, so no
 * database or Amazon mocking is needed for the refusal path: requireRole reads
 * req.tenant.role and returns 403 without touching anything.
 *
 * The endpoints deliberately left open are asserted too — a VIEWER must keep
 * them, and silently gating one later would break the dashboard.
 */
import express from 'express';
import request from 'supertest';

jest.mock('../../../db/prisma.js', () => ({ prisma: {} }));
jest.mock('../../../services/queue.js', () => ({ reportingQueue: { add: jest.fn() } }));
jest.mock('../../../services/razorpay.js', () => ({
  razorpay: { orders: { create: jest.fn() } },
  PLAN_IDS: {}, trackUsage: jest.fn(), verifyPaymentSignature: jest.fn(),
  verifyWebhookSignature: jest.fn(), syncSubscriptionFromRazorpay: jest.fn(),
  syncPaymentFromRazorpay: jest.fn(), describeRazorpayError: jest.fn(), tierFromPlanId: jest.fn(),
}));
jest.mock('../../../services/claude-mcp.js',              () => ({ executeMCPCommand: jest.fn() }));
jest.mock('../../../services/rule-engine.js',             () => ({ executeRule: jest.fn(), executeAllRules: jest.fn() }));
jest.mock('../../../services/brand-analytics/loader.js',  () => ({ getBrandAnalyticsContext: jest.fn() }));
jest.mock('../../middleware/requireAuth.js',          () => ({ requireAuth:          (req, _res, next) => next() }));
jest.mock('../../middleware/requireVerifiedEmail.js', () => ({ requireVerifiedEmail: (req, _res, next) => next() }));

import campaignsRouter   from '../campaigns.js';
import searchTermsRouter from '../search-terms.js';
import automationRouter  from '../automation.js';
import alertsRouter      from '../alerts.js';
import reportingRouter   from '../reporting-agent.js';
import mcpRouter         from '../mcp.js';
import billingRouter     from '../billing.js';

/** Mount a router with a caller of the given org role. */
function app(router, role) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.user   = { userId: 'u-1', email: 'a@b.com' };
    req.tenant = { orgId: 'org-1', org: {}, role };
    next();
  });
  a.use('/', router);
  return a;
}

// [name, router, method, path, minimum role]
const GATED = [
  ['campaigns bulk enable/pause/budget', campaignsRouter,   'put',    '/bulk',          'MEMBER'],
  ['search-terms push keywords',         searchTermsRouter, 'post',   '/bulk-actions',  'MEMBER'],
  ['automation create rule',             automationRouter,  'post',   '/rules',         'MEMBER'],
  ['automation edit rule',               automationRouter,  'patch',  '/rules/r-1',     'MEMBER'],
  ['automation delete rule',             automationRouter,  'delete', '/rules/r-1',     'MEMBER'],
  ['automation RUN rule',                automationRouter,  'post',   '/rules/r-1/run', 'MEMBER'],
  ['automation RUN ALL rules',           automationRouter,  'post',   '/run-all',       'MEMBER'],
  ['alerts create rule',                 alertsRouter,      'post',   '/rules',         'MEMBER'],
  ['alerts edit rule',                   alertsRouter,      'patch',  '/rules/a-1',     'MEMBER'],
  ['alerts delete rule',                 alertsRouter,      'delete', '/rules/a-1',     'MEMBER'],
  ['reporting agent start',              reportingRouter,   'post',   '/start',         'MEMBER'],
  ['AI command execute',                 mcpRouter,         'post',   '/execute',       'MEMBER'],
  ['alerts read slack webhook',          alertsRouter,      'get',    '/slack',         'ADMIN'],
  ['alerts write slack webhook',         alertsRouter,      'patch',  '/slack',         'ADMIN'],
  ['billing create order',               billingRouter,     'post',   '/create-order',  'ADMIN'],
  ['billing verify order',               billingRouter,     'post',   '/verify-order',  'ADMIN'],
];

describe('VIEWER cannot reach endpoints that change things', () => {
  it.each(GATED)('%s → 403 for VIEWER', async (_name, router, method, path) => {
    const res = await request(app(router, 'VIEWER'))[method](path).send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/requires (MEMBER|ADMIN) role/);
  });
});

describe('MEMBER cannot reach ADMIN-only endpoints', () => {
  const adminOnly = GATED.filter(g => g[4] === 'ADMIN');
  it.each(adminOnly)('%s → 403 for MEMBER', async (_name, router, method, path) => {
    const res = await request(app(router, 'MEMBER'))[method](path).send({});
    expect(res.status).toBe(403);
  });
});

describe('the gate lets the intended role through', () => {
  // Not asserting 2xx — the handlers need Amazon and a database. Asserting only
  // that they get PAST the gate, which is what these tests are about.
  it.each(GATED)('%s → not 403 at the required role', async (_name, router, method, path, role) => {
    const res = await request(app(router, role))[method](path).send({});
    expect(res.status).not.toBe(403);
  });
});

describe('endpoints deliberately left open to VIEWER', () => {
  // Each of these would break a read-only user's normal experience if gated.
  const OPEN = [
    ['own notification preference', alertsRouter,      'patch', '/preferences',      { notifyOnAlerts: true }],
    ['mark own alerts read',        alertsRouter,      'post',  '/fires/mark-read',  {}],
    ['start a search-term report',  searchTermsRouter, 'post',  '/start',            {}],
  ];
  it.each(OPEN)('%s stays reachable for VIEWER', async (_name, router, method, path, body) => {
    const res = await request(app(router, 'VIEWER'))[method](path).send(body);
    expect(res.status).not.toBe(403);
  });
});
