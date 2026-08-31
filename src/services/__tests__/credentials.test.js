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

import { saveOrgCredential, loadOrgCredential, revokeOrgCredential, updateOrgAdsToken } from '../credentials.js';
import { prisma } from '../../db/prisma.js';
import { encrypt, decrypt } from '../../db/encryption.js';
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

// ─────────────────────────────────────────────────────────────────────────────
// updateOrgAdsToken
//
// Runs when a seller finishes the Ads OAuth flow after the SP-API one. It
// rewrites the encrypted blob in place, so the risk is losing the SP-API
// refresh token that is already in there — that would silently disconnect the
// seller's account and only show up on the next API call.
// ─────────────────────────────────────────────────────────────────────────────

describe('updateOrgAdsToken', () => {
  /** An ACTIVE credential whose encrypted blob already holds the seller id. */
  const existingCredential = () => ({
    id: 'cred-1', orgId: ORG_ID, status: 'ACTIVE',
    encryptedData: encrypt(JSON.stringify({ sellerId: SELLER_ID })),
  });

  it('adds the Ads token without dropping what was already stored', async () => {
    // The blob is rewritten wholesale, so the sellerId already in it is the
    // thing at risk — losing it silently disconnects the seller's account.
    amazonCredential.findFirst.mockResolvedValue(existingCredential());

    await updateOrgAdsToken(ORG_ID, ADS_TOKEN);

    const written = JSON.parse(decrypt(amazonCredential.update.mock.calls[0][0].data.encryptedData));
    expect(written).toEqual({ sellerId: SELLER_ID, adsRefreshToken: ADS_TOKEN });
  });

  it('stamps lastUsed so the credential does not look stale', async () => {
    amazonCredential.findFirst.mockResolvedValue(existingCredential());

    await updateOrgAdsToken(ORG_ID, ADS_TOKEN);

    expect(amazonCredential.update.mock.calls[0][0]).toMatchObject({ where: { id: 'cred-1' } });
    expect(amazonCredential.update.mock.calls[0][0].data.lastUsed).toBeInstanceOf(Date);
  });

  it('does not store the token in plaintext', async () => {
    amazonCredential.findFirst.mockResolvedValue(existingCredential());

    await updateOrgAdsToken(ORG_ID, ADS_TOKEN);

    const written = amazonCredential.update.mock.calls[0][0].data.encryptedData;
    expect(written).not.toContain(ADS_TOKEN);
  });

  it('invalidates the cached Ads token manager', async () => {
    // Without this the old token stays cached until the process restarts, and
    // the seller\'s freshly-authorised account keeps failing.
    amazonCredential.findFirst.mockResolvedValue(existingCredential());

    await updateOrgAdsToken(ORG_ID, ADS_TOKEN);

    expect(invalidateTokenManager).toHaveBeenCalledWith(`ads:${ORG_ID}`);
  });

  it('refuses when the org has no active SP-API credential', async () => {
    amazonCredential.findFirst.mockResolvedValue(null);

    await expect(updateOrgAdsToken(ORG_ID, ADS_TOKEN))
      .rejects.toThrow(/Complete SP-API OAuth first/);
    expect(amazonCredential.update).not.toHaveBeenCalled();
  });

  it('looks only at ACTIVE credentials for the requested marketplace', async () => {
    amazonCredential.findFirst.mockResolvedValue(existingCredential());

    await updateOrgAdsToken(ORG_ID, ADS_TOKEN, 'A1F83G8C2ARO7P');

    expect(amazonCredential.findFirst).toHaveBeenCalledWith({
      where: { orgId: ORG_ID, marketplaceId: 'A1F83G8C2ARO7P', status: 'ACTIVE' },
    });
  });

  it('still stores the token when the existing blob is unreadable', async () => {
    // A blob encrypted under a rotated key should not block re-authorising —
    // better to lose the stale extras than to strand the seller.
    amazonCredential.findFirst.mockResolvedValue({
      id: 'cred-1', orgId: ORG_ID, status: 'ACTIVE', encryptedData: 'not-decryptable',
    });

    await updateOrgAdsToken(ORG_ID, ADS_TOKEN);

    expect(amazonCredential.update).toHaveBeenCalled();
    expect(invalidateTokenManager).toHaveBeenCalledWith(`ads:${ORG_ID}`);
  });

  it('handles a credential with no encrypted blob at all', async () => {
    amazonCredential.findFirst.mockResolvedValue({
      id: 'cred-1', orgId: ORG_ID, status: 'ACTIVE', encryptedData: null,
    });

    await updateOrgAdsToken(ORG_ID, ADS_TOKEN);

    expect(amazonCredential.update.mock.calls[0][0].data.encryptedData).toBeTruthy();
  });
});
