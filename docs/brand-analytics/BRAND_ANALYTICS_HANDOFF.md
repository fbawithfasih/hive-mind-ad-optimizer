# BRAND ANALYTICS + KEEPA INTEGRATION - HANDOFF DOCUMENT
## For Claude Code in VS Code | Project: ~/Projects/AMAIOP

**Date:** April 29, 2026
**Status:** Analysis complete in claude.ai → Ready to build in VS Code
**Project Path:** ~/Projects/AMAIOP

---

## 🎯 WHAT THIS PROJECT IS

**AMAIOP** = Amazon AI-Powered Optimizer (or similar)

A full-stack AI-powered Amazon Advertising management tool that helps agencies optimize PPC campaigns using Claude AI for natural language analysis.

### Tech Stack:
- **Backend:** Node.js, Express, ES6 modules (`"type": "module"` in package.json)
- **Frontend:** React, Vite, Tailwind CSS
- **AI:** Claude Sonnet via Anthropic API
- **Amazon:** Amazon Ads API (OAuth implemented, profiles working)
- **Port:** Backend 3000, Frontend 5174

### Brand Colors (Tailwind config):
- `darkInk` = #1C1C1C
- `ivory` = #F5F0E8
- `gold` = #C9A84C
- `walnut` = #4A3728

---

## 📁 RECOMMENDED FOLDER STRUCTURE TO CREATE

Run this in terminal first:

```bash
cd ~/Projects/AMAIOP

mkdir -p data/brand-analytics
mkdir -p data/keepa
mkdir -p scripts/brand-analytics
mkdir -p docs/brand-analytics
mkdir -p src/services/brand-analytics
mkdir -p frontend/src/components/BrandAnalytics
```

### Where to place the downloaded files:

```
~/Projects/AMAIOP/
├── data/
│   ├── brand-analytics/
│   │   ├── Top_Search_Terms.csv                    ← 470MB Q1 2026 report
│   │   ├── US_Search_Query_Performance_*.csv       ← Q1 2026 query report
│   │   ├── US_Search_Catalog_Performance_*.csv     ← Q1 2026 catalog report
│   │   ├── queenza_competitors_analysis.json       ← Analysis output
│   │   └── queenza-ba-summary.json                 ← Summary stats
│   └── keepa/
│       └── keepa_tracking_asins.txt                ← 30 competitor ASINs
│
├── scripts/
│   └── brand-analytics/
│       ├── analyze_queenza_full.py                 ← Python analyzer (470MB)
│       └── analyze-queenza-ba.js                   ← Node.js analyzer
│
├── docs/
│   ├── BRAND_ANALYTICS_HANDOFF.md                  ← THIS FILE
│   └── brand-analytics/
│       ├── QUEENZA_COMPETITOR_INTELLIGENCE_REPORT.md
│       └── QUEENZA_BRAND_ANALYTICS_INSIGHTS.md
│
└── KEEPA_INTEGRATION_GUIDE.md                      ← Root level (existing)
```

---

## 📊 ANALYSIS ALREADY COMPLETED (in claude.ai)

### Data Processed:
| Report | Records | Findings |
|--------|---------|----------|
| Top Search Terms Q1 2026 | 874,425 keywords | 105 Queenza-relevant |
| Search Query Performance | 3,000 keywords | Queenza's visibility data |
| Catalog Performance | 56 ASINs | Product-level metrics |

### Key Metrics for Queenza (Q1 2026):
| Metric | Value |
|--------|-------|
| Total Products (ASINs) | 56 |
| Brand Impressions | 399,697 |
| Brand Clicks | 8,603 |
| Brand Purchases | 472 |
| CTR | 2.15% |
| Conversion Rate | 5.49% |
| Avg Brand Price | $93.61 |
| Avg Market Price | $22.06 |
| Price Premium | 324% above market |

---

## 🚨 CRITICAL FINDING

**Queenza ranks 0/0/0 in the top 3 clicked products for ALL 105 relevant keywords.**

Despite appearing in 3,000+ search results, Queenza is never in the top 3 most-clicked positions for high-relevance keywords like "marble salt cellar", "salt cellar with lid", "marble tray" etc.

**Why this matters for the tool:**
This is the kind of insight that Hive Mind Ad Optimizer should surface automatically for clients. If you're spending PPC budget on keywords where you can't break into top 3, you're wasting money.

---

## 🏆 TOP 5 QUEENZA PRODUCTS (Star Performers)

