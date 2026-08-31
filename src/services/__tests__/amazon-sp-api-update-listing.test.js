/**
 * updateListingBySku — the only call in the codebase that writes to a seller's
 * live Amazon listing. It had no tests.
 *
 * What matters here is the PATCH body: a wrong `op`, a wrong path, or a field
 * included when the caller did not ask for it does not fail loudly, it
 * overwrites real listing copy on a real storefront.
 */
jest.mock('../http.js', () => ({
  http: { patch: jest.fn(), get: jest.fn(), post: jest.fn() },
  TIMEOUT_MS: { api: 30_000, token: 15_000, download: 120_000, llm: 120_000 },
}));

jest.mock('../auth-utils.js', () => ({
  getOrCreateTokenManager: jest.fn(() => ({ getToken: jest.fn(async () => 'tok-123') })),
}));

import { createSpApiClient } from '../amazon-sp-api.js';
import { http } from '../http.js';

const client = () => createSpApiClient({
  clientId: 'cid', clientSecret: 'sec', refreshToken: 'ref',
  sellerId: 'SELLER1', marketplaceId: 'ATVPDKIKX0DER', languageTag: 'en_US',
  cacheKey: 'test',
});

const ACCEPTED = { data: { status: 'ACCEPTED', issues: [] } };

/** The patches array actually sent to Amazon. */
const sentPatches = () => http.patch.mock.calls[0][1].patches;
const patchFor = (path) => sentPatches().find(p => p.path === path);

beforeEach(() => {
  jest.clearAllMocks();
  http.patch.mockResolvedValue(ACCEPTED);
});

describe('refusing to send a bad request', () => {
  it('requires a productType', async () => {
    // Amazon rejects a patch without it, and the error it returns does not say
    // so clearly — fail here instead.
    await expect(client().updateListingBySku('SKU1', { title: 'New' }))
      .rejects.toThrow(/productType is required/);
    expect(http.patch).not.toHaveBeenCalled();
  });

  it('requires a sellerId on the client', async () => {
    const noSeller = createSpApiClient({ clientId: 'c', clientSecret: 's', refreshToken: 'r', cacheKey: 'k' });

    await expect(noSeller.updateListingBySku('SKU1', { title: 'New', productType: 'SHOES' }))
      .rejects.toThrow(/sellerId/);
    expect(http.patch).not.toHaveBeenCalled();
  });

  it('refuses a patch with nothing in it', async () => {
    // An empty patches array is a valid request that changes nothing; sending
    // it burns quota and reports success.
    await expect(client().updateListingBySku('SKU1', { productType: 'SHOES' }))
      .rejects.toThrow(/Nothing to update/);
    expect(http.patch).not.toHaveBeenCalled();
  });

  it.each([
    ['empty title',       { title: '' }],
    ['empty bullets',     { bullets: [] }],
    ['empty description', { description: '' }],
    ['empty keyword',     { genericKeyword: '' }],
  ])('treats %s as nothing to update', async (_label, fields) => {
    await expect(client().updateListingBySku('SKU1', { ...fields, productType: 'SHOES' }))
      .rejects.toThrow(/Nothing to update/);
  });
});

