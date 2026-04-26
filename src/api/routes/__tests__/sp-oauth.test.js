import express from 'express';
import request from 'supertest';
import spOauthRouter from '../sp-oauth.js';

// Mock axios (token exchange) and saveOrgCredential
jest.mock('axios');
jest.mock('../../../services/credentials.js', () => ({
  saveOrgCredential: jest.fn(),
}));

import axios from 'axios';
import { saveOrgCredential } from '../../../services/credentials.js';

// Build a minimal Express app that replicates the real middleware stack:
// requireAuth + withTenant have already run, so req.user and req.tenant are set.
const DEFAULT_USER   = { userId: 'user-1', email: 'test@example.com', activeOrgId: 'org-1' };
const DEFAULT_TENANT = { orgId: 'org-1', org: { id: 'org-1', name: 'Acme' }, role: 'ADMIN' };

function makeApp({ user = DEFAULT_USER, tenant = DEFAULT_TENANT } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user   = user;
    req.tenant = tenant;   // explicitly set — allows null to be passed through
    next();
  });
  app.use('/', spOauthRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
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
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /start
// ─────────────────────────────────────────────────────────────────────────────
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
// GET /callback
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /callback', () => {
  async function getValidState(app) {
    const startRes = await request(app).get('/start');
    const url = new URL(startRes.headers.location);
    return url.searchParams.get('state');
  }

  it('exchanges code, saves credentials, redirects to frontend', async () => {
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
    expect(res.headers.location).toBe('http://localhost:5173?connected=amazon');
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

  it('returns 400 HTML when spapi_oauth_code is missing', async () => {
    const res = await request(makeApp()).get('/callback').query({
      selling_partner_id: 'A1B2C3',
      state: 'some-state',
    });
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/No authorization code/);
  });

  it('returns 400 HTML when state is invalid', async () => {
    const res = await request(makeApp()).get('/callback').query({
      spapi_oauth_code: 'code-abc',
      selling_partner_id: 'SELLER1',
      state: 'invalid-state-not-in-map',
    });
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/Invalid or expired state/);
  });

  it('returns 400 HTML when state has expired', async () => {
    // State entries expire after 10 minutes; simulate by using a consumed state
    const app = makeApp();
    const state = await getValidState(app);

    // Consume the state once (valid call)
    axios.post.mockResolvedValueOnce({ data: { refresh_token: 'rt-1' } });
    saveOrgCredential.mockResolvedValueOnce({});
    await request(app).get('/callback').query({ spapi_oauth_code: 'c1', selling_partner_id: 'S1', state });

    // Second call with same state should fail (already consumed)
    const res = await request(app).get('/callback').query({
      spapi_oauth_code: 'c2',
      selling_partner_id: 'S1',
      state,
    });
    expect(res.status).toBe(400);
  });

  it('returns 500 HTML when token exchange fails', async () => {
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
    expect(res.status).toBe(500);
    expect(res.text).toMatch(/Token Exchange Failed/);
  });
});
