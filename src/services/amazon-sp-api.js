import axios from 'axios';
import dotenv from 'dotenv';
import { gunzipSync } from 'zlib';
import { getOrCreateTokenManager } from './auth-utils.js';

dotenv.config({ override: true });

// EU marketplaces → sellingpartnerapi-eu; FE → sellingpartnerapi-fe; else NA
const EU_MARKETPLACES = new Set([
  'A1F83G8C2ARO7P', // UK
  'A1PA6795UKMFR9', // DE
  'A13V1IB3VIYZZH', // FR
  'APJ6JRA9NG5V4',  // IT
  'A1RKKUPIHCS9HS', // ES
  'A1805IZSGTT6HS', // NL
  'A2NODRKZP88ZB9', // SE
  'A1C3SOZHARKG6S', // PL
  'AMEN7PMS3EDWL',  // BE
  'A2VIGQ35RCS4UG', // AE
  'A17E79C6D8DWNP', // SA
  'A33AVAJ2PDY3EV', // TR
  'ARBP9OOSHTCHU',  // EG
  'A21TJRUUN4KGV',  // IN
]);
const FE_MARKETPLACES = new Set([
  'A1VC38T7YXB528', // JP
  'A39IBJ37TRP1C6', // AU
  'A19VAU5U5O7RUS', // SG
]);

