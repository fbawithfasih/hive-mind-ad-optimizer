import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { __store } from '../../../services/ephemeral-store.js';
import spOauthRouter from '../sp-oauth.js';

// Mock axios (token exchange) and saveOrgCredential
jest.mock('axios');
// In-memory stand-in for the Redis-backed CSRF nonce store. Keeps the
// start → callback round trip these tests rely on, and lets a failure be
// simulated without a live Redis.
jest.mock('../../../services/ephemeral-store.js', () => {
  const entries = new Map();
  const store = {
    entries,
    failPut: false,
    failTake: false,
    async put(key, value) {
      if (store.failPut) throw new Error('redis unreachable');
      entries.set(key, value);
    },
    async take(key) {
      if (store.failTake) return null;   // the real store fails closed
      const value = entries.get(key);
      entries.delete(key);
      return value ?? null;
    },
  };
  return {
    createEphemeralStore: () => store,
    closeEphemeralStore:  async () => {},
    __store: store,
  };
});

jest.mock('../../../services/credentials.js', () => ({
  saveOrgCredential: jest.fn(),
}));

// withTenant is tested separately; here it's a pass-through so the pre-set
// req.tenant is respected. (/info and /start use the route's own requireAuthNav,
// which reads the hmn_token cookie — makeApp supplies a valid one below.)
jest.mock('../../middleware/withTenant.js', () => ({
  withTenant: (_req, _res, next) => next(),
}));

// requireAuthNav now reads the user row to enforce revocation and the verified
// email gate, so the DB has to be stubbed.
jest.mock('../../../db/prisma.js', () => ({
  prisma: { user: { findUnique: jest.fn() } },
}));

import axios from 'axios';
import { saveOrgCredential } from '../../../services/credentials.js';
import { prisma } from '../../../db/prisma.js';

const DEFAULT_TENANT = { orgId: 'org-1', org: { id: 'org-1', name: 'Acme' }, role: 'ADMIN' };

