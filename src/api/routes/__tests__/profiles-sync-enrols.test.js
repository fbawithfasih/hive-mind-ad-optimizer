/**
 * The first sync enrols; nothing about it can fail the sync.
 */
import express from 'express';
import request from 'supertest';
import { sharedServer } from '../../../test/http-server.js';

jest.mock('../../../db/prisma.js', () => ({
  prisma: {
    sellerProfile: {
      findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []),
      upsert: jest.fn(async ({ create }) => ({ ...create, id: 'sp-' + create.profileId })),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
  },
}));
jest.mock('../../../services/plan-limits.js',     () => ({ applyProfileCap: jest.fn(async (_o, raw) => ({ limited: raw, skipped: [] })) }));
jest.mock('../../../services/demo/seed.js',       () => ({ removeDemoProfile: jest.fn(async () => ({ profiles: 0, runs: 0 })) }));
jest.mock('../../../services/agent/enrolment.js', () => ({ enrolOnFirstSync: jest.fn(async () => ({ enrolled: true, profileId: '777', jobId: 'j' })) }));
jest.mock('../../middleware/requireRole.js',      () => ({ requireRole: () => (_r, _s, next) => next() }));

import { enrolOnFirstSync } from '../../../services/agent/enrolment.js';
import profilesRouter from '../profiles.js';

const serve = sharedServer();
function app(getProfiles) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.user = { userId: 'u-1' }; req.tenant = { orgId: 'org-1', role: 'ADMIN' };
    req.adsClient = { getProfiles };
    next();
  });
  a.use('/', profilesRouter);
  return serve(a);
}

const amazon = [{ profileId: 777, countryCode: 'US', accountInfo: { id: 'A1', name: 'Aarohi' } }];

beforeEach(() => jest.clearAllMocks());

it('enrols with the profiles it just saved and reports it', async () => {
  const res = await request(app(async () => amazon)).post('/sync').expect(200);
  expect(enrolOnFirstSync).toHaveBeenCalledWith({ orgId: 'org-1', profiles: [expect.objectContaining({ profileId: '777' })] });
  expect(res.body.enrolment).toEqual({ enrolled: true, profileId: '777', jobId: 'j' });
});

it('never enrols when Amazon returns nothing', async () => {
  await request(app(async () => [])).post('/sync').expect(200);
  expect(enrolOnFirstSync).not.toHaveBeenCalled();
});

it('still answers 200 with the profiles when enrolment throws', async () => {
  enrolOnFirstSync.mockRejectedValueOnce(new Error('db hiccup'));
  const res = await request(app(async () => amazon)).post('/sync').expect(200);
  expect(res.body.synced).toBe(1);
  expect(res.body.enrolment).toBeNull();
});