function spBaseForMarketplace(marketplaceId) {
  if (EU_MARKETPLACES.has(marketplaceId)) return 'https://sellingpartnerapi-eu.amazon.com';
  if (FE_MARKETPLACES.has(marketplaceId)) return 'https://sellingpartnerapi-fe.amazon.com';
  return 'https://sellingpartnerapi-na.amazon.com';
}

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
  languageTag   = 'en_US',
  cacheKey,
}) {
  // SP-API endpoint varies by marketplace region
  const SP_BASE = spBaseForMarketplace(marketplaceId);
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

    // Extract images from attributes (Listings Items API)
    const IMAGE_ATTR_KEYS = [
      'main_product_image_locator',
      'other_product_image_locator_1', 'other_product_image_locator_2',
      'other_product_image_locator_3', 'other_product_image_locator_4',
      'other_product_image_locator_5', 'other_product_image_locator_6',
      'other_product_image_locator_7', 'other_product_image_locator_8',
    ];
    const attrImages = IMAGE_ATTR_KEYS
      .flatMap(k => attrs[k] ?? [])
      .map(img => img.media_location)
      .filter(Boolean);

    // Catalog Items API returns data.images = [{ variant, link, height, width }]
    const catalogImages = (data.images ?? [])
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))
      .map(img => img.link)
      .filter(Boolean);

    // Summaries may have a mainImage link
    const summaryImage = data.summaries?.[0]?.mainImage?.link ?? null;

    const images = attrImages.length > 0 ? attrImages
      : catalogImages.length > 0        ? catalogImages
      : summaryImage                    ? [summaryImage]
      : [];

    const mainImage = images[0] ?? null;

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
      mainImage,
      images,
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
          params:  { marketplaceIds: marketplaceId, includedData: 'attributes,summaries,images' },
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

    // Build JSON Patch operations — PATCH only touches the fields we provide,
    // avoiding Amazon's "missing required attribute" errors that a full PUT triggers.
    const patches = [];
    if (title) {
      patches.push({
        op: 'replace',
        path: '/attributes/item_name',
        value: [{ value: title, language_tag: languageTag, marketplace_id: marketplaceId }],
      });
    }
    if (bullets?.length) {
      patches.push({
        op: 'replace',
        path: '/attributes/bullet_point',
        value: bullets.filter(Boolean).map(b => ({ value: b, language_tag: languageTag, marketplace_id: marketplaceId })),
      });
    }
    if (description) {
      patches.push({
        op: 'replace',
        path: '/attributes/product_description',
        value: [{ value: description, language_tag: languageTag, marketplace_id: marketplaceId }],
      });
    }

    if (!patches.length) throw new Error('Nothing to update — title, bullets, and description are all empty');

    console.log(`PATCH listing SKU ${sku} (productType: ${productType}, ${patches.length} fields)…`);
    const res = await axios.patch(
      `${SP_BASE}/listings/2021-08-01/items/${sellerId}/${encodeURIComponent(sku)}`,
      { productType, patches },
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
    console.log(`✅ Listing PATCH accepted for SKU ${sku} — status: ${status}`);
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

  /**
   * Kick off a SALES_AND_TRAFFIC report covering [startDate, endDate].
   * Returns the SP-API reportId — caller polls with pollSalesAndTrafficReport.
   */
  async function startSalesAndTrafficReport(startDate, endDate) {
    const token = await getSPToken();
    const body = {
      reportType:    'GET_SALES_AND_TRAFFIC_REPORT',
      marketplaceIds: [marketplaceId],
      dataStartTime: `${startDate}T00:00:00Z`,
      dataEndTime:   `${endDate}T23:59:59Z`,
      reportOptions: { dateGranularity: 'DAY', asinGranularity: 'PARENT' },
    };

    try {
      const res = await axios.post(`${SP_BASE}/reports/2021-06-30/reports`, body, {
        headers: spHeaders(token),
      });
      console.log(`✅ Sales & Traffic report created: ${res.data.reportId} (${startDate} → ${endDate})`);
      return res.data.reportId;
    } catch (e) {
      const msg = e.response?.data?.errors?.[0]?.message ?? e.message;
      console.error(`❌ Sales & Traffic report create failed [${e.response?.status}]: ${msg}`);
      throw new Error(`Sales report create failed: ${msg}`);
    }
  }

  /**
   * Poll a Sales & Traffic report. Returns:
   *   - { status: 'PENDING' }
   *   - { status: 'FAILED', error }
   *   - { status: 'COMPLETED', totalSales, currency, days }
   */
  async function pollSalesAndTrafficReport(reportId) {
    const token = await getSPToken();

    let report;
    try {
      const r = await axios.get(`${SP_BASE}/reports/2021-06-30/reports/${reportId}`, {
        headers: spHeaders(token),
      });
      report = r.data;
    } catch (e) {
      const msg = e.response?.data?.errors?.[0]?.message ?? e.message;
      throw new Error(`Sales report poll failed: ${msg}`);
    }

    const ps = report.processingStatus;
    if (ps === 'IN_QUEUE' || ps === 'IN_PROGRESS') return { status: 'PENDING' };
    if (ps === 'CANCELLED' || ps === 'FATAL')      return { status: 'FAILED', error: `Sales report ${ps}` };
    if (ps !== 'DONE')                              return { status: 'PENDING' };

    // DONE — fetch the document
    let doc;
    try {
      const d = await axios.get(`${SP_BASE}/reports/2021-06-30/documents/${report.reportDocumentId}`, {
        headers: spHeaders(token),
      });
      doc = d.data;
    } catch (e) {
      const msg = e.response?.data?.errors?.[0]?.message ?? e.message;
      throw new Error(`Sales report doc fetch failed: ${msg}`);
    }

    let payload;
    try {
      const dl = await axios.get(doc.url, { responseType: 'arraybuffer' });
      const buf = Buffer.from(dl.data);
      const text = doc.compressionAlgorithm === 'GZIP' ? gunzipSync(buf).toString() : buf.toString();
      payload = JSON.parse(text);
    } catch (e) {
      throw new Error(`Sales report download/parse failed: ${e.message}`);
    }

    const rows = payload.salesAndTrafficByDate ?? [];
    let totalSales = 0;
    let currency  = null;
    for (const r of rows) {
      const amt = r.salesByDate?.orderedProductSales?.amount ?? 0;
      totalSales += Number(amt) || 0;
      currency = currency ?? r.salesByDate?.orderedProductSales?.currencyCode ?? null;
    }

    console.log(`✅ Sales & Traffic report ${reportId} parsed — ${rows.length} days, total ${currency ?? ''} ${totalSales.toFixed(2)}`);
    return { status: 'COMPLETED', totalSales, currency, days: rows.length };
  }

  return {
    getProductBySku,
    getProductByAsin,
    updateListingBySku,
    getProductTypeByAsin,
    startSalesAndTrafficReport,
    pollSalesAndTrafficReport,
  };
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
