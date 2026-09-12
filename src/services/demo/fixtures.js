/**
 * Aarohi Handicrafts — a fictional Jaipur seller on amazon.com.
 *
 * Eight Sponsored Products campaigns and 120 search terms as 30-day totals,
 * built so the real harvest policy finds something to say: a run of terms
 * that clicked and never sold, a couple that burned budget on a small ad
 * group, a handful of auto-campaign winners worth an exact keyword, and the
 * brand's own name, which the policy must leave alone. Everything else is the
 * ordinary middle — converting, but not at target, or not often enough.
 *
 * Totals are scaled to the requested window and jittered with a seeded
 * generator, so a 7-day view looks different from a 30-day view and the same
 * window is byte-identical every time.
 */

const DAY_MS = 86_400_000;

export const DEMO_SELLER = {
  name: 'Aarohi Handicrafts', city: 'Jaipur', marketplace: 'amazon.com', brandTerms: ['aarohi'],
};

/** The objective the sample run was judged under. */
export const DEMO_OBJECTIVE = { targetAcos: 30, brandTerms: DEMO_SELLER.brandTerms };

export const DEMO_CAMPAIGNS = [
  { campaignId: 'demo-c1', keyword: 'brass diya set', adGroupId: 'demo-g1', name: 'Brass Diya Set | Exact',         targetingType: 'manual', matchType: 'EXACT',  dailyBudget: 25, state: 'enabled', startDate: '20260301' },
  { campaignId: 'demo-c2', keyword: 'close-match', adGroupId: 'demo-g2', name: 'Block Print Bedsheet | Auto',    targetingType: 'auto',   matchType: 'AUTO',   dailyBudget: 40, state: 'enabled', startDate: '20260301' },
  { campaignId: 'demo-c3', keyword: 'jute bag', adGroupId: 'demo-g3', name: 'Jute Tote | Broad',              targetingType: 'manual', matchType: 'BROAD',  dailyBudget: 20, state: 'enabled', startDate: '20260315' },
  { campaignId: 'demo-c4', keyword: 'hair oil', adGroupId: 'demo-g4', name: 'Ayurvedic Hair Oil | Phrase',    targetingType: 'manual', matchType: 'PHRASE', dailyBudget: 30, state: 'enabled', startDate: '20260401' },
  { campaignId: 'demo-c5', keyword: 'close-match', adGroupId: 'demo-g5', name: 'Handloom Cushion Covers | Auto', targetingType: 'auto',   matchType: 'AUTO',   dailyBudget: 35, state: 'enabled', startDate: '20260410' },
  { campaignId: 'demo-c6', keyword: 'copper water bottle', adGroupId: 'demo-g6', name: 'Copper Water Bottle | Exact',    targetingType: 'manual', matchType: 'EXACT',  dailyBudget: 30, state: 'enabled', startDate: '20260501' },
  { campaignId: 'demo-c7', keyword: 'wall art', adGroupId: 'demo-g7', name: 'Madhubani Wall Art | Broad',     targetingType: 'manual', matchType: 'BROAD',  dailyBudget: 15, state: 'paused',  startDate: '20260515' },
  { campaignId: 'demo-c8', keyword: 'close-match', adGroupId: 'demo-g8', name: 'Masala Dabba | Auto',            targetingType: 'auto',   matchType: 'AUTO',   dailyBudget: 25, state: 'enabled', startDate: '20260601' },
];

const byId = Object.fromEntries(DEMO_CAMPAIGNS.map((c) => [c.campaignId, c]));

/**
 * One 30-day row. `targeting` is the keyword/auto target the term matched;
 * for an exact campaign whose term equals its keyword the policy sees an
 * already-exact term and leaves it alone, which is the point of those rows.
 */
function row(campaignId, searchTerm, impressions, clicks, cost, purchases, sales, targeting = null) {
  const c = byId[campaignId];
  return {
    campaignId, campaignName: c.name, adGroupId: c.adGroupId, adGroupName: c.name.split(' | ')[0],
    matchType: c.matchType,
    // The keyword the campaign bids on, not the term — only the ALREADY_EXACT
    // rows pass their own term, which is what makes the policy skip them.
    targeting: targeting ?? c.keyword,
    searchTerm, impressions, clicks, cost: +cost.toFixed(2), purchases14d: purchases, sales14d: +sales.toFixed(2),
  };
}

// ── The populations ───────────────────────────────────────────────────────────
// Sales are in USD on amazon.com. AOV ≈ $18–$32 across the catalogue.

/** Clicked, never sold, past the policy's 40-click floor → NO_CONVERSION. */
const NO_CONVERSION = [
  ['demo-c1', 'brass polish',                 2100, 61, 38.40],
  ['demo-c1', 'diya stand for pooja',         1650, 44, 27.90],
  ['demo-c2', 'cheap bedsheets walmart',      3100, 72, 45.20],
  ['demo-c2', 'bedsheet king size clearance', 2400, 55, 36.10],
  ['demo-c3', 'jute rope',                    1900, 48, 22.60],
  ['demo-c4', 'hair oil for dogs',            1400, 52, 31.70],
  ['demo-c4', 'coconut oil cooking',          2600, 66, 39.80],
  ['demo-c5', 'cushion inserts 18x18',        2000, 58, 33.40],
  ['demo-c6', 'copper wire',                  1700, 47, 24.90],
  ['demo-c8', 'masala powder',                2900, 81, 44.60],
];

