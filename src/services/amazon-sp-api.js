import axios from 'axios';
import dotenv from 'dotenv';
import { createTokenManager } from './auth-utils.js';

dotenv.config({ override: true });

const SP_CLIENT_ID     = process.env.SP_API_CLIENT_ID;
const SP_CLIENT_SECRET = process.env.SP_API_CLIENT_SECRET;
const SP_REFRESH_TOKEN = process.env.SP_API_REFRESH_TOKEN;
const MARKETPLACE_ID   = process.env.SP_API_MARKETPLACE_ID || 'ATVPDKIKX0DER';
const SELLER_ID        = process.env.SP_API_SELLER_ID;
const SP_BASE          = 'https://sellingpartnerapi-na.amazon.com';

// Use shared token manager to handle refresh with caching and race condition prevention
const spTokenManager = createTokenManager(SP_CLIENT_ID, SP_CLIENT_SECRET, SP_REFRESH_TOKEN, 'SP-API');

async function getSPToken() {
  return spTokenManager.getToken();
}

function spHeaders(token) {
  return {
    Authorization:  `Bearer ${token}`,
    'x-amz-access-token': token,
    'Content-Type': 'application/json',
  };
}

/**
 * Extract listing fields from SP-API attribute response.
 * Handles both Catalog Items API and Listings Items API response shapes.
 */
function extractListingFields(data, asin) {
  // Catalog Items API v2022-04-01: data.attributes
  // Listings Items API v2021-08-01: data.attributes
  const attrs = data.attributes ?? {};

  const title = attrs.item_name?.[0]?.value
    ?? attrs.product_name?.[0]?.value
    ?? data.summaries?.[0]?.itemName
    ?? '';

  const bullets = (attrs.bullet_point ?? []).map(b => b.value ?? b).filter(Boolean);

  const description = attrs.product_description?.[0]?.value
    ?? attrs.item_description?.[0]?.value
    ?? '';

  return {
    asin:        asin ?? data.asin ?? '',
    sku:         data.sku ?? null,
    productType: data.productType ?? null,   // required for PUT — must match the listing's actual type
    title,
    bullets:     bullets.slice(0, 5),
    description,
  };
}

/**
 * Fetch product data by SKU via Listings Items API v2021-08-01.
 * Requires "Product Listing" role (approved).
 */
export async function getProductBySku(sku) {
  if (!SELLER_ID) throw new Error('SP_API_SELLER_ID is not configured in .env');
  const token = await getSPToken();
  console.log(`Fetching SP-API listing for SKU ${sku}…`);

  try {
    const res = await axios.get(
      `${SP_BASE}/listings/2021-08-01/items/${SELLER_ID}/${encodeURIComponent(sku)}`,
      {
        params: {
          marketplaceIds: MARKETPLACE_ID,
          includedData:   'attributes,summaries',
        },
        headers: spHeaders(token),
      }
    );
    console.log(`✅ Listing fetched for SKU ${sku}`);
    return extractListingFields({ ...res.data, sku }, res.data.asin);
  } catch (e) {
    const status = e.response?.status;
    const msg = e.response?.data?.errors?.[0]?.message ?? e.response?.data?.message ?? e.message;
    console.error(`❌ SP-API SKU lookup error [${status}]:`, msg);
    console.error(`   SELLER_ID used: ${SELLER_ID}, SKU: ${sku}, Marketplace: ${MARKETPLACE_ID}`);
    throw new Error(`SP-API SKU lookup failed: ${msg}`);
  }
}

/**
 * Fetch product data by ASIN.
 * Tries Catalog Items API first; if denied (role not approved), falls back to
 * searching seller's own listings by ASIN identifier.
 * Requires "Catalog Items" role OR "Product Listing" role.
 */
export async function getProductByAsin(asin) {
  const token = await getSPToken();
  console.log(`Fetching SP-API item for ASIN ${asin}…`);

  // First try: search seller's own listings filtered by ASIN (works with Product Listing role)
  try {
    const res = await axios.get(
      `${SP_BASE}/listings/2021-08-01/items/${SELLER_ID}`,
      {
        params: {
          marketplaceIds: MARKETPLACE_ID,
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
        params: {
          marketplaceIds: MARKETPLACE_ID,
          includedData:   'attributes,summaries',
        },
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

/**
 * Update listing content via Listings Items API v2021-08-01.
 * Requires "Product Listing" SP-API role (same as read — already approved).
 *
 * @param {string} sku
 * @param {{ title: string, bullets: string[], description: string }} content
 */
export async function updateListingBySku(sku, { title, bullets, description, productType }) {
  if (!SELLER_ID) throw new Error('SP_API_SELLER_ID is not configured');
  if (!productType) throw new Error('productType is required — re-fetch the listing to obtain it');
  const token = await getSPToken();

  const attributes = {};
  if (title)           attributes.item_name           = [{ value: title, language_tag: 'en_US', marketplace_id: MARKETPLACE_ID }];
  if (bullets?.length) attributes.bullet_point        = bullets.filter(Boolean).map(b => ({ value: b, language_tag: 'en_US', marketplace_id: MARKETPLACE_ID }));
  if (description)     attributes.product_description = [{ value: description, language_tag: 'en_US', marketplace_id: MARKETPLACE_ID }];

  console.log(`Updating listing SKU ${sku} with productType ${productType}…`);
  const res = await axios.put(
    `${SP_BASE}/listings/2021-08-01/items/${SELLER_ID}/${encodeURIComponent(sku)}`,
    { productType, attributes },
    {
      params:  { marketplaceIds: MARKETPLACE_ID },
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

/**
 * Fetch productType for an ASIN via Catalog Items API v2022-04-01.
 * This is a lightweight call to get just the productType for use in listing updates.
 * Requires "Catalog Items" role OR "Product Listing" role.
 *
 * @param {string} asin
 * @returns {Promise<string|null>} productType or null if not available
 */
export async function getProductTypeByAsin(asin) {
  const token = await getSPToken();
  console.log(`Fetching productType for ASIN ${asin}…`);

  try {
    const res = await axios.get(
      `${SP_BASE}/catalog/2022-04-01/items/${asin}`,
      {
        params: { marketplaceIds: MARKETPLACE_ID },
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
    // Don't throw — just return null so the caller can handle the fallback
    return null;
  }
}

export default { getProductByAsin, getProductBySku, updateListingBySku, getProductTypeByAsin };
