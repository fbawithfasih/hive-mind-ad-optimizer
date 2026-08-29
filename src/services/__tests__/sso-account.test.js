// uuid v13 ships ESM only and jest does not transform node_modules. It is used
// here solely to mint ids for new accounts. (Same shim as auth-tenant-context.)
jest.mock('uuid', () => ({ v4: () => 'test-uuid-0000' }));

jest.mock('../../db/prisma.js', () => ({
  prisma: {
    user: {
      findFirst:  jest.fn(),
      findUnique: jest.fn(),
      update:     jest.fn(),
      create:     jest.fn(),
    },
  },
}));

import { resolveSsoUser, claimIsTrue } from '../sso-account.js';
import { prisma } from '../../db/prisma.js';

beforeEach(() => {
  jest.clearAllMocks();
  prisma.user.findFirst.mockResolvedValue(null);
  prisma.user.findUnique.mockResolvedValue(null);
  prisma.user.update.mockImplementation(({ where, data }) =>
    Promise.resolve({ id: where.id, ...data })
  );
  prisma.user.create.mockImplementation(({ data }) => Promise.resolve(data));
});

const googleLogin = (over = {}) => resolveSsoUser({
  provider: 'google',
  providerId: 'google-sub-1',
  email: 'victim@corp.com',
  emailVerified: true,
  profile: { firstName: 'V', lastName: 'Ictim', avatar: 'https://x/a.png' },
  ...over,
});

describe('claimIsTrue', () => {
  it('accepts a real boolean true and the string "true"', () => {
    expect(claimIsTrue(true)).toBe(true);
    expect(claimIsTrue('true')).toBe(true);
  });

  it('rejects everything else', () => {
    for (const v of [false, 'false', undefined, null, 0, '', 'yes']) {
      expect(claimIsTrue(v)).toBe(false);
    }
  });
});

describe('resolveSsoUser — known provider identity', () => {
  it('logs in without consulting the email branch at all', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'u1', email: 'victim@corp.com', emailVerified: true,
    });

    const res = await googleLogin();

    expect(res.ok).toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('does not overwrite profile fields that are already set', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'u1', email: 'victim@corp.com', emailVerified: true,
      firstName: 'Existing', avatar: 'https://x/keep.png',
    });

    await googleLogin();

    const { data } = prisma.user.update.mock.calls[0][0];
    expect(data.firstName).toBeUndefined();
    expect(data.avatar).toBeUndefined();
    expect(data.lastName).toBe('Ictim');
  });
});

describe('resolveSsoUser — linking to an existing email account', () => {
  it('REFUSES to link when the local account never verified its email', async () => {
    // The pre-hijack: attacker registered victim@corp.com with their own
    // password and could not verify it. The victim's first Google login must
    // not merge into that row.
    prisma.user.findUnique.mockResolvedValue({
      id: 'attacker-row', email: 'victim@corp.com',
      emailVerified: false, passwordHash: 'attacker-chosen-hash',
    });

    const res = await googleLogin({ emailVerified: true });

    expect(res).toEqual({ ok: false, reason: 'link_requires_login' });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('REFUSES to link when the provider does not vouch for the address', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1', email: 'victim@corp.com', emailVerified: true,
    });

    const res = await googleLogin({ emailVerified: false });

    expect(res).toEqual({ ok: false, reason: 'link_requires_login' });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('links when both the provider and the local account verified the address', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1', email: 'victim@corp.com', emailVerified: true,
    });

    const res = await googleLogin({ emailVerified: true });

    expect(res.ok).toBe(true);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data:  expect.objectContaining({ googleId: 'google-sub-1' }),
      })
    );
  });

  it('links the appleId column for Apple logins', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1', email: 'victim@corp.com', emailVerified: true,
    });

    await resolveSsoUser({
      provider: 'apple', providerId: 'apple-sub-1',
      email: 'victim@corp.com', emailVerified: true,
    });

    const { data } = prisma.user.update.mock.calls[0][0];
    expect(data.appleId).toBe('apple-sub-1');
    expect(data.googleId).toBeUndefined();
  });
});

describe('resolveSsoUser — new account', () => {
  it('creates a verified account when the provider vouches for the address', async () => {
    const res = await googleLogin({ emailVerified: true });

    expect(res.ok).toBe(true);
    const { data } = prisma.user.create.mock.calls[0][0];
    expect(data.emailVerified).toBe(true);
    expect(data.emailVerifiedAt).toBeInstanceOf(Date);
    expect(data.googleId).toBe('google-sub-1');
    expect(data.passwordHash).toBeNull();
  });

  it('creates an UNVERIFIED account when the provider does not vouch', async () => {
    // Otherwise the fresh account would be pre-blessed for future linking on an
    // address nobody has proven they own.
    const res = await googleLogin({ emailVerified: false });

    expect(res.ok).toBe(true);
    const { data } = prisma.user.create.mock.calls[0][0];
    expect(data.emailVerified).toBe(false);
    expect(data.emailVerifiedAt).toBeNull();
  });
});

describe('resolveSsoUser — misuse', () => {
  it('throws on an unknown provider rather than writing to an undefined column', async () => {
    await expect(resolveSsoUser({
      provider: 'facebook', providerId: 'x', email: 'a@b.com', emailVerified: true,
    })).rejects.toThrow('Unknown SSO provider');
  });
});
