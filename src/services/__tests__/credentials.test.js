jest.mock('../../db/prisma.js', () => ({
  prisma: {
    amazonCredential: {
      upsert:    jest.fn(),
      findFirst: jest.fn(),
      update:    jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../auth-utils.js', () => ({
  invalidateTokenManager: jest.fn(),
}));

import { saveOrgCredential, loadOrgCredential, revokeOrgCredential } from '../credentials.js';
import { prisma } from '../../db/prisma.js';
import { invalidateTokenManager } from '../auth-utils.js';

const { amazonCredential } = prisma;

const ORG_ID = 'org-test-1';
const SP_TOKEN = 'sp-refresh-token-abc';
const SELLER_ID = 'SELLER123';
const ADS_TOKEN = 'ads-refresh-token-xyz';

// Encryption requires ENCRYPTION_KEY
beforeAll(() => {
  process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-ok!';
});

beforeEach(() => {
  jest.clearAllMocks();
  amazonCredential.upsert.mockResolvedValue({ id: 'cred-1' });
  amazonCredential.update.mockResolvedValue({});
});

// ─────────────────────────────────────────────────────────────────────────────
// saveOrgCredential
// ─────────────────────────────────────────────────────────────────────────────

describe('saveOrgCredential', () => {
  it('upserts a credential record', async () => {
    await saveOrgCredential(ORG_ID, { spRefreshToken: SP_TOKEN, sellerId: SELLER_ID });
    expect(amazonCredential.upsert).toHaveBeenCalledTimes(1);
  });

  it('stores an encrypted (not plaintext) refresh token', async () => {
    await saveOrgCredential(ORG_ID, { spRefreshToken: SP_TOKEN, sellerId: SELLER_ID });

    const { create } = amazonCredential.upsert.mock.calls[0][0];
    expect(create.refreshToken).not.toBe(SP_TOKEN);
    expect(typeof create.refreshToken).toBe('string');
  });

  it('stores an encrypted encryptedData blob', async () => {
    await saveOrgCredential(ORG_ID, { spRefreshToken: SP_TOKEN, sellerId: SELLER_ID });

    const { create } = amazonCredential.upsert.mock.calls[0][0];
    expect(create.encryptedData).not.toContain(SELLER_ID);
    expect(typeof create.encryptedData).toBe('string');
  });

  it('does not store a separate adsRefreshToken when it equals spRefreshToken', async () => {
    await saveOrgCredential(ORG_ID, {
      spRefreshToken: SP_TOKEN, sellerId: SELLER_ID, adsRefreshToken: SP_TOKEN,
    });

    const { create } = amazonCredential.upsert.mock.calls[0][0];
    // encryptedData should only contain sellerId, not adsRefreshToken
    const { decrypt } = await import('../../db/encryption.js');
    const extra = JSON.parse(decrypt(create.encryptedData));
    expect(extra.adsRefreshToken).toBeUndefined();
  });

  it('stores a separate adsRefreshToken when it differs from spRefreshToken', async () => {
    await saveOrgCredential(ORG_ID, {
      spRefreshToken: SP_TOKEN, sellerId: SELLER_ID, adsRefreshToken: ADS_TOKEN,
    });

    const { create } = amazonCredential.upsert.mock.calls[0][0];
    const { decrypt } = await import('../../db/encryption.js');
    const extra = JSON.parse(decrypt(create.encryptedData));
    expect(extra.adsRefreshToken).toBe(ADS_TOKEN);
  });

  it('invalidates cached token managers after save', async () => {
    await saveOrgCredential(ORG_ID, { spRefreshToken: SP_TOKEN, sellerId: SELLER_ID });
    expect(invalidateTokenManager).toHaveBeenCalledWith(`sp:${ORG_ID}`);
    expect(invalidateTokenManager).toHaveBeenCalledWith(`ads:${ORG_ID}`);
  });

  it('uses the default US marketplace when none is provided', async () => {
    await saveOrgCredential(ORG_ID, { spRefreshToken: SP_TOKEN, sellerId: SELLER_ID });
    const { create } = amazonCredential.upsert.mock.calls[0][0];
    expect(create.marketplaceId).toBe('ATVPDKIKX0DER');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// loadOrgCredential
// ─────────────────────────────────────────────────────────────────────────────

describe('loadOrgCredential', () => {
  let encryptedToken, encryptedData;

  beforeEach(async () => {
    const { encrypt } = await import('../../db/encryption.js');
    encryptedToken = encrypt(SP_TOKEN);
    encryptedData  = encrypt(JSON.stringify({ sellerId: SELLER_ID }));

    amazonCredential.findFirst.mockResolvedValue({
      id:             'cred-1',
      marketplaceId:  'ATVPDKIKX0DER',
      refreshToken:   encryptedToken,
      encryptedData,
    });
  });

  it('returns null when no credential exists', async () => {
    amazonCredential.findFirst.mockResolvedValue(null);
    expect(await loadOrgCredential(ORG_ID)).toBeNull();
  });

  it('decrypts the spRefreshToken correctly', async () => {
    const cred = await loadOrgCredential(ORG_ID);
    expect(cred.spRefreshToken).toBe(SP_TOKEN);
  });

  it('decrypts sellerId from encryptedData', async () => {
    const cred = await loadOrgCredential(ORG_ID);
    expect(cred.sellerId).toBe(SELLER_ID);
  });

  it('returns null for adsRefreshToken when Ads OAuth not yet completed', async () => {
    const cred = await loadOrgCredential(ORG_ID);
    expect(cred.adsRefreshToken).toBeNull();
  });

  it('returns a separate adsRefreshToken when stored', async () => {
    const { encrypt } = await import('../../db/encryption.js');
    amazonCredential.findFirst.mockResolvedValue({
      id: 'cred-1', marketplaceId: 'ATVPDKIKX0DER',
      refreshToken:  encryptedToken,
      encryptedData: encrypt(JSON.stringify({ sellerId: SELLER_ID, adsRefreshToken: ADS_TOKEN })),
    });

    const cred = await loadOrgCredential(ORG_ID);
    expect(cred.adsRefreshToken).toBe(ADS_TOKEN);
  });

  it('returns null when the refreshToken cannot be decrypted', async () => {
    amazonCredential.findFirst.mockResolvedValue({
      id: 'cred-1', marketplaceId: 'ATVPDKIKX0DER',
      refreshToken:  'not-valid-ciphertext',
      encryptedData: null,
    });
    expect(await loadOrgCredential(ORG_ID)).toBeNull();
  });

  it('continues with defaults when encryptedData cannot be decrypted', async () => {
    const { encrypt } = await import('../../db/encryption.js');
    amazonCredential.findFirst.mockResolvedValue({
      id: 'cred-1', marketplaceId: 'ATVPDKIKX0DER',
      refreshToken:  encrypt(SP_TOKEN),
      encryptedData: 'bad-ciphertext',
    });
    const cred = await loadOrgCredential(ORG_ID);
    // Should still return a credential (with env-var sellerId fallback)
    expect(cred).not.toBeNull();
    expect(cred.spRefreshToken).toBe(SP_TOKEN);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// revokeOrgCredential
// ─────────────────────────────────────────────────────────────────────────────

describe('revokeOrgCredential', () => {
  it('returns null when credential not found', async () => {
    amazonCredential.findFirst.mockResolvedValue(null);
    expect(await revokeOrgCredential(ORG_ID, 'missing-id')).toBeNull();
  });

  it('sets status to REVOKED', async () => {
    amazonCredential.findFirst.mockResolvedValue({ id: 'cred-1', orgId: ORG_ID });
    await revokeOrgCredential(ORG_ID, 'cred-1');
    expect(amazonCredential.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'REVOKED' } })
    );
  });

  it('invalidates both token managers after revoke', async () => {
    amazonCredential.findFirst.mockResolvedValue({ id: 'cred-1', orgId: ORG_ID });
    await revokeOrgCredential(ORG_ID, 'cred-1');
    expect(invalidateTokenManager).toHaveBeenCalledWith(`sp:${ORG_ID}`);
    expect(invalidateTokenManager).toHaveBeenCalledWith(`ads:${ORG_ID}`);
  });
});