// Build a minimal app: inject a valid session cookie (so requireAuthNav passes)
// and a pre-set req.tenant (so withTenant's pass-through leaves it in place).
function makeApp({ tenant = DEFAULT_TENANT, claims = {} } = {}) {
  const token = jwt.sign(
    { userId: 'user-1', activeOrgId: 'org-1', ...claims },
    process.env.SESSION_SECRET
  );
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.cookies = { hmn_token: token }; // requireAuthNav reads req.cookies.hmn_token
    req.tenant  = tenant;               // explicitly set — allows null to be passed through
    next();
  });
  app.use('/', spOauthRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue({
    id: 'user-1', email: 'seller@corp.com', emailVerified: true, tokenVersion: 0,
  });
  process.env.SP_API_CLIENT_ID     = 'test-client-id';
  process.env.SP_API_CLIENT_SECRET = 'test-client-secret';
  process.env.SP_SOLUTION_ID       = 'test-solution-id';
  process.env.FRONTEND_URL         = 'http://localhost:5173';
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /info
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /info', () => {
  it('returns config without exposing the secret', async () => {
    const res = await request(makeApp()).get('/info');
    expect(res.status).toBe(200);
    expect(res.body.client_id).toBe('test-client-id');
    expect(res.body.has_secret).toBe(true);
    expect(res.body).not.toHaveProperty('client_secret');
  });

  it('includes current org from req.tenant', async () => {
    const res = await request(makeApp()).get('/info');
    expect(res.body.current_org).toBe('org-1');
  });

  it('redirects to login when no session cookie is present', async () => {
    const app = express();
    app.use((req, _res, next) => { req.cookies = {}; req.tenant = DEFAULT_TENANT; next(); });
    app.use('/', spOauthRouter);
    const res = await request(app).get('/info');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/login$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /start
// ─────────────────────────────────────────────────────────────────────────────
/** Run /start and return the CSRF nonce it issued. */
async function getStartState(app) {
  const res = await request(app).get('/start');
  return new URL(res.headers.location).searchParams.get('state');
}

describe('the CSRF nonce store', () => {
  it('refuses to start the flow when the nonce cannot be stored', async () => {
    // Sending the seller to Amazon with a nonce we cannot verify guarantees a
    // failure on their return, by which point the message is Amazon's, not ours.
    __store.failPut = true;
    try {
      const res = await request(makeApp()).get('/start');
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/state_store_unavailable/);
      expect(res.headers.location).not.toMatch(/sellercentral/);
    } finally {
      __store.failPut = false;
    }
  });

  it('fails closed when the store cannot be read', async () => {
    const app = makeApp();
    const state = await getStartState(app);
    __store.failTake = true;
    try {
      const res = await request(app).get(`/callback?spapi_oauth_code=c&state=${state}`);
      expect(res.headers.location).toMatch(/invalid_state/);
    } finally {
      __store.failTake = false;
    }
  });

  it('consumes a nonce exactly once', async () => {
    const app = makeApp();
    const state = await getStartState(app);

    await request(app).get(`/callback?spapi_oauth_code=c&state=${state}`);
    const replay = await request(app).get(`/callback?spapi_oauth_code=c&state=${state}`);

    expect(replay.headers.location).toMatch(/invalid_state/);
  });

  it('survives a restart mid-flow, because the nonce is not in this process', async () => {
    // The whole point of moving it out of a Map: the state issued by one app
    // instance is accepted by another.
    const state = await getStartState(makeApp());

    const res = await request(makeApp()).get(`/callback?spapi_oauth_code=c&state=${state}`);

    expect(res.headers.location).not.toMatch(/invalid_state/);
  });
});

describe('GET /start', () => {
  it('redirects to Amazon Seller Central consent URL', async () => {
    const res = await request(makeApp()).get('/start');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/sellercentral\.amazon\.com\/apps\/authorize\/consent/);
  });

  it('includes application_id and state in redirect URL', async () => {
    const res = await request(makeApp()).get('/start');
    const url = new URL(res.headers.location);
    expect(url.searchParams.get('application_id')).toBe('test-solution-id');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('state').length).toBeGreaterThan(10);
  });

  it('uses crypto state (not Math.random) — state is hex string', async () => {
    const res = await request(makeApp()).get('/start');
    const url = new URL(res.headers.location);
    const state = url.searchParams.get('state');
    expect(state).toMatch(/^[0-9a-f]+$/);
    expect(state.length).toBe(32); // 16 bytes → 32 hex chars
  });

  it('returns 500 when SP_API_CLIENT_ID is not set', async () => {
    delete process.env.SP_API_CLIENT_ID;
    const res = await request(makeApp()).get('/start');
    expect(res.status).toBe(500);
  });

  it('returns 500 when SP_API_CLIENT_SECRET is not set', async () => {
    delete process.env.SP_API_CLIENT_SECRET;
    const res = await request(makeApp()).get('/start');
    expect(res.status).toBe(500);
  });

  it('returns 400 when req.tenant has no orgId', async () => {
    const app = makeApp({ tenant: null });
    const res = await request(app).get('/start');
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /callback — note: errors REDIRECT (302) to the frontend error page with a
// sanitised reason code (XSS-safe), they no longer render HTML.
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /callback', () => {
  async function getValidState(app) {
    const startRes = await request(app).get('/start');
    const url = new URL(startRes.headers.location);
    return url.searchParams.get('state');
  }

  it('exchanges code, saves credentials, redirects to ads-start', async () => {
    const app = makeApp();
    const state = await getValidState(app);

    axios.post.mockResolvedValueOnce({ data: { refresh_token: 'rt-abc123' } });
    saveOrgCredential.mockResolvedValueOnce({ id: 'cred-1' });

    const res = await request(app).get('/callback').query({
      spapi_oauth_code: 'auth-code-xyz',
      selling_partner_id: 'A1B2C3D4',
      state,
    });

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/api\/sp-oauth\/ads-start$/);
    expect(saveOrgCredential).toHaveBeenCalledWith('org-1', {
      spRefreshToken: 'rt-abc123',
      sellerId: 'A1B2C3D4',
    });
  });

  it('posts correct params to Amazon token endpoint', async () => {
    const app = makeApp();
    const state = await getValidState(app);

    axios.post.mockResolvedValueOnce({ data: { refresh_token: 'rt-xyz' } });
    saveOrgCredential.mockResolvedValueOnce({});

    await request(app).get('/callback').query({
      spapi_oauth_code: 'code-abc',
      selling_partner_id: 'SELLER1',
      state,
    });

    expect(axios.post).toHaveBeenCalledWith(
      'https://api.amazon.com/auth/o2/token',
      expect.any(URLSearchParams),
      expect.any(Object)
    );
    const body = axios.post.mock.calls[0][1];
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('code-abc');
    expect(body.get('client_id')).toBe('test-client-id');
  });

  it('redirects to error page when spapi_oauth_code is missing', async () => {
    const res = await request(makeApp()).get('/callback').query({
      selling_partner_id: 'A1B2C3',
      state: 'some-state',
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/auth\/spapi\/error\?reason=no_authorization_code/);
  });

  it('redirects to error page when state is invalid', async () => {
    const res = await request(makeApp()).get('/callback').query({
      spapi_oauth_code: 'code-abc',
      selling_partner_id: 'SELLER1',
      state: 'invalid-state-not-in-map',
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/auth\/spapi\/error\?reason=invalid_state/);
  });

  it('rejects a state that has already been consumed', async () => {
    const app = makeApp();
    const state = await getValidState(app);

    // Consume the state once (valid call)
    axios.post.mockResolvedValueOnce({ data: { refresh_token: 'rt-1' } });
    saveOrgCredential.mockResolvedValueOnce({});
    await request(app).get('/callback').query({ spapi_oauth_code: 'c1', selling_partner_id: 'S1', state });

    // Second call with the same state must fail (single-use)
    const res = await request(app).get('/callback').query({
      spapi_oauth_code: 'c2',
      selling_partner_id: 'S1',
      state,
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/auth\/spapi\/error\?reason=invalid_state/);
  });

  it('redirects to error page when token exchange fails', async () => {
    const app = makeApp();
    const state = await getValidState(app);

    axios.post.mockRejectedValueOnce(Object.assign(new Error('LWA error'), {
      response: { data: { error: 'invalid_grant' } },
    }));

    const res = await request(app).get('/callback').query({
      spapi_oauth_code: 'bad-code',
      selling_partner_id: 'S1',
      state,
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/auth\/spapi\/error\?reason=token_exchange_failed/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// requireAuthNav / requireVerifiedEmailNav
// ─────────────────────────────────────────────────────────────────────────────
describe('navigation auth gates', () => {
  it('redirects an unverified user away from /start', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1', email: 'seller@corp.com', emailVerified: false, tokenVersion: 0,
    });

    const res = await request(makeApp()).get('/start');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/auth/spapi/error?reason=email_unverified');
  });

  it('redirects an unverified user away from /ads-start', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1', email: 'seller@corp.com', emailVerified: false, tokenVersion: 0,
    });

    const res = await request(makeApp()).get('/ads-start');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('reason=email_unverified');
  });

  it('redirects to login when the session has been revoked', async () => {
    // Password reset bumped tokenVersion; this cookie predates it.
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1', email: 'seller@corp.com', emailVerified: true, tokenVersion: 3,
    });

    const res = await request(makeApp({ claims: { tokenVersion: 1 } })).get('/start');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/login');
  });

  it('redirects to login when the user no longer exists', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await request(makeApp()).get('/start');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/login');
  });

  it('redirects to login past the absolute session cap', async () => {
    const eightDaysAgo = Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60;

    const res = await request(makeApp({ claims: { authAt: eightDaysAgo } })).get('/start');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/login');
  });

  it('leaves the read-only /info route open to unverified users', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1', email: 'seller@corp.com', emailVerified: false, tokenVersion: 0,
    });

    const res = await request(makeApp()).get('/info');

    expect(res.status).toBe(200);
  });
});
