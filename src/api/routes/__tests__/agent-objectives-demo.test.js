/**
 * The sample profile cannot be enrolled: the sweep would ask Amazon about a
 * profile that does not exist there.
 */
import express from 'express';
import request from 'supertest';
import { sharedServer } from '../../../test/http-server.js';

jest.mock('../../../db/prisma.js', () => ({
  prisma: { sellerProfile: { findFirst: jest.fn() }, profileObjective: { upsert: jest.fn() } },
}));
jest.mock('../../middleware/requireAuth.js',          () => ({ requireAuth:          (_r, _s, next) => next() }));
jest.mock('../../middleware/requireVerifiedEmail.js', () => ({ requireVerifiedEmail: (_r, _s, next) => next() }));

import { prisma } from '../../../db/prisma.js';
import agentRouter from '../agent.js';

const serve = sharedServer();
function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = { userId: 'u-1' }; req.tenant = { orgId: 'org-1', role: 'ADMIN', userId: 'u-1' }; next(); });
  a.use('/', agentRouter);
  return serve(a);
}

beforeEach(() => jest.clearAllMocks());

it('refuses to enrol the sample profile', async () => {
  prisma.sellerProfile.findFirst.mockResolvedValue({ id: 'sp', profileId: 'demo-us', isDemo: true });
  const res = await request(app()).put('/objectives/demo-us').send({ enabled: true });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/sample profile/);
  expect(prisma.profileObjective.upsert).not.toHaveBeenCalled();
});

it('still enrols a real one', async () => {
  prisma.sellerProfile.findFirst.mockResolvedValue({ id: 'sp', profileId: '123', isDemo: false });
  prisma.profileObjective.upsert.mockResolvedValue({ profileId: '123', enabled: true, negativeMode: 'SHADOW', promotionMode: 'SHADOW' });
  await request(app()).put('/objectives/123').send({ enabled: true }).expect(200);
});
