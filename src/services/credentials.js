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

import { prisma } from '../db/prisma.js';
import { encrypt, decrypt } from '../db/encryption.js';
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
  let adsRefreshToken = null; // null until seller completes Ads OAuth separately

  if (cred.encryptedData) {
    try {
      const extra = JSON.parse(decrypt(cred.encryptedData));
      if (extra.sellerId)        sellerId        = extra.sellerId;
      if (extra.adsRefreshToken) adsRefreshToken = extra.adsRefreshToken;
    } catch {
      console.warn(`[credentials] Failed to decrypt encryptedData for org ${orgId} — continuing with defaults`);
    }
  }

  // Mark the credential as recently used. Deliberately unreported: it is
  // telemetry on a hot path, and a failed lastUsed stamp changes nothing.
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
    // Ads API uses its own LWA app (AMAZON_ADS_CLIENT_ID).
    // adsRefreshToken is null when the seller hasn't completed Ads OAuth yet —
    // withAmazonCredentials falls back to defaultAdsClient in that case.
    adsClientId:     adsRefreshToken ? (process.env.AMAZON_ADS_CLIENT_ID ?? '') : '',
    adsClientSecret: adsRefreshToken ? (process.env.AMAZON_ADS_CLIENT_SECRET ?? '') : '',
    adsRefreshToken,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Update Ads token only (separate Ads OAuth flow)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Patch an existing org credential to add/replace the Ads API refresh token.
 * Used when the seller completes the Ads OAuth flow after the SP-API OAuth flow.
 */
export async function updateOrgAdsToken(orgId, adsRefreshToken, marketplaceId = 'ATVPDKIKX0DER') {
  const cred = await prisma.amazonCredential.findFirst({
    where: { orgId, marketplaceId, status: 'ACTIVE' },
  });
  if (!cred) throw new Error('No active SP-API credential found for org. Complete SP-API OAuth first.');

  let extra = {};
  if (cred.encryptedData) {
    try { extra = JSON.parse(decrypt(cred.encryptedData)); } catch {}
  }
  extra.adsRefreshToken = adsRefreshToken;

  await prisma.amazonCredential.update({
    where: { id: cred.id },
    data:  { encryptedData: encrypt(JSON.stringify(extra)), lastUsed: new Date() },
  });

  invalidateTokenManager(`ads:${orgId}`);
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
