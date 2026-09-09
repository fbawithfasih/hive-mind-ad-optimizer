/**
 * The setup checklist ends at the agent's first proposals.
 *
 * Four steps, and the two Amazon consents are one of them: Seller Central
 * first (the Ads token cannot be saved without it), then Advertising, with
 * `detail` saying which half is missing. The sample profile counts for
 * nothing here — not as a synced profile, not as a run that proposed.
 */
import express from 'express';
import request from 'supertest';
import { sharedServer } from '../../../test/http-server.js';

jest.mock('../../../db/prisma.js', () => ({
  prisma: {
    user:             { findUnique: jest.fn() },
    amazonCredential: { count: jest.fn() },
    sellerProfile:    { count: jest.fn(), findFirst: jest.fn() },
    agentDecision:    { count: jest.fn() },
  },
}));
jest.mock('../../../services/credentials.js', () => ({ loadOrgCredential: jest.fn() }));

import { prisma } from '../../../db/prisma.js';
import { loadOrgCredential } from '../../../services/credentials.js';
import onboardingRouter from '../onboarding.js';

const serve = sharedServer();
function makeApp(tenant = { orgId: 'org-1' }, user = { userId: 'user-1' }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.tenant = tenant; req.user = user; next(); });
  app.use('/', onboardingRouter);
  return serve(app);
}

function state({ emailVerified = true, sp = false, ads = false, profiles = 0, proposals = 0, demo = false } = {}) {
  prisma.user.findUnique.mockResolvedValue({ emailVerified });
  prisma.amazonCredential.count.mockResolvedValue(sp ? 1 : 0);
  loadOrgCredential.mockResolvedValue(sp ? { adsRefreshToken: ads ? 'rt' : null } : null);
  prisma.sellerProfile.count.mockResolvedValue(profiles);
  prisma.agentDecision.count.mockResolvedValue(proposals);
  prisma.sellerProfile.findFirst.mockResolvedValue(demo ? { profileId: 'demo-us' } : null);
}

const get = () => request(makeApp()).get('/status');

beforeEach(() => jest.clearAllMocks());

describe('shape', () => {
  it('has exactly the four steps, in order, and a total of four', async () => {
    state();
    const res = await get();
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.steps)).toEqual(['emailVerified', 'credentialsConnected', 'profileSynced', 'firstProposals']);
    expect(res.body.progress.total).toBe(4);
  });

  it('reports which consent is missing', async () => {
    state({ sp: true, ads: false });
    const res = await get();
    expect(res.body.detail).toMatchObject({ spConnected: true, adsConnected: false });
    expect(res.body.steps.credentialsConnected).toBe(false);
  });
});

describe('nextStep, in order', () => {
  it.each([
    ['verify_email',    { emailVerified: false }],
    ['connect_amazon',  {}],
    ['connect_ads',     { sp: true }],
    ['sync_profile',    { sp: true, ads: true }],
    ['await_proposals', { sp: true, ads: true, profiles: 1 }],
    [null,              { sp: true, ads: true, profiles: 1, proposals: 3 }],
  ])('%s', async (expected, st) => {
    state(st);
    expect((await get()).body.nextStep).toBe(expected);
  });

  it('is complete only when the agent has proposed', async () => {
    state({ sp: true, ads: true, profiles: 1, proposals: 1 });
    const res = await get();
    expect(res.body.complete).toBe(true);
    expect(res.body.progress.completed).toBe(4);
  });
});

describe('the sample counts for nothing', () => {
  it('counts only real profiles as synced', async () => {
    state();
    await get();
    expect(prisma.sellerProfile.count).toHaveBeenCalledWith({ where: { orgId: 'org-1', isDemo: false } });
  });

  it('counts decisions from every run but the sample\'s', async () => {
    state();
    await get();
    expect(prisma.agentDecision.count).toHaveBeenCalledWith({ where: { orgId: 'org-1', run: { slotKey: { not: 'agent:demo' } } } });
  });

  it('names the sample only while the org still has one', async () => {
    state({ demo: true });
    expect((await get()).body.demo).toEqual({ profileId: 'demo-us' });
    state({ demo: false });
    expect((await get()).body.demo).toBeNull();
  });
});

describe('scoping', () => {
  it('queries the user by req.user and everything else by req.tenant', async () => {
    state();
    await request(makeApp({ orgId: 'org-42' }, { userId: 'user-99' })).get('/status');
    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'user-99' } }));
    expect(prisma.amazonCredential.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-42' }) }));
    expect(loadOrgCredential).toHaveBeenCalledWith('org-42');
  });

  it('treats a credential that cannot be loaded as not connected, rather than failing the page', async () => {
    state({ sp: true });
    loadOrgCredential.mockRejectedValue(new Error('decrypt failed'));
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.nextStep).toBe('connect_ads');
  });
});
