/**
 * The token-manager registry.
 *
 * A manager closes over the refresh token it was built with, so a cache hit on
 * a key whose credentials have since changed keeps calling Amazon with the old
 * token until the process restarts. That was live: saveOrgCredential
 * invalidates `sp:<orgId>`, while withAmazonCredentials creates
 * `sp:<orgId>:<marketplaceId>`. Different keys — so the manager backing every
 * API request was never cleared, and a seller who re-authorised stayed broken
 * until the next deploy.
 *
 * The tests below check the two independent defences: lookup compares
 * credentials, and invalidation reaches namespaced keys.
 */
jest.mock('../http.js', () => ({
  http: { post: jest.fn() },
  TIMEOUT_MS: { api: 30_000, token: 15_000, download: 120_000, llm: 120_000 },
}));

import {
  getOrCreateTokenManager,
  invalidateTokenManager,
  resetTokenManagerRegistry,
  tokenManagerCount,
} from '../auth-utils.js';
import { http } from '../http.js';

/** The refresh token a manager actually sent to Amazon. */
const sentRefreshToken = (callIndex = 0) =>
  http.post.mock.calls[callIndex][1].get('refresh_token');

beforeEach(() => {
  jest.clearAllMocks();
  resetTokenManagerRegistry();
  http.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 3600 } });
});

describe('reuse', () => {
  it('returns the same manager for the same key and credentials', () => {
    const a = getOrCreateTokenManager('sp:org-1', 'cid', 'sec', 'ref');
    const b = getOrCreateTokenManager('sp:org-1', 'cid', 'sec', 'ref');

    expect(b).toBe(a);
    expect(tokenManagerCount()).toBe(1);
  });

  it('caches the access token across calls rather than re-authenticating', async () => {
    const m = getOrCreateTokenManager('sp:org-1', 'cid', 'sec', 'ref');

    await m.getToken();
    await m.getToken();

    expect(http.post).toHaveBeenCalledTimes(1);
  });

  it('keeps separate managers for separate keys', () => {
    getOrCreateTokenManager('sp:org-1', 'cid', 'sec', 'ref');
    getOrCreateTokenManager('ads:org-1', 'cid', 'sec', 'ref');

    expect(tokenManagerCount()).toBe(2);
  });
});

describe('a credential that has changed', () => {
  it('is not served from the cache', async () => {
    const before = getOrCreateTokenManager('sp:org-1', 'cid', 'sec', 'old-token');
    await before.getToken();

    const after = getOrCreateTokenManager('sp:org-1', 'cid', 'sec', 'new-token');
    await after.getToken();

    expect(after).not.toBe(before);
    expect(sentRefreshToken(0)).toBe('old-token');
    expect(sentRefreshToken(1)).toBe('new-token');
  });

  it.each([
    ['refresh token', ['cid', 'sec', 'different']],
    ['client id',     ['other-cid', 'sec', 'ref']],
    ['client secret', ['cid', 'other-sec', 'ref']],
  ])('rebuilds when the %s differs', (_label, creds) => {
    const before = getOrCreateTokenManager('sp:org-1', 'cid', 'sec', 'ref');
    const after  = getOrCreateTokenManager('sp:org-1', ...creds);

    expect(after).not.toBe(before);
    expect(tokenManagerCount()).toBe(1);   // replaced, not accumulated
  });

  it('drops the old manager\'s cached access token', async () => {
    const before = getOrCreateTokenManager('sp:org-1', 'cid', 'sec', 'old');
    await before.getToken();

    getOrCreateTokenManager('sp:org-1', 'cid', 'sec', 'new');

    // The displaced manager must not keep answering with the token it holds —
    // anything still referencing it re-authenticates.
    await before.getToken();
    expect(http.post).toHaveBeenCalledTimes(2);
  });

  it('does not rebuild when nothing changed', () => {
    getOrCreateTokenManager('sp:org-1', 'cid', 'sec', 'ref');
    const same = getOrCreateTokenManager('sp:org-1', 'cid', 'sec', 'ref');

    expect(getOrCreateTokenManager('sp:org-1', 'cid', 'sec', 'ref')).toBe(same);
  });
});