```javascript
const queenzaTopProducts = [
  {
    asin: 'B0926QF71K',
    title: 'White Marble Salt Cellar with Lid and Brass Knob',
    impressions: 180675,
    clicks: 3255,
    purchases: 141,
    ctr: '1.80%',
    convRate: '4.33%'
  },
  {
    asin: 'B08N1B3W2G',
    title: 'White Marble Salt Cellar with Lid (Standard)',
    impressions: 113482,
    clicks: 1755,
    purchases: 81,
    ctr: '1.55%',
    convRate: '4.62%'
  },
  {
    asin: 'B095WLBYPZ',
    title: 'Green Marble Salt Cellar with Brass Knob',
    impressions: 95247,
    clicks: 1605,
    purchases: 31,
    ctr: '1.69%',
    convRate: '1.93%'   // ⚠️ Low - needs investigation
  },
  {
    asin: 'B09Z28W5CN',
    title: 'Salt Cellar with Lid & Brass Knob (Makrana Marble)',
    impressions: 88302,
    clicks: 1375,
    purchases: 81,
    ctr: '1.56%',
    convRate: '5.89%'
  },
  {
    asin: 'B092B3JWPR',
    title: 'Brown Marble Salt Cellar with Lid and Brass Knob',
    impressions: 87858,
    clicks: 1494,
    purchases: 63,
    ctr: '1.70%',
    convRate: '4.22%'
  }
];
```

---

## 🎯 TOP 30 COMPETITOR ASINs FOR KEEPA TRACKING

```javascript
// data/keepa/keepa_tracking_asins.txt
// Copy-paste this into Keepa for bulk tracking

const keepaTrackingList = [
  // SALT CELLAR COMPETITORS (Most Critical)
  { asin: 'B003PBHGHG', brand: 'KooK', note: 'Bamboo - 13 keywords, 10.63% conv share' },
  { asin: 'B09Z78M1KV', brand: 'ThougrLyh', note: 'Bamboo - 12 keywords, 10.36% conv share' },
  { asin: 'B07STN8DRL', brand: 'Kaizen Casa', note: 'Acacia Wood - 12 keywords, 8.47% conv share' },
  { asin: 'B0BJ7K8C4Y', brand: 'KooK', note: 'Glass Salt Cellar - 3 keywords' },
  { asin: 'B0F198R28F', brand: 'Le Creuset', note: 'PREMIUM - Ceramic Salt Cellar, 8.93% click share' },

  // MARBLE TRAY COMPETITORS
  { asin: 'B07RHLSJPK', brand: 'Luxspire', note: 'Resin Tray - 6 keywords' },
  { asin: 'B0C4KQF1V8', brand: 'Lyxel', note: 'Travertine Tray - 5 keywords' },
  { asin: 'B0D4F55946', brand: 'MULWR', note: 'Real Marble Tray - DIRECT competitor' },
  { asin: 'B0DJTLLX4B', brand: 'Bloomingville', note: 'Marble Bowl - 3 keywords' },

  // STONE/MARBLE COASTER COMPETITORS
  { asin: 'B0BPMB1Y13', brand: 'Hoewina', note: 'Diatomite Coasters - 9 keywords' },
  { asin: 'B0D4YQKKL7', brand: 'Lyxel', note: 'Stone Tray - 6 keywords' },
  { asin: 'B0CFLH8P7F', brand: 'YOULTTAN', note: 'Marble-style Ceramic Coasters - 5 keywords' },
  { asin: 'B0018NNCDA', brand: 'Thirstystone', note: 'Natural Stone Coasters - 2 keywords' },

  // SPOON REST COMPETITORS
  { asin: 'B0BW5NJYBS', brand: 'Cormomu', note: 'Ceramic - 10 keywords' },
  { asin: 'B07PVBS863', brand: 'Zulay Kitchen', note: 'Silicone - 5 keywords' },
  { asin: 'B0CB8Y4LZ2', brand: 'TOPYOKK', note: 'Coffee Bar Spoon Rest - 3 keywords' },
  { asin: 'B0CL4R55DR', brand: 'Tikooere', note: 'Ceramic Leaf - 4 keywords' },
  { asin: 'B09BTMHL81', brand: 'DAYYET', note: 'Large Ceramic - 3 keywords' },
  { asin: 'B0DRYJC528', brand: 'Rhobtyne', note: 'Coffee Spoon Rest - 3 keywords' },
  { asin: 'B08FBMD3D6', brand: 'OXO', note: 'Stainless + Lid Holder - 2 keywords' },
  { asin: 'B08QW6FZ6S', brand: 'Le Creuset', note: 'PREMIUM Heart Spoon Rest - 25.18% click share!' },
  { asin: 'B0CM42Z5K9', brand: 'Le Creuset', note: 'PREMIUM White Spoon Rest - 18.93% click share' },

  // SPECIALTY COMPETITORS
  { asin: 'B0CR4GV76W', brand: 'Unknown', note: 'Salt container category' },
  { asin: 'B07JMGR7XJ', brand: 'Unknown', note: 'Salt holder category' },
  { asin: 'B0CW9YNXKN', brand: 'Unknown', note: 'Salt cellar category' },
  { asin: 'B0DQP3C7SG', brand: 'Unknown', note: 'Salt cellar category' },
  { asin: 'B0BJTBMF7D', brand: 'Unknown', note: 'Salt cellar category' },

  // TAJ MAHAL (Competitors for "taj mahal" searches - likely irrelevant)
  { asin: 'B08STQBXN4', brand: 'LEGO', note: 'LEGO Taj Mahal - 43.64% click share (NOT a direct competitor)' },
  { asin: 'B0784P9LQV', brand: 'APENGBAOL', note: 'LEGO Creator Taj Mahal (NOT a direct competitor)' },
  { asin: 'B0F8NTLFCR', brand: 'APENGBAOL', note: 'Mini Taj Mahal Building Blocks (NOT a direct competitor)' }
];

// For Keepa bulk import (comma-separated):
// B003PBHGHG,B09Z78M1KV,B07STN8DRL,B0BW5NJYBS,B0BPMB1Y13,B0D4YQKKL7,B07RHLSJPK,B07PVBS863,B0CFLH8P7F,B0C4KQF1V8,B0D4F55946,B0CR4GV76W,B07JMGR7XJ,B0CW9YNXKN,B0DQP3C7SG,B0BJTBMF7D,B0CL4R55DR,B08QW6FZ6S,B0F198R28F,B0BJ7K8C4Y,B0CB8Y4LZ2,B0DJTLLX4B,B0DRYJC528,B09BTMHL81,B08STQBXN4,B0CM42Z5K9,B0784P9LQV,B0018NNCDA,B0F8NTLFCR,B08FBMD3D6
```

