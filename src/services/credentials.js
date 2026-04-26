/**
 * Per-org Amazon credential management
 *
 * Design:
 *   AmazonCredential.refreshToken  = encrypted SP-API refresh token (per seller)
 *   AmazonCredential.encryptedData = encrypted JSON: { sellerId, adsRefreshToken? }
 *
 * In the Amazon SPN model the CLIENT_ID and CLIENT_SECRET belong to the SPN app
 * (shared across all connected sellers).  Only the refresh token and seller ID are
 * per-seller and therefore stored per-org in the database.
 *
 * The Ads API and SP-API typically share the same LWA refresh token when the seller
 * authorises via a single SPN OAuth flow.  If they differ (e.g. a separate Ads-only
 * grant), pass adsRefreshToken separately.
 */

import { prisma } from '../db/prisma.ts';
import { encrypt, decrypt } from '../db/encryption.ts';
import { invalidateTokenManager } from './auth-utils.js';

// ─────────────────────────────────────────────────────────────────────────────
// Save
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encrypt and upsert Amazon credentials for an org.
 *
 * @param {string} orgId
 * @param {object} params
 * @param {string} params.spRefreshToken  - SP-API refresh token
 * @param {string} params.sellerId        - Amazon Seller/Partner ID
 * @param {string} [params.adsRefreshToken] - Ads API refresh token (defaults to spRefreshToken)
 * @param {string} [params.marketplaceId]   - Amazon marketplace ID (default: US)
 */
export async function saveOrgCredential(orgId, {
  spRefreshToken,
  sellerId,
  adsRefreshToken,
  marketplaceId = 'ATVPDKIKX0DER',
}) {
  const encryptedRefreshToken = encrypt(spRefreshToken);

  const extra = { sellerId };
  // Only store a separate Ads token if it actually differs
  if (adsRefreshToken && adsRefreshToken !== spRefreshToken) {
    extra.adsRefreshToken = adsRefreshToken;
  }
  const encryptedData = encrypt(JSON.stringify(extra));

  const record = await prisma.amazonCredential.upsert({
    where: { orgId_marketplaceId: { orgId, marketplaceId } },
    create: {
      orgId,
      refreshToken:  encryptedRefreshToken,
      marketplaceId,
      encryptedData,
      status:        'ACTIVE',
      connectedAt:   new Date(),
    },
    update: {
      refreshToken:  encryptedRefreshToken,
      encryptedData,
      status:        'ACTIVE',
      connectedAt:   new Date(),
      lastUsed:      new Date(),
    },
  });

  // Invalidate any cached token managers so the new token is picked up immediately
  invalidateTokenManager(`sp:${orgId}`);
  invalidateTokenManager(`ads:${orgId}`);

  return record;
}

// ─────────────────────────────────────────────────────────────────────────────
// Load
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load and decrypt the active credential for an org.
 *
 * Returns null if no credential is stored (caller should fall back to env vars).
 *
 * @param {string} orgId
 * @returns {Promise<OrgCredential|null>}
 *
 * @typedef {object} OrgCredential
 * @property {string} credentialId
 * @property {string} marketplaceId
 * @property {string} spClientId      - From env (shared app credential)
 * @property {string} spClientSecret  - From env (shared app credential)
 * @property {string} spRefreshToken  - Decrypted per-org token
 * @property {string} sellerId        - Decrypted per-org seller ID
 * @property {string} adsClientId     - From env (shared app credential)
 * @property {string} adsClientSecret - From env (shared app credential)
 * @property {string} adsRefreshToken - Decrypted per-org token (may equal spRefreshToken)
 */
export async function loadOrgCredential(orgId) {
  const cred = await prisma.amazonCredential.findFirst({
    where: { orgId, status: 'ACTIVE' },
    orderBy: { connectedAt: 'desc' },
  });

  if (!cred) return null;

  // Decrypt the primary refresh token
  let spRefreshToken;
  try {
    spRefreshToken = decrypt(cred.refreshToken);
  } catch {
    console.error(`[credentials] Failed to decrypt refreshToken for org ${orgId}`);
    return null;
  }

  // Decrypt supplementary fields
  let sellerId = process.env.SP_API_SELLER_ID ?? null;
  let adsRefreshToken = spRefreshToken; // default: same token

  if (cred.encryptedData) {
    try {
      const extra = JSON.parse(decrypt(cred.encryptedData));
      if (extra.sellerId)        sellerId        = extra.sellerId;
      if (extra.adsRefreshToken) adsRefreshToken = extra.adsRefreshToken;
    } catch {
      console.warn(`[credentials] Failed to decrypt encryptedData for org ${orgId} — continuing with defaults`);
    }
  }

  // Mark the credential as recently used (fire-and-forget)
  prisma.amazonCredential.update({
    where: { id: cred.id },
    data:  { lastUsed: new Date() },
  }).catch(() => {});

  return {
    credentialId:  cred.id,
    marketplaceId: cred.marketplaceId,
    // SP-API (Listing Items, Catalog Items, etc.)
    spClientId:     process.env.SP_API_CLIENT_ID    ?? '',
    spClientSecret: process.env.SP_API_CLIENT_SECRET ?? '',
    spRefreshToken,
    sellerId,
    // Amazon Ads API — prefer dedicated AMAZON_ADS_* vars; fall back to SP_API credentials
    // (in the SPN model the same LWA app covers both APIs with the same refresh token)
    adsClientId:     process.env.AMAZON_ADS_CLIENT_ID     ?? process.env.SP_API_CLIENT_ID     ?? '',
    adsClientSecret: process.env.AMAZON_ADS_CLIENT_SECRET ?? process.env.SP_API_CLIENT_SECRET ?? '',
    adsRefreshToken,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Revoke
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mark a credential as REVOKED and clear cached token managers.
 */
export async function revokeOrgCredential(orgId, credentialId) {
  const cred = await prisma.amazonCredential.findFirst({
    where: { id: credentialId, orgId },
  });
  if (!cred) return null;

  await prisma.amazonCredential.update({
    where: { id: credentialId },
    data:  { status: 'REVOKED' },
  });

  invalidateTokenManager(`sp:${orgId}`);
  invalidateTokenManager(`ads:${orgId}`);

  return true;
}