describe('invalidation', () => {
  it('clears the exact key', async () => {
    const m = getOrCreateTokenManager('sp:org-1', 'cid', 'sec', 'ref');
    await m.getToken();

    invalidateTokenManager('sp:org-1');

    expect(tokenManagerCount()).toBe(0);
    await getOrCreateTokenManager('sp:org-1', 'cid', 'sec', 'ref').getToken();
    expect(http.post).toHaveBeenCalledTimes(2);
  });

  it('reaches keys namespaced beneath it', () => {
    // saveOrgCredential invalidates `sp:<orgId>`; the request path creates
    // `sp:<orgId>:<marketplaceId>`. Before this, the latter survived.
    getOrCreateTokenManager('sp:org-1', 'cid', 'sec', 'ref');
    getOrCreateTokenManager('sp:org-1:ATVPDKIKX0DER', 'cid', 'sec', 'ref');
    getOrCreateTokenManager('sp:org-1:A1F83G8C2ARO7P', 'cid', 'sec', 'ref');

    invalidateTokenManager('sp:org-1');

    expect(tokenManagerCount()).toBe(0);
  });

  it('does not clear another org whose id merely starts the same', () => {
    getOrCreateTokenManager('sp:org-1', 'cid', 'sec', 'ref');
    getOrCreateTokenManager('sp:org-12', 'cid', 'sec', 'ref');

    invalidateTokenManager('sp:org-1');

    expect(tokenManagerCount()).toBe(1);
  });

  it('does not clear a different api type for the same org', () => {
    getOrCreateTokenManager('sp:org-1', 'cid', 'sec', 'ref');
    getOrCreateTokenManager('ads:org-1', 'cid', 'sec', 'ref');

    invalidateTokenManager('sp:org-1');

    expect(tokenManagerCount()).toBe(1);
  });

  it('is a no-op for a key that was never registered', () => {
    getOrCreateTokenManager('sp:org-1', 'cid', 'sec', 'ref');

    expect(() => invalidateTokenManager('sp:nobody')).not.toThrow();
    expect(tokenManagerCount()).toBe(1);
  });
});

describe('bounded growth', () => {
  it('does not accumulate an entry per org forever', () => {
    for (let i = 0; i < 600; i++) {
      getOrCreateTokenManager(`sp:org-${i}`, 'cid', 'sec', `ref-${i}`);
    }

    expect(tokenManagerCount()).toBeLessThanOrEqual(500);
  });

  it('evicts the least recently used, not the most recent', () => {
    for (let i = 0; i < 500; i++) {
      getOrCreateTokenManager(`sp:org-${i}`, 'cid', 'sec', `ref-${i}`);
    }
    const hot = getOrCreateTokenManager('sp:org-0', 'cid', 'sec', 'ref-0');  // touch it

    for (let i = 500; i < 600; i++) {
      getOrCreateTokenManager(`sp:org-${i}`, 'cid', 'sec', `ref-${i}`);
    }

    expect(getOrCreateTokenManager('sp:org-0', 'cid', 'sec', 'ref-0')).toBe(hot);
  });
});

describe('missing credentials', () => {
  it('explains what to do instead of letting Amazon return a bare 400', async () => {
    const m = getOrCreateTokenManager('sp:org-1', null, null, null, 'SP-API');

    await expect(m.getToken()).rejects.toThrow(/Connect your Amazon account/);
    expect(http.post).not.toHaveBeenCalled();
  });

  it('distinguishes an unconfigured client from a configured one', () => {
    const empty     = getOrCreateTokenManager('sp:org-1', null, null, null);
    const configured = getOrCreateTokenManager('sp:org-1', 'cid', 'sec', 'ref');

    expect(configured).not.toBe(empty);
  });
});
