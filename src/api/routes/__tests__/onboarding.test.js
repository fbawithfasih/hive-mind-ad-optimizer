import express from 'express';
import request from 'supertest';
import onboardingRouter from '../onboarding.js';

jest.mock('../../../db/prisma.ts', () => ({
  prisma: {
    user:                 { findUnique: jest.fn() },
    amazonCredential:     { count: jest.fn() },
    sellerProfile:        { count: jest.fn() },
    listingOptimization:  { count: jest.fn() },
    reportJob:            { count: jest.fn() },
  },
}));

import { prisma } from '../../../db/prisma.ts';

function makeApp(tenant = { orgId: 'org-1' }, user = { userId: 'user-1' }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.tenant = tenant;
    req.user   = user;
    next();
  });
  app.use('/', onboardingRouter);
  return app;
}

function mockCounts({ emailVerified = true, creds = 0, profiles = 0, optimizations = 0, reports = 0 } = {}) {
  prisma.user.findUnique.mockResolvedValue({ emailVerified });
  prisma.amazonCredential.count.mockResolvedValue(creds);
  prisma.sellerProfile.count.mockResolvedValue(profiles);
  prisma.listingOptimization.count.mockResolvedValue(optimizations);
  prisma.reportJob.count.mockResolvedValue(reports);
}

beforeEach(() => jest.clearAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
// Response shape
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /status — response shape', () => {
  it('returns 200 with complete, progress, steps, nextStep', async () => {
    mockCounts({ emailVerified: true, creds: 1, profiles: 1, optimizations: 1, reports: 1 });
    const res = await request(makeApp()).get('/status');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('complete');
    expect(res.body).toHaveProperty('progress');
    expect(res.body).toHaveProperty('steps');
    expect(res.body).toHaveProperty('nextStep');
  });

  it('steps object has all five keys', async () => {
    mockCounts();
    const res = await request(makeApp()).get('/status');
    const { steps } = res.body;

    expect(steps).toHaveProperty('emailVerified');
    expect(steps).toHaveProperty('credentialsConnected');
    expect(steps).toHaveProperty('profileSynced');
    expect(steps).toHaveProperty('firstOptimization');
    expect(steps).toHaveProperty('firstReport');
  });

  it('progress.total equals number of step keys', async () => {
    mockCounts();
    const res = await request(makeApp()).get('/status');
    expect(res.body.progress.total).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step detection
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /status — step flags', () => {
  it('emailVerified true when user.emailVerified is set', async () => {
    mockCounts({ emailVerified: true });
    const res = await request(makeApp()).get('/status');
    expect(res.body.steps.emailVerified).toBe(true);
  });

  it('emailVerified false when user.emailVerified is null', async () => {
    mockCounts({ emailVerified: false });
    const res = await request(makeApp()).get('/status');
    expect(res.body.steps.emailVerified).toBe(false);
  });

  it('credentialsConnected true when active credential exists', async () => {
    mockCounts({ creds: 1 });
    const res = await request(makeApp()).get('/status');
    expect(res.body.steps.credentialsConnected).toBe(true);
  });

  it('credentialsConnected false when no credentials', async () => {
    mockCounts({ creds: 0 });
    const res = await request(makeApp()).get('/status');
    expect(res.body.steps.credentialsConnected).toBe(false);
  });

  it('profileSynced true when seller profile exists', async () => {
    mockCounts({ profiles: 2 });
    const res = await request(makeApp()).get('/status');
    expect(res.body.steps.profileSynced).toBe(true);
  });

  it('firstOptimization true when completed optimization exists', async () => {
    mockCounts({ optimizations: 1 });
    const res = await request(makeApp()).get('/status');
    expect(res.body.steps.firstOptimization).toBe(true);
  });

  it('firstReport true when completed report exists', async () => {
    mockCounts({ reports: 1 });
    const res = await request(makeApp()).get('/status');
    expect(res.body.steps.firstReport).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Progress counting
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /status — progress', () => {
  it('progress.completed = 0 when nothing is done', async () => {
    mockCounts({ emailVerified: false });
    const res = await request(makeApp()).get('/status');
    expect(res.body.progress.completed).toBe(0);
    expect(res.body.complete).toBe(false);
  });

  it('progress.completed = 3 for three completed steps', async () => {
    mockCounts({ emailVerified: true, creds: 1, profiles: 1 });
    const res = await request(makeApp()).get('/status');
    expect(res.body.progress.completed).toBe(3);
  });

  it('complete = true and progress.completed = 5 when all steps done', async () => {
    mockCounts({ emailVerified: true, creds: 1, profiles: 1, optimizations: 1, reports: 1 });
    const res = await request(makeApp()).get('/status');
    expect(res.body.complete).toBe(true);
    expect(res.body.progress.completed).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// nextStep ordering
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /status — nextStep', () => {
  it('nextStep = verify_email when email not verified', async () => {
    mockCounts({ emailVerified: false });
    const res = await request(makeApp()).get('/status');
    expect(res.body.nextStep).toBe('verify_email');
  });

  it('nextStep = connect_amazon when email verified but no credentials', async () => {
    mockCounts({ emailVerified: true, creds: 0 });
    const res = await request(makeApp()).get('/status');
    expect(res.body.nextStep).toBe('connect_amazon');
  });

  it('nextStep = sync_profile when connected but no profiles', async () => {
    mockCounts({ emailVerified: true, creds: 1, profiles: 0 });
    const res = await request(makeApp()).get('/status');
    expect(res.body.nextStep).toBe('sync_profile');
  });

  it('nextStep = optimize_listing when profiles synced but no optimization', async () => {
    mockCounts({ emailVerified: true, creds: 1, profiles: 1, optimizations: 0 });
    const res = await request(makeApp()).get('/status');
    expect(res.body.nextStep).toBe('optimize_listing');
  });

  it('nextStep = generate_report when optimized but no report', async () => {
    mockCounts({ emailVerified: true, creds: 1, profiles: 1, optimizations: 1, reports: 0 });
    const res = await request(makeApp()).get('/status');
    expect(res.body.nextStep).toBe('generate_report');
  });

  it('nextStep = null when all steps complete', async () => {
    mockCounts({ emailVerified: true, creds: 1, profiles: 1, optimizations: 1, reports: 1 });
    const res = await request(makeApp()).get('/status');
    expect(res.body.nextStep).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Queries use correct org/user scope
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /status — scoping', () => {
  it('queries user by userId from req.user', async () => {
    mockCounts();
    await request(makeApp({ orgId: 'org-1' }, { userId: 'user-99' })).get('/status');
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-99' } })
    );
  });

  it('counts credentials by orgId from req.tenant', async () => {
    mockCounts();
    await request(makeApp({ orgId: 'org-42' })).get('/status');
    expect(prisma.amazonCredential.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-42' }) })
    );
  });
});
