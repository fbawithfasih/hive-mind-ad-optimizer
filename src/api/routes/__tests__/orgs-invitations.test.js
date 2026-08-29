/**
 * Invitation flow for /api/orgs.
 *
 * The load-bearing assertion here is that holding a valid token is NOT enough
 * to join an org — the accepting session must be the invited address. That is
 * the consent step that replaced the old "admin adds any account by email".
 */
import express from 'express';
import request from 'supertest';

jest.mock('../../../services/email.js', () => ({
  sendOrgInvitationEmail: jest.fn().mockResolvedValue({ id: 'mail-1' }),
}));

jest.mock('../../../db/prisma.js', () => ({
  prisma: {
    organization:  { findUnique: jest.fn(), update: jest.fn() },
    orgMember:     { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), count: jest.fn(), update: jest.fn(), delete: jest.fn() },
    orgInvitation: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
    user:          { findUnique: jest.fn() },
    $transaction:  jest.fn(async (arg) => (typeof arg === 'function' ? arg({}) : Promise.all(arg))),
  },
}));

import { prisma } from '../../../db/prisma.js';
import { sendOrgInvitationEmail } from '../../../services/email.js';
import orgsRouter from '../orgs.js';

const ORG_ID = 'org-1';
const HOUR = 60 * 60 * 1000;

/** Mount the router with a stand-in for requireAuth. */
function makeApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/', orgsRouter);
  return app;
}

// Inviting requires a verified address (requireVerifiedEmail); accepting does
// not — an invitee who hasn't opened their own welcome mail yet can still join.
const admin   = { userId: 'admin-1',   email: 'admin@corp.com', emailVerified: true };
const invitee = { userId: 'invitee-1', email: 'newperson@corp.com' };