---

## 🛠️ WHAT TO BUILD NEXT (Phase by Phase)

### Phase 1: Brand Analytics Backend (START HERE)

**File:** `src/services/brand-analytics/parser.js`

```javascript
// Functions to implement:

// 1. Parse Search Query Performance Report
export function parseSearchQueryReport(csvPath)
// Input: CSV path
// Output: Array of { searchTerm, impressionShare, clickShare, purchaseShare, volume }

// 2. Parse Catalog Performance Report
export function parseCatalogReport(csvPath)
// Input: CSV path
// Output: Array of { asin, title, category, impressions, clicks, purchases, convRate }

// 3. Parse Top Search Terms (handles large files efficiently)
export function parseTopSearchTermsReport(csvPath, filterKeywords)
// Input: CSV path + keywords to filter for
// Output: { relevantKeywords, competitors, queenzaAppearances }

// 4. Identify brand's ASINs from the data
export function identifyBrandASINs(searchTermData, brandName)
// Input: parsed data + brand name
// Output: Array of ASINs belonging to brand

// 5. Find competitor ASINs
export function identifyCompetitors(searchTermData, brandASINs, maxResults = 30)
// Input: parsed data + brand's ASINs
// Output: Ranked array of competitor ASINs with stats

// 6. Calculate market share
export function calculateMarketShare(searchTermData, targetASIN)
// Input: parsed data + ASIN to analyze
// Output: { visibilityRate, avgPosition, topPosition, secondPosition, thirdPosition }

// 7. Find opportunity keywords
export function getOpportunityKeywords(searchTermData, brandASINs)
// Input: parsed data + brand's ASINs
// Output: Keywords with high volume but low brand share
```

**File:** `src/services/brand-analytics/analytics.js`

```javascript
// Higher-level analytics built on top of parser.js

export function getBrandSummary(catalogData, searchQueryData)
// Returns: full brand health summary

export function getCompetitorIntelligence(searchTermData, brandASINs)
// Returns: ranked competitors with click/conv share analysis

export function getDominantKeywords(searchQueryData, brandASINs)
// Returns: keywords where brand has >10% purchase share

export function getWeakKeywords(searchQueryData, brandASINs)
// Returns: keywords with visibility but low conversion (opportunity list)
```

---

### Phase 2: API Routes

**File:** `src/api/routes/brand-analytics.js`

```javascript
// Mount at: /api/brand-analytics

GET  /summary              → Brand performance overview
GET  /competitors          → Top competitor ASINs + stats
GET  /opportunities        → High-volume, low-share keywords
GET  /dominant-keywords    → Keywords brand already wins
POST /upload               → Upload new BA CSV files
GET  /market-share/:asin   → Market position for specific ASIN
```

**Update:** `src/api/routes/index.js`
```javascript
// Add:
import brandAnalyticsRouter from './brand-analytics.js';
router.use('/brand-analytics', brandAnalyticsRouter);
```