/** Fewer clicks, but the spend passed 2× the ad group's target CPA → WASTED_SPEND. */
const WASTED_SPEND = [
  ['demo-c7', 'wall art large canvas',  900, 31, 52.30],
  ['demo-c7', 'madhubani painting kit', 700, 26, 41.80],
];

/** Auto-campaign winners: ≥2 sales at or under 30% ACoS → ADD_EXACT. */
const PROMOTABLE = [
  ['demo-c2', 'block print bedsheet queen',   1200, 34, 19.80, 4, 118.00],
  ['demo-c2', 'indian cotton bedsheet',        980, 28, 16.20, 3,  87.00],
  ['demo-c5', 'handloom cushion cover set',   1100, 31, 17.40, 3,  74.00],
  ['demo-c5', 'boho cushion covers 16x16',     860, 24, 13.10, 2,  49.00],
  ['demo-c8', 'masala dabba stainless steel', 1300, 36, 21.60, 5, 132.00],
];

/** The brand's own name: sells or not, the policy must not negate it. */
const BRAND = [
  ['demo-c1', 'aarohi diya',        300, 9,  5.10, 0,  0],
  ['demo-c2', 'aarohi bedsheet',    420, 12, 6.80, 1, 29.00],
  ['demo-c6', 'aarohi copper bottle', 260, 8, 4.90, 0, 0],
  ['demo-c4', 'aarohi hair oil',    380, 11, 6.20, 1, 19.00],
  ['demo-c8', 'aarohi masala box',  210, 6,  3.40, 0, 0],
];

/** Already the exact keyword — converting terms the policy skips as ALREADY_EXACT. */
const ALREADY_EXACT = [
  ['demo-c1', 'brass diya set',           2800, 96, 58.10, 9, 214.00],
  ['demo-c1', 'brass diya for pooja',     1900, 71, 42.70, 6, 148.00],
  ['demo-c6', 'copper water bottle',      3300, 118, 71.20, 11, 296.00],
  ['demo-c6', 'copper water bottle 1 litre', 2100, 77, 46.80, 7, 189.00],
];

/** The ordinary middle: sells, but above target, or too rarely, or too few clicks. */
const MIDDLE_TERMS = [
  'block print quilt', 'cotton bedsheet set', 'indian bedsheet', 'jaipur print bedsheet', 'floral bedsheet queen',
  'jute tote bag', 'jute bag with zipper', 'eco friendly tote', 'market bag jute', 'jute shopping bag large',
  'ayurvedic hair oil', 'bhringraj oil', 'amla hair oil', 'herbal hair growth oil', 'hair oil for hair fall',
  'cushion covers 18x18', 'handloom cushion', 'indian cushion covers', 'block print cushion cover', 'cotton throw pillow cover',
  'madhubani art', 'indian wall art', 'folk art painting', 'handmade wall decor india', 'traditional indian painting',
  'masala box', 'spice box indian', 'spice container set', 'masala dabba with spoon', 'steel spice box',
  'diwali diya', 'pooja items', 'brass pooja set', 'oil lamp brass', 'decorative diya',
  'copper bottle for water', 'copper jug', 'ayurvedic copper bottle', 'copper water bottle 950ml', 'hammered copper bottle',
];

const CAMPAIGN_FOR_MIDDLE = ['demo-c2','demo-c2','demo-c2','demo-c2','demo-c2','demo-c3','demo-c3','demo-c3','demo-c3','demo-c3',
  'demo-c4','demo-c4','demo-c4','demo-c4','demo-c4','demo-c5','demo-c5','demo-c5','demo-c5','demo-c5',
  'demo-c7','demo-c7','demo-c7','demo-c7','demo-c7','demo-c8','demo-c8','demo-c8','demo-c8','demo-c8',
  'demo-c1','demo-c1','demo-c1','demo-c1','demo-c1','demo-c6','demo-c6','demo-c6','demo-c6','demo-c6'];

