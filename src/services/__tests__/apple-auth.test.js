/**
 * Tests for src/services/apple-auth.js
 *
 * We sign tokens with throwaway in-test keys, then point the module at our
 * own JWKS (via mocked axios) so verifyAppleIdToken exercises the real
 * JWK→PEM conversion + signature check without hitting Apple.
 */

import { generateKeyPairSync } from 'crypto';
import jwt from 'jsonwebtoken';

jest.mock('axios');
import axios from 'axios';

const TEAM_ID   = 'TEAM123ABC';
const KEY_ID    = 'KEY123ABCD';
const CLIENT_ID = 'com.example.signin';

// ES256 key for client_secret (the one we pretend Apple gave us)
const { privateKey: esPrivate, publicKey: _esPublic } =
  generateKeyPairSync('ec', { namedCurve: 'P-256' });
const ES_PRIVATE_PEM = esPrivate.export({ type: 'pkcs8', format: 'pem' });

// RS256 key pair representing Apple's signing key — we put the public key
// into a fake JWKS so verifyAppleIdToken accepts tokens we sign with the
// matching private key.
const { privateKey: rsPrivate, publicKey: rsPublic } =
  generateKeyPairSync('rsa', { modulusLength: 2048 });
const RS_PRIVATE_PEM = rsPrivate.export({ type: 'pkcs8', format: 'pem' });
const APPLE_KID = 'AppleSignInKey';
const FAKE_JWK = { ...rsPublic.export({ format: 'jwk' }), kid: APPLE_KID, alg: 'RS256', use: 'sig' };

function loadModule() {
  let mod;
  jest.isolateModules(() => {
    process.env.APPLE_TEAM_ID     = TEAM_ID;
    process.env.APPLE_KEY_ID      = KEY_ID;
    process.env.APPLE_CLIENT_ID   = CLIENT_ID;
    process.env.APPLE_PRIVATE_KEY = ES_PRIVATE_PEM;
    mod = require('../apple-auth.js');
  });
  return mod;
}

beforeEach(() => {
  jest.clearAllMocks();
  axios.get.mockResolvedValue({ data: { keys: [FAKE_JWK] } });
});

describe('appleConfigured', () => {
  test('true when all four env vars are set', () => {
    const { appleConfigured } = loadModule();
    expect(appleConfigured()).toBe(true);
  });

  test('false when any env var is missing', () => {
    let appleConfigured;
    jest.isolateModules(() => {
      delete process.env.APPLE_TEAM_ID;
      process.env.APPLE_KEY_ID      = KEY_ID;
      process.env.APPLE_CLIENT_ID   = CLIENT_ID;
      process.env.APPLE_PRIVATE_KEY = ES_PRIVATE_PEM;
      ({ appleConfigured } = require('../apple-auth.js'));
    });
    expect(appleConfigured()).toBe(false);
  });
});

describe('getAppleClientSecret', () => {
  test('signs an ES256 JWT with the expected claims and kid header', () => {
    const { getAppleClientSecret } = loadModule();
    const token = getAppleClientSecret();
    const decoded = jwt.decode(token, { complete: true });

    expect(decoded.header.alg).toBe('ES256');
    expect(decoded.header.kid).toBe(KEY_ID);
    expect(decoded.payload.iss).toBe(TEAM_ID);
    expect(decoded.payload.aud).toBe('https://appleid.apple.com');
    expect(decoded.payload.sub).toBe(CLIENT_ID);
    expect(decoded.payload.exp - decoded.payload.iat).toBeLessThanOrEqual(60 * 60 * 24 * 180);
  });

  test('caches the secret across calls', () => {
    const { getAppleClientSecret } = loadModule();
    expect(getAppleClientSecret()).toBe(getAppleClientSecret());
  });
});

describe('verifyAppleIdToken', () => {
  function sign(payload = {}) {
    return jwt.sign(
      {
        iss: 'https://appleid.apple.com',
        aud: CLIENT_ID,
        sub: 'apple-user-001',
        email: 'u@example.com',
        ...payload,
      },
      RS_PRIVATE_PEM,
      { algorithm: 'RS256', expiresIn: '5m', header: { alg: 'RS256', kid: APPLE_KID } }
    );
  }

  test('verifies a well-formed Apple id_token and returns claims', async () => {
    const { verifyAppleIdToken } = loadModule();
    const claims = await verifyAppleIdToken(sign());
    expect(claims.sub).toBe('apple-user-001');
    expect(claims.email).toBe('u@example.com');
  });

  test('rejects tokens with a mismatched audience', async () => {
    const { verifyAppleIdToken } = loadModule();
    await expect(verifyAppleIdToken(sign({ aud: 'com.someone-else.app' })))
      .rejects.toThrow(/audience/);
  });

  test('rejects tokens whose kid is not in the JWKS', async () => {
    const { verifyAppleIdToken } = loadModule();
    const bad = jwt.sign(
      { iss: 'https://appleid.apple.com', aud: CLIENT_ID, sub: 'x' },
      RS_PRIVATE_PEM,
      { algorithm: 'RS256', expiresIn: '5m', header: { alg: 'RS256', kid: 'UnknownKid' } }
    );
    await expect(verifyAppleIdToken(bad)).rejects.toThrow(/No matching Apple JWK/);
  });

  test('rejects tokens missing a kid header', async () => {
    const { verifyAppleIdToken } = loadModule();
    // Hand-craft a header with no kid by using algorithm=none isn't accepted
    // by jwt.sign for RS256; instead build one manually.
    const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'x' })).toString('base64url');
    const fake    = `${header}.${payload}.sig`;
    await expect(verifyAppleIdToken(fake)).rejects.toThrow(/missing kid/);
  });
});