---

### Phase 3: Frontend Components

**Directory:** `frontend/src/components/BrandAnalytics/`

```
BrandAnalytics/
├── index.js                    ← Export all components
├── UploadCSV.jsx               ← Drag & drop CSV upload
├── MarketPositionWidget.jsx    ← "You are #2 with 28.5% visibility"
├── CompetitorsList.jsx         ← Top 10 competitors ranked
├── OpportunityKeywords.jsx     ← High-volume keywords to target
├── DominantKeywords.jsx        ← Keywords you already win
└── BrandHealthScore.jsx        ← Overall brand health 0-100
```

**Update:** `frontend/src/pages/Dashboard.jsx`
```jsx
// Add Brand Analytics section between SummaryCards and CampaignTable
import { MarketPositionWidget, CompetitorsList, OpportunityKeywords } from '../components/BrandAnalytics';
```

---

### Phase 4: Enhanced AI Prompts

**Update:** `src/services/claude-mcp.js`

```javascript
// Add Brand Analytics context to Claude prompts:

async function buildContext(campaigns, brandAnalyticsData) {
  return `
CAMPAIGN PERFORMANCE:
${JSON.stringify(campaigns)}

BRAND ANALYTICS INTELLIGENCE (from Amazon's own data):
- Market Position: #${brandAnalyticsData.position} in category
- Visibility Rate: ${brandAnalyticsData.visibilityRate}% across ${brandAnalyticsData.totalKeywords} keywords
- Overall Conversion Rate: ${brandAnalyticsData.convRate}%
- Price Position: ${brandAnalyticsData.priceVsMarket}% above market average

TOP COMPETITORS IDENTIFIED:
${brandAnalyticsData.competitors.slice(0, 5).map(c =>
  `- ${c.asin}: ${c.avgClickShare}% avg click share, appears in ${c.appearances} keywords`
).join('\n')}

OPPORTUNITY KEYWORDS (high volume, low brand share):
${brandAnalyticsData.opportunities.slice(0, 5).map(k =>
  `- "${k.term}": ${k.volume} searches/month, only ${k.brandShare}% brand share`
).join('\n')}

KEYWORDS BRAND DOMINATES:
${brandAnalyticsData.dominant.slice(0, 5).map(k =>
  `- "${k.term}": ${k.purchaseShare}% purchase share`
).join('\n')}
  `;
}
```

---

## 💰 BUSINESS CASE SUMMARY

### Cost:
| Item | Monthly Cost |
|------|-------------|
| Keepa API (Starter) | $19 |
| Hosting (Railway/Render) | $5 |
| **Total** | **$24/month** |

### Value per Client (e.g., Queenza spending $5K/month on PPC):
| Impact | Monthly Value |
|--------|--------------|
| Reduce wasted PPC spend (50% of 35% waste) | $875 saved |
| Keepa cost | -$19 |
| **Net savings** | **$856/month** |
| **Annual savings** | **$10,272** |

### Pricing Tiers:
- **Free:** Basic dashboard, mock data
- **Pro ($99/month):** Real Ads API + Brand Analytics
- **Enterprise ($199/month):** Pro + Keepa price intelligence

---

## 🔄 HOW TO CONTINUE IN VS CODE

### Starting a new Claude Code session:

```
Claude, I'm continuing work on AMAIOP (Amazon AI-Powered Optimizer).

Please read these files first:
1. docs/BRAND_ANALYTICS_HANDOFF.md - master context document
2. KEEPA_INTEGRATION_GUIDE.md - integration plan (already exists)

Then let's build Phase 1: the Brand Analytics parser service.
Start with: src/services/brand-analytics/parser.js
```

### If Claude Code asks what the project does:

> AMAIOP is a full-stack AI-powered Amazon PPC optimizer. 
> Backend: Node.js/Express ES6 on port 3000.
> Frontend: React/Vite/Tailwind on port 5174.
> AI: Claude API for natural language campaign analysis.
> Current feature: Amazon Ads API integration (OAuth + profiles working).
> Building now: Brand Analytics module to show competitive intelligence.

---

## ⚠️ IMPORTANT NOTES

1. **Large CSV files** - Add to `.gitignore`:
   ```
   data/brand-analytics/*.csv
   ```

2. **ES6 modules** - Project uses `"type": "module"`, all imports use ES6 syntax

3. **Tailwind classes** - Use existing color tokens: `bg-darkInk`, `text-ivory`, `text-gold`, `bg-walnut`

4. **Error handling** - All async functions should have try/catch

5. **CORS** - Backend has CORS configured for frontend at port 5174

---

**END OF HANDOFF DOCUMENT**
