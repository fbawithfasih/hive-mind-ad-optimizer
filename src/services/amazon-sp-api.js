import axios from 'axios';
import dotenv from 'dotenv';
import { getOrCreateTokenManager } from './auth-utils.js';

dotenv.config({ override: true });

// ─────────────────────────────────────────────────────────────────────────────
// Client factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an Amazon SP-API client bound to specific credentials.
 *
 * @param {object} credentials
 * @param {string} credentials.clientId
 * @param {string} credentials.clientSecret
 * @param {string} credentials.refreshToken
 * @param {string} credentials.sellerId
 * @param {string} [credentials.marketplaceId]
 * @param {string} [credentials.cacheKey]
 */
export function createSpApiClient({
  clientId,
  clientSecret,
  refreshToken,
  sellerId,
  marketplaceId = 'ATVPDKIKX0DER',
  cacheKey,
}) {
  const SP_BASE = 'https://sellingpartnerapi-na.amazon.com';
  const key = cacheKey ?? `sp:${clientId}:${(refreshToken ?? '').slice(-8)}`;

  async function getSPToken() {
    const manager = getOrCreateTokenManager(key, clientId, clientSecret, refreshToken, 'SP-API');
    return manager.getToken();
  }

  function spHeaders(token) {
    return {
      Authorization:        `Bearer ${token}`,
      'x-amz-access-token': token,
      'Content-Type':       'application/json',
    };
  }

  /**
   * Extract listing fields from SP-API attribute response.
   */
  function extractListingFields(data, asin) {
    const attrs = data.attributes ?? {};

    const title = attrs.item_name?.[0]?.value
      ?? attrs.product_name?.[0]?.value
      ?? data.summaries?.[0]?.itemName
      ?? '';

    const bullets = (attrs.bullet_point ?? []).map(b => b.value ?? b).filter(Boolean);

    const description = attrs.product_description?.[0]?.value
      ?? attrs.item_description?.[0]?.value
      ?? '';

    const extractedAsin = asin
      ?? data.asin
      ?? data.summaries?.[0]?.asin
      ?? (data.identifiers?.asin && Array.isArray(data.identifiers.asin) ? data.identifiers.asin[0] : null)
      ?? '';

    console.log(`[extractListingFields] ASIN resolution:`, {
      suppliedAsin: asin,
      dataAsin: data.asin,
      summariesAsin: data.summaries?.[0]?.asin,
      identifiersAsin: data.identifiers?.asin?.[0],
      finalAsin: extractedAsin,
    });

    return {
      asin:        extractedAsin,
      sku:         data.sku ?? null,
      productType: data.productType
        ?? data.summaries?.[0]?.productType
        ?? data.classifications?.[0]?.productType
        ?? data.classifications?.[0]?.classificationId
        ?? null,
      title,
      bullets:     bullets.slice(0, 5),
      description,
    };
  }

  async function getProductBySku(sku) {
    if (!sellerId) throw new Error('sellerId is not configured');
    const token = await getSPToken();
    console.log(`Fetching SP-API listing for SKU ${sku}…`);

    try {
      const res = await axios.get(
        `${SP_BASE}/listings/2021-08-01/items/${sellerId}/${encodeURIComponent(sku)}`,
        {
          params:  { marketplaceIds: marketplaceId, includedData: 'attributes,summaries' },
          headers: spHeaders(token),
        }
      );
      console.log(`✅ Listing fetched for SKU ${sku}`);
      console.log(`   Response keys: ${Object.keys(res.data).join(', ')}`);
      console.log(`   top-level productType: ${res.data.productType ?? '(null)'}`);
      console.log(`   summaries[0].productType: ${res.data.summaries?.[0]?.productType ?? '(null)'}`);
      console.log(`   summaries[0] keys: ${Object.keys(res.data.summaries?.[0] ?? {}).join(', ')}`);
      return extractListingFields({ ...res.data, sku }, res.data.asin);
    } catch (e) {
      const status = e.response?.status;
      const msg = e.response?.data?.errors?.[0]?.message ?? e.response?.data?.message ?? e.message;
      console.error(`❌ SP-API SKU lookup error [${status}]:`, msg);
      console.error(`   SELLER_ID used: ${sellerId}, SKU: ${sku}, Marketplace: ${marketplaceId}`);
      throw new Error(`SP-API SKU lookup failed: ${msg}`);
    }
  }

  async function getProductByAsin(asin) {
    const token = await getSPToken();
    console.log(`Fetching SP-API item for ASIN ${asin}…`);

    // First try: seller's own listings by ASIN (works with Product Listing role)
    try {
      const res = await axios.get(
        `${SP_BASE}/listings/2021-08-01/items/${sellerId}`,
        {
          params: {
            marketplaceIds: marketplaceId,
            includedData:   'attributes,summaries',
            identifiers:    asin,
            identifiersType: 'ASIN',
          },
          headers: spHeaders(token),
        }
      );
      const items = res.data.items ?? res.data;
      const item  = Array.isArray(items) ? items[0] : items;
      if (!item) throw new Error(`No listing found for ASIN ${asin} in this seller account`);
      console.log(`✅ Listing found via ASIN search for ${asin}`);
      return extractListingFields(item, item.asin ?? asin);
    } catch (listingErr) {
      const listingStatus = listingErr.response?.status;
      const listingMsg = listingErr.response?.data?.errors?.[0]?.message ?? listingErr.message;
      console.warn(`Listings-by-ASIN failed [${listingStatus}]: ${listingMsg} — trying Catalog Items API…`);
    }

    // Second try: Catalog Items API (requires Catalog Items role)
    try {
      const res = await axios.get(
        `${SP_BASE}/catalog/2022-04-01/items/${asin}`,
        {
          params:  { marketplaceIds: marketplaceId, includedData: 'attributes,summaries' },
          headers: spHeaders(token),
        }
      );
      console.log(`✅ Catalog item fetched for ASIN ${asin}`);
      return extractListingFields(res.data, asin);
    } catch (catalogErr) {
      const msg = catalogErr.response?.data?.errors?.[0]?.message ?? catalogErr.message;
      if (catalogErr.response?.status === 403) {
        throw new Error(
          `ASIN lookup requires the "Catalog Items" SP-API role (not yet approved on your app). ` +
          `Please enter the product SKU instead.`
        );
      }
      throw new Error(`SP-API ASIN lookup failed: ${msg}`);
    }
  }

  async function updateListingBySku(sku, { title, bullets, description, productType }) {
    if (!sellerId) throw new Error('sellerId is not configured');
    if (!productType) throw new Error('productType is required — re-fetch the listing to obtain it');
    const token = await getSPToken();

    const attributes = {};
    if (title)           attributes.item_name           = [{ value: title, language_tag: 'en_US', marketplace_id: marketplaceId }];
    if (bullets?.length) attributes.bullet_point        = bullets.filter(Boolean).map(b => ({ value: b, language_tag: 'en_US', marketplace_id: marketplaceId }));
    if (description)     attributes.product_description = [{ value: description, language_tag: 'en_US', marketplace_id: marketplaceId }];

    console.log(`Updating listing SKU ${sku} with productType ${productType}…`);
    const res = await axios.put(
      `${SP_BASE}/listings/2021-08-01/items/${sellerId}/${encodeURIComponent(sku)}`,
      { productType, attributes },
      {
        params:  { marketplaceIds: marketplaceId },
        headers: spHeaders(token),
      }
    );

    const { status, issues } = res.data;
    if (status === 'INVALID') {
      const msg = issues?.map(i => i.message).join('; ') ?? 'Unknown validation error';
      throw new Error(`Amazon rejected the update: ${msg}`);
    }
    console.log(`✅ Listing update accepted for SKU ${sku}`);
    return { status, issues: issues ?? [] };
  }

  async function getProductTypeByAsin(asin) {
    const token = await getSPToken();
    console.log(`Fetching productType for ASIN ${asin}…`);

    try {
      const res = await axios.get(
        `${SP_BASE}/catalog/2022-04-01/items/${asin}`,
        {
          params:  { marketplaceIds: marketplaceId },
          headers: spHeaders(token),
        }
      );

      const productType = res.data.productType;
      if (productType) {
        console.log(`✅ productType found for ${asin}: ${productType}`);
        return productType;
      }
      console.warn(`⚠️ No productType in response for ${asin}`);
      return null;
    } catch (err) {
      const status = err.response?.status;
      const msg = err.response?.data?.errors?.[0]?.message ?? err.message;
      console.warn(`⚠️ Could not fetch productType via Catalog API [${status}]: ${msg}`);
      return null;
    }
  }

  return { getProductBySku, getProductByAsin, updateListingBySku, getProductTypeByAsin };
}

// ─────────────────────────────────────────────────────────────────────────────
// Default env-var client (singleton — backward compat for legacy imports)
// ─────────────────────────────────────────────────────────────────────────────

const _defaultClient = createSpApiClient({
  clientId:     process.env.SP_API_CLIENT_ID      ?? '',
  clientSecret: process.env.SP_API_CLIENT_SECRET   ?? '',
  refreshToken: process.env.SP_API_REFRESH_TOKEN   ?? '',
  sellerId:     process.env.SP_API_SELLER_ID       ?? '',
  marketplaceId: process.env.SP_API_MARKETPLACE_ID ?? 'ATVPDKIKX0DER',
  cacheKey:     'sp:default',
});

export const getProductBySku      = _defaultClient.getProductBySku;
export const getProductByAsin     = _defaultClient.getProductByAsin;
export const updateListingBySku   = _defaultClient.updateListingBySku;
export const getProductTypeByAsin = _defaultClient.getProductTypeByAsin;

export default _defaultClient;