/** Small, seeded PRNG (mulberry32) so fixtures are deterministic. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function middleRows() {
  const rnd = mulberry32(hashSeed('aarohi-middle'));
  const out = [];
  MIDDLE_TERMS.forEach((term, i) => {
    const cid = CAMPAIGN_FOR_MIDDLE[i];
    const impressions = 400 + Math.floor(rnd() * 1800);
    const clicks = 6 + Math.floor(rnd() * 30);
    const cpc = 0.45 + rnd() * 0.5;
    const cost = clicks * cpc;
    // Three flavours: one sale (too few to promote), sells above target, or too few clicks.
    const flavour = i % 3;
    const purchases = flavour === 0 ? 1 : flavour === 1 ? 2 + Math.floor(rnd() * 2) : 1;
    const aov = 18 + rnd() * 14;
    // Above-target: ACoS pinned near 45%, comfortably over the 30% target.
    const sales = flavour === 1 ? cost / 0.45 : purchases * aov;
    out.push(row(cid, term, impressions, clicks, cost, purchases, sales));
  });
  // Bring the count to 120 with quiet long-tail terms: a few impressions, a click or two, nothing else.
  const tail = ['diya', 'bedsheet', 'tote', 'hair oil', 'cushion', 'wall art', 'spice', 'copper',
    'gift for diwali', 'indian home decor', 'boho decor', 'kitchen storage', 'organic oil', 'cotton sheets',
    'canvas bag', 'pooja thali', 'brass decor', 'ethnic home', 'handmade india', 'jaipur crafts',
    'wooden spice box', 'copper mug', 'hair serum', 'quilt cover', 'throw pillow', 'art print', 'steel bottle',
    'linen sheets', 'reusable bag', 'temple decor', 'oil lamp', 'bed cover', 'tote for women', 'scalp oil',
    'pillow case set', 'folk painting', 'spice jar', 'water jug', 'diwali decor set', 'bedding india',
    'shopping bag', 'castor oil', 'sofa cushion', 'living room art', 'masala container', 'copper tumbler',
    'brass lamp', 'king sheets', 'grocery tote', 'hair mask', 'floor cushion', 'painting for wall', 'spice rack', 'copper glass'];
  tail.forEach((term, i) => {
    const cid = DEMO_CAMPAIGNS[i % DEMO_CAMPAIGNS.length].campaignId;
    const impressions = 40 + Math.floor(rnd() * 260);
    const clicks = Math.floor(rnd() * 4);
    out.push(row(cid, term, impressions, clicks, clicks * (0.4 + rnd() * 0.5), 0, 0));
  });
  return out;
}

/** All 120 rows as 30-day totals. Stable across calls. */
export const DEMO_SEARCH_TERMS = [
  ...NO_CONVERSION.map(([c, t, i, k, cost]) => row(c, t, i, k, cost, 0, 0)),
  ...WASTED_SPEND.map(([c, t, i, k, cost]) => row(c, t, i, k, cost, 0, 0)),
  ...PROMOTABLE.map(([c, t, i, k, cost, p, s]) => row(c, t, i, k, cost, p, s)),
  ...BRAND.map(([c, t, i, k, cost, p, s]) => row(c, t, i, k, cost, p, s)),
  ...ALREADY_EXACT.map(([c, t, i, k, cost, p, s]) => row(c, t, i, k, cost, p, s, t)),
  ...middleRows(),
];

/** Inclusive day count of a YYYY-MM-DD window; 30 when unparseable. */
export function windowDays(startDate, endDate) {
  const a = Date.parse(`${startDate}T00:00:00Z`);
  const b = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 30;
  return Math.round((b - a) / DAY_MS) + 1;
}

/**
 * The rows for a window: totals scaled by days/30, each row jittered ±8% by a
 * generator seeded from the window and the row, so the same window is
 * byte-identical and a different one is visibly different.
 */
export function searchTermsFor(startDate, endDate) {
  const factor = windowDays(startDate, endDate) / 30;
  return DEMO_SEARCH_TERMS.map((r, i) => {
    const rnd = mulberry32(hashSeed(`${startDate}|${endDate}|${i}`));
    const j = () => 0.92 + rnd() * 0.16;
    const clicks = Math.round(r.clicks * factor * j());
    const purchases = Math.min(clicks, Math.round(r.purchases14d * factor * j()));
    return {
      ...r,
      impressions: Math.round(r.impressions * factor * j()),
      clicks,
      cost: +(r.cost * factor * j()).toFixed(2),
      purchases14d: purchases,
      sales14d: purchases === 0 ? 0 : +(r.sales14d * factor * j()).toFixed(2),
    };
  });
}

/** Per-campaign metrics for a window, in the campaign-report row shape. */
export function campaignMetricsFor(startDate, endDate) {
  const totals = new Map();
  for (const r of searchTermsFor(startDate, endDate)) {
    const t = totals.get(r.campaignId) ?? { impressions: 0, clicks: 0, cost: 0, purchases14d: 0, sales14d: 0 };
    t.impressions += r.impressions; t.clicks += r.clicks; t.cost += r.cost;
    t.purchases14d += r.purchases14d; t.sales14d += r.sales14d;
    totals.set(r.campaignId, t);
  }
  return DEMO_CAMPAIGNS.map((c) => {
    const t = totals.get(c.campaignId) ?? { impressions: 0, clicks: 0, cost: 0, purchases14d: 0, sales14d: 0 };
    return {
      campaignId: c.campaignId, campaignName: c.name, campaignStatus: c.state.toUpperCase(),
      campaignBudgetAmount: c.dailyBudget, campaignBiddingStrategy: 'LEGACY_FOR_SALES',
      impressions: t.impressions, clicks: t.clicks, cost: +t.cost.toFixed(2),
      purchases14d: t.purchases14d, sales14d: +t.sales14d.toFixed(2),
    };
  });
}
