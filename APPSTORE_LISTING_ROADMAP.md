# HIVE MIND AD OPTIMIZER
## Selling Partner Appstore Listing Roadmap
### Based on Official SP-API Documentation (May 2026)

---

## THE 10-STEP OFFICIAL PROCESS

Amazon's official onboarding path for public app developers:

```
Step 1  → Prepare for Registration
Step 2  → Create Solution Provider Portal (SPP) Account
Step 3  → Create Developer Profile
Step 4  → Register Sandbox Application
Step 5  → Make First SP-API Sandbox Call
Step 6  → Set Up Authorization Workflow (OAuth)
Step 7  → Register Production Application
Step 8  → Call SP-API in Production
Step 9  → Test Your Application
Step 10 → List Your Application ← GOAL
```

**Official docs:** https://developer-docs.amazon.com/sp-api/docs/selling-partner-api-onboarding-overview

---

## WHERE YOU STAND TODAY

### ✅ ALREADY DONE:
- SP-API developer registration (done for Hive Mind Nestor)
- Amazon Ads API OAuth implemented
- Profiles endpoint working (11 advertiser profiles)
- Production application registered
- SP-API compliance registration completed
- Website: hivemindnestor.com (live)
- Demo tool: optimizer.hivemindnestor.com (deployed)

### ❌ STILL NEEDED:
- SP-API (not Amazon Ads API) roles approved for public app
- OAuth flow via Seller Central (Appstore authorization workflow)
- Production SP-API calls on behalf of other sellers
- Website meets public developer guidelines
- App listing form submitted and approved
- 3-4 week review period

---

## PHASE 1: PREREQUISITES
### (1-2 weeks)

### 1.1 Clarify Which API You're Building On

**Critical distinction:**

| API | Purpose | Portal |
|-----|---------|--------|
| **Amazon Ads API** | PPC campaign management | advertising.amazon.com |
| **SP-API** | Orders, inventory, listings, reports | developer.amazonservices.com |

**AMAIOP uses Amazon Ads API primarily.**

The Selling Partner Appstore listing requires SP-API. You have two options:

**Option A:** List as **Amazon Ads API** app only (through Ads console)
- URL: https://advertising.amazon.com/API/docs/en-us/

**Option B:** List on **Selling Partner Appstore** via SP-API
- Requires SP-API integration (Brand Analytics API counts!)
- You already have Brand Analytics data → SP-API connection justifies listing

**Recommendation:** Go Option B. Use SP-API's Brand Analytics endpoint
as your SP-API integration hook. Then list AMAIOP as an advertising
optimization tool on the Appstore.

---

### 1.2 Confirm Developer Profile Status

**Check your current status:**
1. Go to: https://sellercentral.amazon.com/selling-partner-appstore/manage-your-apps
2. Check Developer Profile in Solution Provider Portal (SPP)
3. Verify your public developer registration is approved

