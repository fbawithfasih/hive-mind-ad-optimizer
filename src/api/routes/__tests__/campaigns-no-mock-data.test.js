/**
 * GET /api/campaigns must never invent data.
 *
 * An org with no Amazon profile used to receive a fixture of eight campaigns
 * with real-looking names, budgets, spend, ACOS and ROAS, and no flag
 * distinguishing it from live data. A paying customer whose account was not
 * connected saw a dashboard of numbers that were simply made up.
 *
 * The failure mode is what makes it worth a test: it looks like success. There
 * is no error, no empty state, nothing to notice.
 */
import express from 'express';
import request from 'supertest';
import { sharedServer } from '../../../test/http-server.js';

jest.mock('../../../db/prisma.js', () => ({
  prisma: { sellerProfile: { findFirst: jest.fn() } },
}));

import campaignsRouter from '../campaigns.js';
import { prisma } from '../../../db/prisma.js';

/** One server for this file — see src/test/http-server.js. */
const serve = sharedServer();

function app({ adsClient = null, hasOwnAdsCreds = true } = {}) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.tenant = { orgId: 'org-1', role: 'ADMIN' };
    req.hasOwnAdsCreds = hasOwnAdsCreds;
    if (adsClient) req.adsClient = adsClient;
    next();
  });
  a.use('/', campaignsRouter);
  return serve(a);
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.AMAZON_DEFAULT_PROFILE_ID;
});

describe('an org with no Amazon profile', () => {
  beforeEach(() => prisma.sellerProfile.findFirst.mockResolvedValue(null));

  it('gets an empty list, not invented campaigns', async () => {
    const res = await request(app()).get('/');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('is never shown a campaign with spend or ACOS it did not incur', async () => {
    const res = await request(app()).get('/');

    // The fixture's tell-tales: named campaigns carrying money figures.
    const invented = (res.body ?? []).filter(c => c?.spend != null || c?.acos != null);
    expect(invented).toEqual([]);
  });
});

describe('the mock fixture is gone, not merely bypassed', () => {
  it('has no module left to import', async () => {
    await expect(import('../../../data/mock-campaigns.js')).rejects.toThrow();
  });

  it('is not referenced by any route', async () => {
    const fs = await import('node:fs');
    for (const file of ['campaigns.js', 'mcp.js']) {
      const src = fs.readFileSync(`src/api/routes/${file}`, 'utf8');
      expect(src).not.toMatch(/mock-campaigns/);
    }
  });
});

describe('GET /:id', () => {
  it('no longer exists', async () => {
    // It only ever searched the fixture, so it returned invented detail for a
    // fixture id and 404 for every real campaign. Nothing in the frontend
    // called it.
    prisma.sellerProfile.findFirst.mockResolvedValue(null);

    const res = await request(app()).get('/camp_001');

    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty('spend');
  });
});