const validInvite = (over = {}) => ({
  id: 'inv-1', orgId: ORG_ID, email: 'newperson@corp.com', role: 'MEMBER',
  token: 'tok-abc', invitedBy: 'admin-1',
  createdAt: new Date(), expiresAt: new Date(Date.now() + 48 * HOUR),
  acceptedAt: null, revokedAt: null, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.organization.findUnique.mockResolvedValue({ id: ORG_ID, name: 'Acme' });
  prisma.orgMember.findFirst.mockResolvedValue(null);
  prisma.orgInvitation.deleteMany.mockResolvedValue({ count: 0 });
  prisma.orgInvitation.update.mockResolvedValue({});
  prisma.orgMember.create.mockResolvedValue({});
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /invitations/accept — consent', () => {
  it('REFUSES a valid token when the session is a different address', async () => {
    // Someone forwarded the link, or an admin is trying to accept on the
    // invitee's behalf. Holding the token must not be sufficient.
    prisma.orgInvitation.findUnique.mockResolvedValue(validInvite());

    const res = await request(makeApp(admin))
      .post('/invitations/accept').send({ token: 'tok-abc' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/different email address/i);
    expect(prisma.orgMember.create).not.toHaveBeenCalled();
    expect(prisma.orgInvitation.update).not.toHaveBeenCalled();
  });

  it('accepts when the session IS the invited address, with the invited role', async () => {
    prisma.orgInvitation.findUnique.mockResolvedValue(validInvite({ role: 'VIEWER' }));

    const res = await request(makeApp(invitee))
      .post('/invitations/accept').send({ token: 'tok-abc' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(prisma.orgMember.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ orgId: ORG_ID, userId: 'invitee-1', role: 'VIEWER' }),
      })
    );
  });

  it('matches the address case-insensitively', async () => {
    prisma.orgInvitation.findUnique.mockResolvedValue(validInvite());

    const res = await request(makeApp({ userId: 'invitee-1', email: 'NewPerson@Corp.com' }))
      .post('/invitations/accept').send({ token: 'tok-abc' });

    expect(res.status).toBe(200);
    expect(prisma.orgMember.create).toHaveBeenCalled();
  });

  it.each([
    ['revoked',  { revokedAt: new Date() }],
    ['accepted', { acceptedAt: new Date() }],
    ['expired',  { expiresAt: new Date(Date.now() - HOUR) }],
  ])('rejects a %s invitation', async (_label, over) => {
    prisma.orgInvitation.findUnique.mockResolvedValue(validInvite(over));

    const res = await request(makeApp(invitee))
      .post('/invitations/accept').send({ token: 'tok-abc' });

    expect(res.status).toBe(400);
    expect(prisma.orgMember.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown token', async () => {
    prisma.orgInvitation.findUnique.mockResolvedValue(null);

    const res = await request(makeApp(invitee))
      .post('/invitations/accept').send({ token: 'nope' });

    expect(res.status).toBe(400);
    expect(prisma.orgMember.create).not.toHaveBeenCalled();
  });

  it('does NOT require the accepting user to have verified their own email', async () => {
    // They proved control of the address by being signed in as it; blocking
    // here would strand invitees who haven't opened their welcome mail.
    prisma.orgInvitation.findUnique.mockResolvedValue(validInvite());

    const res = await request(makeApp({ ...invitee, emailVerified: false }))
      .post('/invitations/accept').send({ token: 'tok-abc' });

    expect(res.status).toBe(200);
  });

  it('is idempotent when the user is already a member', async () => {
    prisma.orgInvitation.findUnique.mockResolvedValue(validInvite());
    prisma.orgMember.findFirst.mockResolvedValue({ id: 'om-1', role: 'ADMIN' });

    const res = await request(makeApp(invitee))
      .post('/invitations/accept').send({ token: 'tok-abc' });

    expect(res.status).toBe(200);
    expect(res.body.alreadyMember).toBe(true);
    expect(prisma.orgMember.create).not.toHaveBeenCalled();
    // Invitation is still burned so it can't be reused.
    expect(prisma.orgInvitation.update).toHaveBeenCalled();
  });

  it('is not swallowed by the /:orgId tenant middleware', async () => {
    // Route ordering regression guard: if `/invitations/accept` were registered
    // after `router.use('/:orgId')`, orgId would bind to "invitations".
    prisma.orgInvitation.findUnique.mockResolvedValue(validInvite());

    const res = await request(makeApp(invitee))
      .post('/invitations/accept').send({ token: 'tok-abc' });

    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /:orgId/invitations — issuing', () => {
  /** getAccess() filters by userId; the already-member check filters by user.email. */
  function mockAccess(role) {
    prisma.orgMember.findFirst.mockImplementation(({ where }) => {
      if (where?.userId) return Promise.resolve(role ? { role, org: { id: ORG_ID, name: 'Acme' } } : null);
      return Promise.resolve(null); // not already a member
    });
  }

  it('creates an invitation instead of a membership', async () => {
    mockAccess('ADMIN');
    prisma.orgInvitation.create.mockResolvedValue({
      id: 'inv-1', email: 'new@corp.com', role: 'MEMBER',
      token: 'secret-token', expiresAt: new Date(), createdAt: new Date(),
    });

    const res = await request(makeApp(admin))
      .post(`/${ORG_ID}/invitations`).send({ email: 'new@corp.com', role: 'MEMBER' });

    expect(res.status).toBe(201);
    expect(prisma.orgMember.create).not.toHaveBeenCalled();
    expect(sendOrgInvitationEmail).toHaveBeenCalledWith('new@corp.com', expect.objectContaining({ role: 'MEMBER' }));
  });

  it('never returns the token in the response', async () => {
    mockAccess('ADMIN');
    prisma.orgInvitation.create.mockResolvedValue({
      id: 'inv-1', email: 'new@corp.com', role: 'MEMBER',
      token: 'secret-token', expiresAt: new Date(), createdAt: new Date(),
    });

    const res = await request(makeApp(admin))
      .post(`/${ORG_ID}/invitations`).send({ email: 'new@corp.com' });

    expect(JSON.stringify(res.body)).not.toContain('secret-token');
  });

  it('normalises the invited address', async () => {
    mockAccess('ADMIN');
    prisma.orgInvitation.create.mockResolvedValue({ id: 'i', email: 'new@corp.com', role: 'MEMBER', token: 't', expiresAt: new Date(), createdAt: new Date() });

    await request(makeApp(admin))
      .post(`/${ORG_ID}/invitations`).send({ email: '  New@Corp.com ' });

    expect(prisma.orgInvitation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: 'new@corp.com' }) })
    );
  });

  it('supersedes any earlier pending invitation for the same address', async () => {
    mockAccess('ADMIN');
    prisma.orgInvitation.create.mockResolvedValue({ id: 'i', email: 'new@corp.com', role: 'MEMBER', token: 't', expiresAt: new Date(), createdAt: new Date() });

    await request(makeApp(admin)).post(`/${ORG_ID}/invitations`).send({ email: 'new@corp.com' });

    expect(prisma.orgInvitation.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ email: 'new@corp.com', acceptedAt: null }) })
    );
  });

  it('requires ADMIN', async () => {
    mockAccess('MEMBER');

    const res = await request(makeApp(admin))
      .post(`/${ORG_ID}/invitations`).send({ email: 'new@corp.com' });

    expect(res.status).toBe(403);
    expect(prisma.orgInvitation.create).not.toHaveBeenCalled();
  });

  it('is blocked when the inviting admin has not verified their own email', async () => {
    mockAccess('ADMIN');

    const res = await request(makeApp({ ...admin, emailVerified: false }))
      .post(`/${ORG_ID}/invitations`).send({ email: 'new@corp.com' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
    expect(prisma.orgInvitation.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid role', async () => {
    mockAccess('ADMIN');

    const res = await request(makeApp(admin))
      .post(`/${ORG_ID}/invitations`).send({ email: 'new@corp.com', role: 'OWNER' });

    expect(res.status).toBe(400);
    expect(prisma.orgInvitation.create).not.toHaveBeenCalled();
  });

  it('still issues an invitation for an address with no account yet', async () => {
    // The old route 404'd here, which also leaked account existence to admins.
    mockAccess('ADMIN');
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.orgInvitation.create.mockResolvedValue({ id: 'i', email: 'nobody@corp.com', role: 'MEMBER', token: 't', expiresAt: new Date(), createdAt: new Date() });

    const res = await request(makeApp(admin))
      .post(`/${ORG_ID}/invitations`).send({ email: 'nobody@corp.com' });

    expect(res.status).toBe(201);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /:orgId/invitations', () => {
  it('selects only non-secret fields', async () => {
    prisma.orgMember.findFirst.mockResolvedValue({ role: 'ADMIN', org: { id: ORG_ID } });
    prisma.orgInvitation.findMany.mockResolvedValue([]);

    await request(makeApp(admin)).get(`/${ORG_ID}/invitations`);

    const { select } = prisma.orgInvitation.findMany.mock.calls[0][0];
    expect(select.token).toBeUndefined();
    expect(select.email).toBe(true);
  });

  it('requires ADMIN', async () => {
    prisma.orgMember.findFirst.mockResolvedValue({ role: 'VIEWER', org: { id: ORG_ID } });

    const res = await request(makeApp(admin)).get(`/${ORG_ID}/invitations`);

    expect(res.status).toBe(403);
  });
});
