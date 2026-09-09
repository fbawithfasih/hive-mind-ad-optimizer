/**
 * When the credential middleware hands a request the sample client.
 *
 * The branches that matter: the sample serves reads when the org has nothing
 * real, on either side of the credential check; it never intercepts a sync,
 * so a demo-only org still hears "Ads not connected"; it refuses writes; and
 * a real profile, or DEMO_DATA=off, switches it off entirely.
 */
jest.mock('../../../db/prisma.js', () => ({
  prisma: { sellerProfile: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(async () => []) } },
}));
jest.mock('../../../services/credentials.js', () => ({ loadOrgCredential: jest.fn() }));
jest.mock('../../../services/amazon-ads.js', () => ({ __esModule: true, createAdsClient: jest.fn(() => ({ real: true, setProfileRegions: jest.fn() })), default: { env: true } }));
jest.mock('../../../services/amazon-sp-api.js', () => ({ __esModule: true, createSpApiClient: jest.fn(() => ({ sp: true })), default: { spEnv: true } }));

import { prisma } from '../../../db/prisma.js';
import { loadOrgCredential } from '../../../services/credentials.js';
import { createAdsClient } from '../../../services/amazon-ads.js';
import { withAmazonCredentials } from '../withAmazonCredentials.js';
import { demoAdsClient } from '../../../services/demo/ads-client.js';

const run = async ({ url = '/api/campaigns', method = 'GET', profileId } = {}) => {
  const req = { tenant: { orgId: 'org-1' }, originalUrl: url, url, method, query: profileId ? { profileId } : {}, body: {} };
  const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
  const next = jest.fn();
  await withAmazonCredentials(req, res, next);
  return { req, res, next };
};

/** Stored profiles: the demo row, and whether a real one exists. */
const profiles = ({ demo = true, real = false } = {}) => {
  prisma.sellerProfile.findUnique.mockResolvedValue(demo ? { isDemo: true } : null);
  prisma.sellerProfile.findFirst.mockImplementation(async ({ where }) => {
    if (where.isDemo === false) return real ? { id: 'real' } : null;
    if (where.isDemo === true)  return demo ? { id: 'demo' } : null;
    return null;
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.DEMO_DATA;
  loadOrgCredential.mockResolvedValue(null);
  profiles();
});

it('serves the sample when the request names it and the org has no credential', async () => {
  const { req, next } = await run({ profileId: 'demo-us' });
  expect(req.adsClient).toBe(demoAdsClient);
  expect(req.hasOwnAdsCreds).toBe(true);
  expect(req.isDemo).toBe(true);
  expect(next).toHaveBeenCalled();
});

it('serves the sample with no profileId when only the sample exists', async () => {
  const { req } = await run();
  expect(req.adsClient).toBe(demoAdsClient);
});

it('keeps the env-default client when a real profile exists and nothing names the sample', async () => {
  profiles({ real: true });
  const { req } = await run();
  expect(req.adsClient).toEqual({ env: true });
  expect(req.isDemo).toBeUndefined();
});

it('serves the sample even when the org has a real Ads token, without building a real client', async () => {
  // Between "connected" and "synced": a token, but only the sample profile.
  loadOrgCredential.mockResolvedValue({ adsRefreshToken: 'rt', adsClientId: 'c', adsClientSecret: 's' });
  const { req } = await run({ profileId: 'demo-us' });
  expect(req.adsClient).toBe(demoAdsClient);
  expect(createAdsClient).not.toHaveBeenCalled();
  expect(req.spClient).toEqual({ sp: true });
});

it('never intercepts a profile sync, so a demo-only org hears the honest 412', async () => {
  loadOrgCredential.mockResolvedValue({ spRefreshToken: 'x' }); // SP but no Ads token
  const { res, next } = await run({ url: '/api/profiles/sync', method: 'POST' });
  expect(res.status).toHaveBeenCalledWith(412);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ADS_NOT_CONNECTED' }));
  expect(next).not.toHaveBeenCalled();
});

it('refuses a write against the sample', async () => {
  const { res, next } = await run({ url: '/api/campaigns/bulk', method: 'PUT', profileId: 'demo-us' });
  expect(res.status).toHaveBeenCalledWith(412);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'DEMO_READ_ONLY' }));
  expect(next).not.toHaveBeenCalled();
});

it('ignores a stale ?profileId=demo-us once the sample row is gone', async () => {
  profiles({ demo: false, real: true });
  const { req } = await run({ profileId: 'demo-us' });
  expect(req.adsClient).not.toBe(demoAdsClient);
});

it('is off entirely under DEMO_DATA=off', async () => {
  process.env.DEMO_DATA = 'off';
  const { req } = await run({ profileId: 'demo-us' });
  expect(req.adsClient).toEqual({ env: true });
  expect(prisma.sellerProfile.findUnique).not.toHaveBeenCalled();
});
