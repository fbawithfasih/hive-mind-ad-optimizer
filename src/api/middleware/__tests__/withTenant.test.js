import { withTenant } from '../withTenant.js';

jest.mock('../../../db/prisma.ts', () => ({
  prisma: {
    orgMember: {
      findFirst: jest.fn(),
    },
  },
}));

import { prisma } from '../../../db/prisma.ts';

function makeRes() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

const MEMBERSHIP = {
  orgId: 'org-1',
  role: 'ADMIN',
  org: { id: 'org-1', name: 'Acme' },
};

const BASE_USER = { userId: 'user-1', email: 'test@example.com', activeOrgId: 'org-1' };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('org_id resolution', () => {
  it('uses query param org_id when provided', async () => {
    prisma.orgMember.findFirst.mockResolvedValue(MEMBERSHIP);
    const req = { query: { org_id: 'org-q' }, body: {}, user: BASE_USER };
    const res = makeRes();
    const next = jest.fn();

    await withTenant(req, res, next);

    expect(prisma.orgMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-q' }) })
    );
    expect(next).toHaveBeenCalled();
  });

  it('uses body org_id when query is absent', async () => {
    prisma.orgMember.findFirst.mockResolvedValue(MEMBERSHIP);
    const req = { query: {}, body: { org_id: 'org-b' }, user: BASE_USER };

    await withTenant(req, makeRes(), jest.fn());

    expect(prisma.orgMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-b' }) })
    );
  });

  it('falls back to JWT activeOrgId when query and body are absent', async () => {
    prisma.orgMember.findFirst.mockResolvedValue(MEMBERSHIP);
    const req = { query: {}, body: {}, user: { ...BASE_USER, activeOrgId: 'org-jwt' } };

    await withTenant(req, makeRes(), jest.fn());

    expect(prisma.orgMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-jwt' }) })
    );
  });

  it('queries first membership when activeOrgId is null (old token)', async () => {
    const firstMembership = { orgId: 'org-first' };
    prisma.orgMember.findFirst
      .mockResolvedValueOnce(firstMembership)  // first membership lookup
      .mockResolvedValueOnce(MEMBERSHIP);       // access validation

    const req = { query: {}, body: {}, user: { userId: 'user-1', activeOrgId: null } };
    const next = jest.fn();

    await withTenant(req, makeRes(), next);

    expect(prisma.orgMember.findFirst).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenCalled();
  });
});

describe('error responses', () => {
  it('returns 400 when no org can be resolved (no memberships)', async () => {
    prisma.orgMember.findFirst.mockResolvedValue(null);
    const req = { query: {}, body: {}, user: { userId: 'user-1', activeOrgId: null } };
    const res = makeRes();

    await withTenant(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 403 when user is not a member of requested org', async () => {
    // First call (first membership fallback) would need activeOrgId present, so set it
    prisma.orgMember.findFirst.mockResolvedValue(null);
    const req = { query: { org_id: 'org-forbidden' }, body: {}, user: BASE_USER };
    const res = makeRes();

    await withTenant(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 500 on unexpected error', async () => {
    prisma.orgMember.findFirst.mockRejectedValue(new Error('DB connection lost'));
    const req = { query: {}, body: {}, user: BASE_USER };
    const res = makeRes();

    await withTenant(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('successful attach', () => {
  it('attaches req.tenant with orgId, org, role, and userId', async () => {
    prisma.orgMember.findFirst.mockResolvedValue(MEMBERSHIP);
    const req = { query: {}, body: {}, user: BASE_USER };
    const next = jest.fn();

    await withTenant(req, makeRes(), next);

    expect(req.tenant).toEqual({
      orgId: 'org-1',
      org: MEMBERSHIP.org,
      role: 'ADMIN',
      userId: 'user-1',
    });
    expect(next).toHaveBeenCalled();
  });
});