**If not yet registered as PUBLIC developer:**
- URL: https://developer-docs.amazon.com/sp-api/docs/register-as-a-public-developer
- You need: Publicly accessible website (✅ hivemindnestor.com)
- Note: Public developers MUST list app in Appstore (it's mandatory)

---

### 1.3 Website Compliance Check

Amazon requires your website to meet specific guidelines before registration.

**Required on hivemindnestor.com:**

| Requirement | Status | Action |
|-------------|--------|--------|
| Publicly accessible (no login wall) | ✅ | - |
| No "under construction" pages | ✅ | - |
| No security warnings (HTTPS) | ✅ | - |
| Describes services for Amazon Sellers | ⚠️ | Update copy |
| Privacy Policy page | ❌ | Create this |
| Terms of Service page | ❌ | Create this |
| Data Protection policy | ❌ | Create this |
| Support/Contact page | ⚠️ | Verify exists |
| App description matches functionality | ⚠️ | Update for AMAIOP |

**Full website guidelines:**
https://developer-docs.amazon.com/sp-api/docs/website-guidelines

---

### 1.4 SP-API Roles to Request

For AMAIOP, request these roles in your developer profile:

| Role | Why Needed |
|------|-----------|
| **Brand Analytics** | Core feature - competitor intelligence |
| **Advertising** | Campaign data access |
| **Selling Partner Insights** | Performance metrics |
| **Reports** | Business reports access |

**Note:** If requesting restricted data roles (PII access), you need an
architecture review with SP-API Solutions Architecture team. AMAIOP
likely doesn't need PII roles.

---

## PHASE 2: TECHNICAL REQUIREMENTS
### (2-4 weeks)

### 2.1 OAuth Authorization Flow (MANDATORY)

For Appstore listing, sellers must be able to authorize your app from:
- **Seller Central** (Appstore authorization workflow)

**This is different from your current Amazon Ads OAuth.**

**What you need to build:**

```
Seller clicks "Authorize" in Appstore
    ↓
Amazon redirects to your app with authorization code
    ↓
Your app exchanges code for LWA tokens
    ↓
Store refresh token per seller account
    ↓
Make SP-API calls on their behalf
```

**Official guide:**
https://developer-docs.amazon.com/sp-api/docs/selling-partner-appstore-authorization-workflow

**Code needed in AMAIOP (src/api/routes/auth.js):**

```javascript
// Add SP-API OAuth endpoints alongside existing Amazon Ads OAuth

// Step 1: Build authorization URL
GET /api/auth/spapi/authorize
→ Redirect to: https://sellercentral.amazon.com/apps/authorize/consent?
    application_id=YOUR_APP_ID&
    state=YOUR_STATE_TOKEN&
    version=beta  // Remove for production

// Step 2: Handle callback
GET /api/auth/spapi/callback
→ Exchange code for LWA tokens
→ Store refresh_token per seller
→ Redirect to dashboard
```

---

### 2.2 Make at Least One SP-API Production Call

Amazon requires your app to actually make calls on behalf of a seller
before they'll approve the full listing.

**Easiest SP-API call to implement first:**

```javascript
// GET /sellers/v1/marketplaceParticipations
// Returns: marketplaces the seller participates in
// Role required: Selling Partner Insights (low-risk, easy to get)

const response = await axios.get(
  'https://sellingpartnerapi-na.amazon.com/sellers/v1/marketplaceParticipations',
  {
    headers: {
      'x-amz-access-token': accessToken,
      'x-amz-date': new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''),
    }
  }
);
```

**Then progressively add:**
1. Brand Analytics → Search Query Performance reports
2. Advertising → Campaign data (already have via Ads API)
3. Reports → Business reports

---

### 2.3 Sandbox Testing

Before production listing, test in SP-API sandbox:

```bash
# Sandbox base URL (US)
https://sandbox.sellingpartnerapi-na.amazon.com

# Test endpoint
GET /sellers/v1/marketplaceParticipations

# Sandbox doesn't need real credentials - uses test tokens
```

**Set up sandbox:**
https://developer-docs.amazon.com/sp-api/docs/sp-api-sandbox

---

### 2.4 Security Requirements

Amazon checks these for all public apps:

**Data Protection Policy (DPP) compliance:**
- [ ] All API data encrypted in transit (HTTPS) ✅
- [ ] Data encrypted at rest (if storing seller data)
- [ ] Refresh tokens stored securely (not in plain text)
- [ ] No sharing of seller data with third parties
- [ ] Data retention policy documented

**Acceptable Use Policy (AUP) compliance:**
- [ ] Only request data you actually need
- [ ] Don't use seller data for purposes beyond stated functionality
- [ ] Sellers can revoke access at any time

**Read both policies:**
https://developer-docs.amazon.com/sp-api/docs/policies-and-agreements

---

## PHASE 3: APP LISTING FORM
### (1 week to prepare)

Access at: Seller Central → Apps → Manage Your Apps → List New App

### 3.1 App Identity

| Field | Your Content |
|-------|-------------|
| **App Name** | Hive Mind Ad Optimizer |
| **Developer Name** | Hive Mind Nestor Private Limited |
| **App Category** | Advertising & Promotion |
| **Subcategory** | Advertising Optimization |
| **Supported Marketplaces** | US (start), expand later |
| **App URL** | https://optimizer.hivemindnestor.com |

---

### 3.2 App Description (Max 1,000 chars)

```
Hive Mind Ad Optimizer combines Amazon's Brand Analytics data with 
AI-powered analysis to help sellers maximize PPC efficiency.

Stop wasting ad spend. Our tool identifies which keywords you dominate,
which competitors are winning, and why — then gives you AI-powered 
recommendations in plain English.

Key capabilities:
• AI natural language interface — ask questions about your campaigns
• Brand Analytics integration — see your real market position
• Competitive intelligence — identify top competitors by keyword
• Price competitiveness alerts — know when to increase or pause spend
• One-click CSV export for reporting

Built for: Amazon advertising agencies, brand owners spending $2,000+ 
per month on PPC. Works best with Brand Registry sellers who have 
access to Brand Analytics.
```

*(approximately 850 chars — within 1,000 limit)*

---

### 3.3 App Features (Max 1,000 chars, bulleted)

```
• AI Campaign Analysis: Ask questions in plain English — "Which campaigns 
  should I pause?" — and get data-driven answers powered by Claude AI

• Brand Analytics Dashboard: Visualize your market share, keyword 
  rankings, and where competitors are beating you

• Competitor Intelligence: Auto-identify top competitor ASINs from 
  your Brand Analytics data across 874,000+ search terms

• Price Competitiveness Scoring: Score 0-100 showing if your pricing 
  is competitive on each active keyword

• Smart Alerts: Get notified when competitors go out of stock, drop 
  prices, or when you're advertising on unwinnable keywords

• Multi-Brand Support: Manage campaigns across multiple brands and 
  profiles from one dashboard

• Export & Reporting: One-click CSV export for client reporting
```

---

### 3.4 Who Should Use This App (Max 1,000 chars)

```
Hive Mind Ad Optimizer is designed for:

• Amazon advertising agencies managing multiple brand accounts
• Brand owners spending $2,000+ per month on Amazon PPC
• Sellers registered in Amazon Brand Registry with Brand Analytics access
• Sellers in competitive categories wanting data-driven bidding decisions

Requirements:
• Amazon Seller Central account (Professional plan)
• Amazon Brand Registry enrollment (for Brand Analytics features)
• Minimum $1,000/month Amazon PPC spend recommended for best ROI

Not suitable for:
• Sellers without active PPC campaigns
• Accounts without Brand Registry access (limited features available)

Supported marketplaces: United States (Amazon.com)
Additional marketplaces: Canada, Mexico — coming Q3 2026
```

---

### 3.5 Pricing Model

**Recommended structure for Appstore:**

```
Free Trial: 14 days (full access)

Starter: $49/month
- Up to 3 brand profiles
- AI campaign analysis
- Basic dashboard

Pro: $149/month
- Up to 10 brand profiles
- Brand Analytics integration
- Competitor intelligence
- Keepa price tracking (top 30 competitors)
- Priority support

Agency: $299/month
- Unlimited brand profiles
- White-label reporting
- Dedicated onboarding
- API access
```

---

### 3.6 Visual Assets Required

**Business Logo for detail page:**
- Size: 500 x 500 px minimum
- Format: PNG or JPG
- No Amazon trademarks
- Clean, professional

**Business Logo for category page:**
- Size: 1200 x 628 px (banner format)

**Feature Images (optional, up to 2):**
- Banner style
- Size: 1464 x 600 px recommended
- Show why sellers should use your app
- Screenshots of dashboard work well here

**What to create:**
1. Hive Mind Nestor logo (500x500) — clean version
2. App banner with dashboard screenshot (1200x628)
3. Two feature highlight images:
   - "Brand Analytics Dashboard" screenshot
   - "AI-Powered Recommendations" screenshot

---

## PHASE 4: REVIEW & APPROVAL
### (3-4 weeks after submission)

### 4.1 What Amazon Reviews

1. **Technical review** — Does the OAuth flow work? Are API calls valid?
2. **Policy review** — Does app comply with AUP and DPP?
3. **Content review** — Is the listing accurate and not misleading?
4. **Website review** — Does the website meet guidelines?

### 4.2 Common Rejection Reasons (Avoid These)

| Rejection Reason | How to Avoid |
|-----------------|-------------|
| Website not accessible | Keep hivemindnestor.com live always |
| No Privacy Policy | Add before submitting |
| OAuth flow broken | Test thoroughly before submission |
| App description too vague | Be specific about features |
| Claims about Amazon endorsement | Never imply Amazon affiliation |
| Using Amazon trademarks incorrectly | Remove from logo/name |
| App not making actual SP-API calls | Ensure at least one live call |

### 4.3 After Approval

- Amazon publishes app within **3-4 weeks** of approval
- You'll receive notification in case log
- App appears at: sellercentral.amazon.com/selling-partner-appstore
- You're automatically enrolled as a Software Partner
- Developer dashboard shows usage metrics

---

## PHASE 5: POST-LISTING GROWTH

### 5.1 Appstore Optimization (ASO)

**Category:** Advertising & Promotion → Advertising Optimization

**Keywords to target in description:**
- "Amazon PPC optimization"
- "Amazon advertising AI"
- "Brand Analytics tool"
- "ACoS optimization"
- "Amazon campaign management"

### 5.2 Getting Early Reviews

- Ask beta users (Queenza team first) to leave reviews
- Only verified users can leave reviews
- Must use app for some time before review is accepted

### 5.3 Metrics Amazon Tracks

- Number of authorizations (sellers who connect)
- Active authorizations (sellers still using)
- API call volume
- Error rates

---

## IMMEDIATE ACTION CHECKLIST

### This Week:
- [ ] Check developer profile status at developer.amazonservices.com
- [ ] Add Privacy Policy page to hivemindnestor.com
- [ ] Add Terms of Service page to hivemindnestor.com
- [ ] Add Data Protection/Privacy page to hivemindnestor.com
- [ ] Confirm SP-API roles include Brand Analytics

### Next 2 Weeks:
- [ ] Build SP-API OAuth flow in AMAIOP (src/api/routes/auth.js)
- [ ] Make first SP-API sandbox call successfully
- [ ] Test authorization workflow end-to-end
- [ ] Register production SP-API application

### Next Month:
- [ ] Create app listing assets (logo, banners, screenshots)
- [ ] Write final app listing content
- [ ] Submit "List Your App" form
- [ ] Begin 3-4 week review wait

---

## KEY URLS

| Resource | URL |
|---------|-----|
| SP-API Developer Hub | https://developer.amazonservices.com |
| Onboarding Steps | https://developer-docs.amazon.com/sp-api/docs/selling-partner-api-onboarding-overview |
| Register as Public Developer | https://developer-docs.amazon.com/sp-api/docs/register-as-a-public-developer |
| Website Guidelines | https://developer-docs.amazon.com/sp-api/docs/website-guidelines |
| OAuth Authorization Guide | https://developer-docs.amazon.com/sp-api/docs/selling-partner-appstore-authorization-workflow |
| List Your App Form | https://developer-docs.amazon.com/sp-api/docs/list-your-app-on-the-selling-partner-appstore |
| Policies & Agreements | https://developer-docs.amazon.com/sp-api/docs/policies-and-agreements |
| SP-API Sandbox | https://developer-docs.amazon.com/sp-api/docs/sp-api-sandbox |
| Manage Your Apps | https://sellercentral.amazon.com/selling-partner-appstore/manage-your-apps |
| Selling Partner Appstore | https://sellercentral.amazon.com/selling-partner-appstore |

---

**Estimated Timeline: 6-8 weeks from today to live listing**
**Effort: ~40 hours of development + 1 week of content creation**

---
*Generated: May 2026 | Based on official SP-API documentation*
