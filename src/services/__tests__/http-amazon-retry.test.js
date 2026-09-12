/**
 * What happens when Amazon says "slow down".
 *
 * A 429 used to be indistinguishable from any other failure: it propagated
 * out of the client, burned a BullMQ attempt, and in the report pollers
 * counted as a failed poll. These pin the two halves of the fix — the policy
 * about which failures may be repeated, and the interceptor that repeats them.
 */
jest.mock('../amazon-rate-limit.js', () => ({ acquireAdsSlot: jest.fn(async () => 0) }));

import { http, shouldRetry, retryAfterMs, MAX_RETRIES, MAX_BACKOFF_MS } from '../http.js';
import { acquireAdsSlot } from '../amazon-rate-limit.js';

const realAdapter = http.defaults.adapter;
afterEach(() => { http.defaults.adapter = realAdapter; });
beforeEach(() => jest.clearAllMocks());

/** An axios-shaped failure. */
const fail = (status, headers = {}) => (config) => Promise.reject(
  Object.assign(new Error(`Request failed with status code ${status}`), {
    config, isAxiosError: true, response: { status, headers, data: {} },
  }),
);
const ok = (config) => Promise.resolve({ status: 200, data: { ok: true }, headers: {}, config });

describe('which failures may be repeated', () => {
  it('always repeats a 429 — a throttled request was rejected before it did anything', () => {
    for (const method of ['get', 'post', 'put', 'delete']) {
      expect(shouldRetry({ response: { status: 429 }, config: { method } })).toBe(true);
    }
  });

  it('repeats a 5xx only when repeating is safe', () => {
    // A POST that 503'd may have been applied first: retrying addKeywords
    // could add the same keyword twice. PUT here sets absolute state.
    expect(shouldRetry({ response: { status: 503 }, config: { method: 'get' } })).toBe(true);
    expect(shouldRetry({ response: { status: 503 }, config: { method: 'put' } })).toBe(true);
    expect(shouldRetry({ response: { status: 502 }, config: { method: 'head' } })).toBe(true);
    expect(shouldRetry({ response: { status: 503 }, config: { method: 'post' } })).toBe(false);
    expect(shouldRetry({ response: { status: 504 }, config: { method: 'delete' } })).toBe(false);
  });

  it('leaves every other failure alone', () => {
    for (const status of [400, 401, 403, 404, 409, 422, 500]) {
      expect(shouldRetry({ response: { status }, config: { method: 'get' } })).toBe(false);
    }
    expect(shouldRetry({ code: 'ECONNRESET', config: { method: 'get' } })).toBe(false);
    expect(shouldRetry(undefined)).toBe(false);
  });
});

describe('Retry-After', () => {
  it('reads seconds', () => {
    expect(retryAfterMs('2')).toBe(2000);
    expect(retryAfterMs(0)).toBe(0);
  });

  it('reads an HTTP-date', () => {
    const now = Date.parse('2026-09-09T12:00:00Z');
    expect(retryAfterMs('Wed, 09 Sep 2026 12:00:03 GMT', now)).toBe(3000);
  });

  it('caps a header that would park a worker', () => {
    expect(retryAfterMs('3600')).toBe(MAX_BACKOFF_MS);
  });

  it('never returns a negative wait for a date already past', () => {
    const now = Date.parse('2026-09-09T12:00:00Z');
    expect(retryAfterMs('Wed, 09 Sep 2026 11:59:00 GMT', now)).toBe(0);
  });

  it('says nothing when the header is missing or unreadable', () => {
    expect(retryAfterMs(undefined)).toBeNull();
    expect(retryAfterMs('')).toBeNull();
    expect(retryAfterMs('soon')).toBeNull();
  });
});

describe('the interceptor', () => {
  it('retries a 429 and returns the eventual success', async () => {
    const adapter = jest.fn()
      .mockImplementationOnce(fail(429, { 'retry-after': '0' }))
      .mockImplementationOnce(ok);
    http.defaults.adapter = adapter;

    const res = await http.get('https://advertising-api.amazon.com/v2/profiles');

    expect(res.data).toEqual({ ok: true });
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry budget, and the caller still sees the real error', async () => {
    const adapter = jest.fn(fail(429, { 'retry-after': '0' }));
    http.defaults.adapter = adapter;

    await expect(http.get('https://advertising-api.amazon.com/v2/profiles'))
      .rejects.toMatchObject({ response: { status: 429 } });
    expect(adapter).toHaveBeenCalledTimes(MAX_RETRIES + 1);
  });

  it('does not retry a POST that failed with 503', async () => {
    const adapter = jest.fn(fail(503));
    http.defaults.adapter = adapter;

    await expect(http.post('https://advertising-api.amazon.com/v2/sp/keywords', []))
      .rejects.toMatchObject({ response: { status: 503 } });
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it('passes an ordinary 400 straight back without retrying', async () => {
    const adapter = jest.fn(fail(400));
    http.defaults.adapter = adapter;

    await expect(http.get('https://advertising-api.amazon.com/v2/profiles')).rejects.toBeDefined();
    expect(adapter).toHaveBeenCalledTimes(1);
  });
});

describe('the throttle', () => {
  it('takes a token for a per-profile Ads call, keyed by the scope header', async () => {
    http.defaults.adapter = jest.fn(ok);

    await http.get('https://advertising-api.amazon.com/v2/campaigns', {
      headers: { 'Amazon-Advertising-API-Scope': '98225526978265' },
    });

    expect(acquireAdsSlot).toHaveBeenCalledWith('98225526978265');
  });

  it('leaves a call with no profile scope alone', async () => {
    // LWA token refresh and the profiles list are not per-profile, and
    // throttling them on a made-up key would slow every request for nothing.
    http.defaults.adapter = jest.fn(ok);

    await http.post('https://api.amazon.com/auth/o2/token', {});

    expect(acquireAdsSlot).not.toHaveBeenCalled();
  });

  it('takes a token again on a retry, so a retry storm is paced too', async () => {
    http.defaults.adapter = jest.fn()
      .mockImplementationOnce(fail(429, { 'retry-after': '0' }))
      .mockImplementationOnce(ok);

    await http.get('https://advertising-api.amazon.com/v2/campaigns', {
      headers: { 'Amazon-Advertising-API-Scope': '777' },
    });

    expect(acquireAdsSlot).toHaveBeenCalledTimes(2);
  });
});
