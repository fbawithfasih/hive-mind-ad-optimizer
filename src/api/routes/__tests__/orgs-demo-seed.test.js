/**
 * A new org gets the sample seller, inside the same transaction that creates it.
 */
import express from 'express';
import request from 'supertest';
import { sharedServer } from '../../../test/http-server.js';

const tx = {
  organization: { create: jest.fn(async () => ({ id: 'org-new', name: 'New' })) },
  orgMember:    { create: jest.fn(async () => ({})) },
};
jest.mock('../../../db/prisma.js', () => ({
  prisma: {
    organization: { findUnique: jest.fn(async () => null) },
    orgMember:    { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
    user:         { findUnique: jest.fn(async () => null) },
    $transaction: jest.fn(async (fn) => fn(globalThis.__tx)),
  },
}));
jest.mock('../../../services/demo/seed.js', () => ({ seedDemoProfile: jest.fn(async () => ({ seeded: true, decisions: 17 })) }));
jest.mock('../../../services/trial-lifecycle.js', () => ({ sendTrialWelcome: jest.fn(async () => 'sent') }), { virtual: true });

import { seedDemoProfile } from '../../../services/demo/seed.js';
import orgsRouter from '../orgs.js';

globalThis.__tx = tx;
const serve = sharedServer();
function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = { userId: 'u-1', email: 'a@b.com' }; next(); });
  a.use('/', orgsRouter);
  return serve(a);
}

beforeEach(() => { jest.clearAllMocks(); delete process.env.DEMO_DATA; });

it('seeds the sample with the transaction client and the new org id', async () => {
  await request(app()).post('/').send({ name: 'Aarohi' }).expect(201);
  expect(seedDemoProfile).toHaveBeenCalledWith(tx, 'org-new');
});

it('seeds nothing under DEMO_DATA=off', async () => {
  process.env.DEMO_DATA = 'off';
  await request(app()).post('/').send({ name: 'Aarohi' }).expect(201);
  expect(seedDemoProfile).not.toHaveBeenCalled();
});
