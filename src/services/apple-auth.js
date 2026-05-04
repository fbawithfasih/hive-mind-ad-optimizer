import jwt from 'jsonwebtoken';
import { createPublicKey } from 'crypto';
import axios from 'axios';

const APPLE_ISSUER   = 'https://appleid.apple.com';
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';

const APPLE_TEAM_ID     = process.env.APPLE_TEAM_ID;
const APPLE_KEY_ID      = process.env.APPLE_KEY_ID;
const APPLE_CLIENT_ID   = process.env.APPLE_CLIENT_ID;
const APPLE_PRIVATE_KEY = (process.env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

export function appleConfigured() {
  return Boolean(APPLE_TEAM_ID && APPLE_KEY_ID && APPLE_CLIENT_ID && APPLE_PRIVATE_KEY);
}

// ── client_secret JWT (ES256) ────────────────────────────────────────────────
// Apple requires the OAuth client_secret to be a short-lived JWT we sign with
// our .p8 private key. Cache aggressively — Apple allows up to 6 months.

let cachedSecret = null;
let cachedSecretExp = 0;

export function getAppleClientSecret() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedSecret && cachedSecretExp - now > 60 * 60) return cachedSecret;

  const exp = now + 60 * 60 * 24 * 150; // 150 days, well under Apple's 180-day cap
  const token = jwt.sign(
    { iss: APPLE_TEAM_ID, iat: now, exp, aud: APPLE_ISSUER, sub: APPLE_CLIENT_ID },
    APPLE_PRIVATE_KEY,
    { algorithm: 'ES256', header: { alg: 'ES256', kid: APPLE_KEY_ID } }
  );
  cachedSecret = token;
  cachedSecretExp = exp;
  return token;
}

// ── id_token verification via Apple JWKS (RS256) ─────────────────────────────

let cachedJwks = null;
let cachedJwksAt = 0;
const JWKS_TTL_MS = 24 * 60 * 60 * 1000;

async function fetchJwks() {
  if (cachedJwks && Date.now() - cachedJwksAt < JWKS_TTL_MS) return cachedJwks;
  const { data } = await axios.get(APPLE_JWKS_URL, { timeout: 5000 });
  cachedJwks = data.keys;
  cachedJwksAt = Date.now();
  return cachedJwks;
}

export async function verifyAppleIdToken(idToken) {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded?.header?.kid) throw new Error('id_token missing kid');

  const keys = await fetchJwks();
  const jwk = keys.find(k => k.kid === decoded.header.kid);
  if (!jwk) throw new Error(`No matching Apple JWK for kid ${decoded.header.kid}`);

  const pem = createPublicKey({ key: jwk, format: 'jwk' })
    .export({ type: 'spki', format: 'pem' });

  return jwt.verify(idToken, pem, {
    algorithms: ['RS256'],
    audience:   APPLE_CLIENT_ID,
    issuer:     APPLE_ISSUER,
  });
}