describe('what gets sent', () => {
  it('only patches the fields the caller supplied', async () => {
    // A listing's other copy must be left alone — this is why it is a PATCH and
    // not a PUT.
    await client().updateListingBySku('SKU1', { title: 'New title', productType: 'SHOES' });

    expect(sentPatches()).toHaveLength(1);
    expect(sentPatches()[0].path).toBe('/attributes/item_name');
  });

  it('maps each field to its Amazon attribute path', async () => {
    await client().updateListingBySku('SKU1', {
      title: 'T', bullets: ['B1', 'B2'], description: 'D', genericKeyword: 'k1 k2',
      productType: 'SHOES',
    });

    expect(sentPatches().map(p => p.path)).toEqual([
      '/attributes/item_name',
      '/attributes/bullet_point',
      '/attributes/product_description',
      '/attributes/generic_keyword',
    ]);
    expect(sentPatches().every(p => p.op === 'replace')).toBe(true);
  });

  it('sends every bullet as its own value, in order', async () => {
    await client().updateListingBySku('SKU1', { bullets: ['One', 'Two', 'Three'], productType: 'SHOES' });

    expect(patchFor('/attributes/bullet_point').value.map(v => v.value)).toEqual(['One', 'Two', 'Three']);
  });

  it('drops empty bullets rather than writing blanks into the listing', async () => {
    await client().updateListingBySku('SKU1', { bullets: ['One', '', null, 'Two'], productType: 'SHOES' });

    expect(patchFor('/attributes/bullet_point').value.map(v => v.value)).toEqual(['One', 'Two']);
  });

  it('tags every value with the marketplace and language', async () => {
    await client().updateListingBySku('SKU1', { title: 'T', bullets: ['B'], productType: 'SHOES' });

    for (const patch of sentPatches()) {
      for (const value of patch.value) {
        expect(value).toMatchObject({ marketplace_id: 'ATVPDKIKX0DER', language_tag: 'en_US' });
      }
    }
  });

  it('uses the client\'s configured marketplace and language', async () => {
    const uk = createSpApiClient({
      clientId: 'c', clientSecret: 's', refreshToken: 'r', sellerId: 'S',
      marketplaceId: 'A1F83G8C2ARO7P', languageTag: 'en_GB', cacheKey: 'uk',
    });

    await uk.updateListingBySku('SKU1', { title: 'T', productType: 'SHOES' });

    expect(patchFor('/attributes/item_name').value[0]).toMatchObject({
      marketplace_id: 'A1F83G8C2ARO7P', language_tag: 'en_GB',
    });
  });

  it('addresses the seller\'s own SKU and url-encodes it', async () => {
    await client().updateListingBySku('SKU/WITH SPACE', { title: 'T', productType: 'SHOES' });

    const [url, , config] = http.patch.mock.calls[0];
    expect(url).toContain('/listings/2021-08-01/items/SELLER1/');
    expect(url).toContain(encodeURIComponent('SKU/WITH SPACE'));
    expect(config.params).toEqual({ marketplaceIds: 'ATVPDKIKX0DER' });
  });

  it('carries the productType alongside the patches', async () => {
    await client().updateListingBySku('SKU1', { title: 'T', productType: 'RUNNING_SHOE' });

    expect(http.patch.mock.calls[0][1].productType).toBe('RUNNING_SHOE');
  });

  it('sends the access token in both headers SP-API expects', async () => {
    await client().updateListingBySku('SKU1', { title: 'T', productType: 'SHOES' });

    expect(http.patch.mock.calls[0][2].headers).toMatchObject({
      Authorization: 'Bearer tok-123', 'x-amz-access-token': 'tok-123',
    });
  });
});

describe('what Amazon says back', () => {
  it('returns the status and issues on acceptance', async () => {
    http.patch.mockResolvedValue({ data: { status: 'ACCEPTED', issues: [{ message: 'minor' }] } });

    const res = await client().updateListingBySku('SKU1', { title: 'T', productType: 'SHOES' });

    expect(res).toEqual({ status: 'ACCEPTED', issues: [{ message: 'minor' }] });
  });

  it('throws on INVALID, quoting the issues', async () => {
    // A 200 response with status INVALID means nothing was applied. Returning
    // it as success would report an update that never happened.
    http.patch.mockResolvedValue({
      data: { status: 'INVALID', issues: [{ message: 'Title too long' }, { message: 'Bad keyword' }] },
    });

    await expect(client().updateListingBySku('SKU1', { title: 'T', productType: 'SHOES' }))
      .rejects.toThrow(/Title too long; Bad keyword/);
  });

  it('throws on INVALID even when Amazon sends no issues', async () => {
    http.patch.mockResolvedValue({ data: { status: 'INVALID' } });

    await expect(client().updateListingBySku('SKU1', { title: 'T', productType: 'SHOES' }))
      .rejects.toThrow(/Amazon rejected the update/);
  });

  it('defaults issues to an empty array', async () => {
    http.patch.mockResolvedValue({ data: { status: 'ACCEPTED' } });

    expect(await client().updateListingBySku('SKU1', { title: 'T', productType: 'SHOES' }))
      .toEqual({ status: 'ACCEPTED', issues: [] });
  });

  it('propagates a transport failure rather than reporting success', async () => {
    http.patch.mockRejectedValue(new Error('timeout of 30000ms exceeded'));

    await expect(client().updateListingBySku('SKU1', { title: 'T', productType: 'SHOES' }))
      .rejects.toThrow(/timeout/);
  });
});
