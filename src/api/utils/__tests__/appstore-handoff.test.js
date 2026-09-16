/**
 * The Appstore entry point is unauthenticated and redirects the browser to a
 * URL it was handed, so most of what matters here is what it refuses.
 */

// In-memory stand-in for the Redis-backed handoff store (same shape as the
// one in the sp-oauth route tests).
jest.mock('../../../services/ephemeral-store.js', () => {
  const entries = new Map();
  const store = {
    entries,
    async put(key, value) { entries.set(key, value); },
    async get(key) { return entries.get(key) ?? null; },
    async take(key) { const v = entries.get(key); entries.delete(key); return v ?? null; },
  };
  return { createEphemeralStore: () => store, closeEphemeralStore: async () => {}, __store: store };
});

import {
  isAmazonCallbackUri, parseHandoff, consentUrl,
  saveHandoff, readHandoff, clearHandoff, hasHandoff, HANDOFF_COOKIE,
} from '../appstore-handoff.js';

describe('isAmazonCallbackUri', () => {
  it.each([
    'https://sellercentral.amazon.com/apps/authorize/confirm/abc',
    'https://amazon.com/apps/authorize/confirm/abc',
    'https://sellercentral-europe.amazon.com/apps/authorize/confirm/abc',
    'https://sellercentral.amazon.co.uk/apps/authorize/confirm/abc',
    'https://sellercentral.amazon.in/apps/authorize/confirm/abc',
    'https://amazon.com.mx/apps/authorize/confirm/abc',
  ])('accepts Amazon: %s', (uri) => {
    expect(isAmazonCallbackUri(uri)).toBe(true);
  });

  it.each([
    ['a lookalike subdomain',   'https://amazon.evil.com/apps/authorize/confirm/abc'],
    ['a lookalike prefix',      'https://notamazon.com/apps/authorize/confirm/abc'],
    ['a suffixed host',         'https://amazon.com.evil.net/apps/authorize/confirm/abc'],
    ['plain http',              'http://sellercentral.amazon.com/apps/authorize/confirm/abc'],
    ['a javascript url',        'javascript:alert(1)'],
    ['a relative path',         '/apps/authorize/confirm/abc'],
    ['an empty string',         ''],
    ['a non-string',            null],
  ])('rejects %s', (_label, uri) => {
    expect(isAmazonCallbackUri(uri)).toBe(false);
  });

  it('rejects an absurdly long value without parsing it', () => {
    expect(isAmazonCallbackUri(`https://amazon.com/${'a'.repeat(2100)}`)).toBe(false);
  });
});

describe('parseHandoff', () => {
  const valid = {
    amazon_callback_uri: 'https://sellercentral.amazon.com/apps/authorize/confirm/abc',
    amazon_state:        'amazonstateexample',
    selling_partner_id:  'A3FHEXAMPLEYWS',
  };

  it('keeps what Amazon sent', () => {
    expect(parseHandoff(valid)).toEqual({
      amazonCallbackUri: valid.amazon_callback_uri,
      amazonState:       'amazonstateexample',
      sellingPartnerId:  'A3FHEXAMPLEYWS',
      beta:              false,
    });
  });

  it('carries version=beta so a draft application can be authorized', () => {
    expect(parseHandoff({ ...valid, version: 'beta' }).beta).toBe(true);
  });

  it('does not forward any other version value', () => {
    expect(parseHandoff({ ...valid, version: 'anything-else' }).beta).toBe(false);
  });

  it('refuses a handoff with no amazon_state — there would be nothing to echo back', () => {
    expect(parseHandoff({ ...valid, amazon_state: undefined })).toBeNull();
  });

  it('refuses a callback uri that is not Amazon', () => {
    expect(parseHandoff({ ...valid, amazon_callback_uri: 'https://evil.com/steal' })).toBeNull();
  });

  it('survives a seller id Amazon did not send', () => {
    expect(parseHandoff({ ...valid, selling_partner_id: undefined }).sellingPartnerId).toBeNull();
  });
});

describe('consentUrl', () => {
  const handoff = {
    amazonCallbackUri: 'https://sellercentral.amazon.com/apps/authorize/confirm/abc',
    amazonState:       'amazonstateexample',
    sellingPartnerId:  'A3FH',
    beta:              false,
  };

  it('echoes Amazon’s state untouched and adds our own', () => {
    const url = new URL(consentUrl(handoff, { redirectUri: 'https://app.test/cb', state: 'ours' }));
    expect(url.origin + url.pathname).toBe('https://sellercentral.amazon.com/apps/authorize/confirm/abc');
    expect(url.searchParams.get('amazon_state')).toBe('amazonstateexample');
    expect(url.searchParams.get('state')).toBe('ours');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.test/cb');
    expect(url.searchParams.has('version')).toBe(false);
  });

  it('passes version=beta through for a draft application', () => {
    const url = new URL(consentUrl({ ...handoff, beta: true }, { redirectUri: 'https://app.test/cb', state: 'ours' }));
    expect(url.searchParams.get('version')).toBe('beta');
  });
});

describe('the cookie round trip', () => {
  const handoff = {
    amazonCallbackUri: 'https://sellercentral.amazon.com/apps/authorize/confirm/abc',
    amazonState:       'amazonstateexample',
    sellingPartnerId:  'A3FH',
    beta:              false,
  };
  const res = () => ({ cookie: jest.fn(), clearCookie: jest.fn() });

  it('parks the handoff and gives the browser only an opaque id', async () => {
    const response = res();
    const id = await saveHandoff(response, handoff);

    expect(id).toMatch(/^[0-9a-f]{32}$/);
    const [name, value, opts] = response.cookie.mock.calls[0];
    expect(name).toBe(HANDOFF_COOKIE);
    expect(value).toBe(id);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe('lax');
    // Nothing Amazon sent is in the cookie itself.
    expect(JSON.stringify(response.cookie.mock.calls[0])).not.toContain('amazonstateexample');
  });

  it('reads back without spending it, so onboarding can happen in between', async () => {
    const response = res();
    const id = await saveHandoff(response, handoff);
    const req = { cookies: { [HANDOFF_COOKIE]: id } };

    expect(await readHandoff(req)).toEqual(handoff);
    expect(await readHandoff(req)).toEqual(handoff);
    expect(hasHandoff(req)).toBe(true);
  });

  it('is gone once cleared', async () => {
    const response = res();
    const id = await saveHandoff(response, handoff);
    const req = { cookies: { [HANDOFF_COOKIE]: id } };

    await clearHandoff(req, response);
    expect(response.clearCookie).toHaveBeenCalledWith(HANDOFF_COOKIE, expect.objectContaining({ httpOnly: true }));
    expect(await readHandoff(req)).toBeNull();
  });

  it('reports no handoff when the browser has no cookie', async () => {
    expect(await readHandoff({ cookies: {} })).toBeNull();
    expect(hasHandoff({ cookies: {} })).toBe(false);
    expect(hasHandoff({})).toBe(false);
  });
});
