import dotenv from 'dotenv';

dotenv.config({ override: true });

const GEMINI_API_KEY    = process.env.GOOGLE_AI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

const SYSTEM_PROMPT = `You are an Amazon Advertising analyst. The user sends campaign data as JSON and asks a question.

Rules:
- Always respond in clean GitHub-flavored Markdown.
- When listing multiple campaigns or search terms, ALWAYS use a properly formatted GFM table (pipe syntax with header separator row).
- Never output raw JSON or pipe-separated text outside a table.
- Format all numbers: dollars as $1,234.56, percentages as 12.5%, large integers with commas.
- Lead with a one-sentence summary in bold, then supporting details.
- Keep answers concise and data-driven.

Search term analysis rules:
- When analyzing search terms, always reference the recommendation field (SCALE_UP, ADD_EXACT, ADD_NEGATIVE, WATCH) and explain the specific reason for each recommendation.
- Negative keyword suggestions must specify the recommended match type (broad, phrase, or exact) and the exact campaign and ad group to apply them to.
- Scale-up suggestions should cite the specific search term's ROAS and ACoS, and recommend a concrete bid increase percentage (e.g. "increase bid by 20%").
- Add-as-exact suggestions should explain the conversion potential and recommend creating a new exact match keyword in the relevant ad group.`;

const LISTING_SYSTEM_PROMPT = `You are an Amazon listing optimization expert.
You will receive a product's current listing content, a set of high-performing search terms from the product's ad campaigns, and optionally a list of manually selected priority keywords uploaded by the user.

Rules:
- Respond ONLY with valid JSON in exactly this shape (no markdown fences, no extra text):
  {"title":"...","bullets":["...","...","...","...","..."],"description":"..."}
- Title: max 200 characters, front-load the single most important keyword, keep it natural and readable.
- Bullets: exactly 5 items, start each with a capitalized benefit phrase (e.g. "SUPERIOR QUALITY —"), weave in keywords naturally, max 255 chars each.
- Description: 400-1000 characters, include brand story + key use cases + secondary keywords, readable paragraphs.
- If PRIORITY KEYWORDS (user-uploaded) are provided, you MUST include as many of them as naturally possible in the title, bullets and description. These take highest priority over campaign search terms.
- After incorporating priority keywords, use campaign search terms (SCALE_UP first, then ADD_EXACT).
- Do not keyword-stuff — listings must read naturally for human shoppers.`;

async function callGemini(userCommand, conversationHistory = [], systemPrompt = SYSTEM_PROMPT, generationConfigOverrides = {}) {
  const geminiHistory = conversationHistory
    .filter((m) => typeof m.content === 'string')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [
      ...geminiHistory,
      { role: 'user', parts: [{ text: userCommand }] },
    ],
    generationConfig: { maxOutputTokens: 4096, ...generationConfigOverrides },
  };

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Gemini API error ${res.status}: ${err?.error?.message ?? res.statusText}`);
  }

  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
}

async function callClaude(userCommand, conversationHistory = [], systemPrompt = SYSTEM_PROMPT, maxTokens = 4096) {
  const messages = [
    ...conversationHistory
      .filter((m) => typeof m.content === 'string')
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
    { role: 'user', content: userCommand },
  ];

  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Claude API error ${res.status}: ${err?.error?.message ?? res.statusText}`);
  }

  const json = await res.json();
  if (json.stop_reason === 'max_tokens') {
    console.warn(`⚠️  Claude hit max_tokens (${maxTokens}) — response was truncated`);
  }
  return json.content?.map((b) => b.text).join('') ?? '';
}

/**
 * Execute a natural-language command against campaign/search-term data.
 */
export async function executeMCPCommand(userCommand, conversationHistory = [], model = 'gemini') {
  const summary = model === 'claude'
    ? await callClaude(userCommand, conversationHistory)
    : await callGemini(userCommand, conversationHistory);

  const updatedHistory = [
    ...conversationHistory,
    { role: 'user', content: userCommand },
    { role: 'assistant', content: summary },
  ];

  return { data: [], summary, conversationHistory: updatedHistory, model };
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Reporting Agent
// ─────────────────────────────────────────────────────────────────────────────

const REPORT_SYSTEM_PROMPT = `You are a senior Amazon advertising analyst and business consultant specializing in Amazon Seller Central reporting for brands and agencies.

You receive structured campaign metrics and search term data from the Amazon Ads API and generate comprehensive, presentation-ready business reports.

Formatting rules (STRICT):
- Use clean GitHub-flavored Markdown with proper heading hierarchy (##, ###)
- Every data table MUST have a header row AND a separator row (| --- | --- |)
- Currency: $1,234.56 format. Percentages: 12.3% format. Large integers: 1,234 commas.
- Lead each section with a one-line insight in bold before the table or bullets
- Bullet action items use "**Action:**" prefix for emphasis
- Tone: professional, data-driven, concise — like a consultant report
- Do NOT include caveats about data freshness or API limitations
- Always start with a report title line: # [Report Type] and a metadata line`;

const REPORT_SECTIONS = {
  WBR: `
1. # Weekly Business Report header with period and generation note
2. ## Executive Summary — 4 sentences: total spend, revenue, ACoS, ROAS, and one insight
3. ## Performance Dashboard — table with 8 rows: Spend, Revenue, ACoS, ROAS, Impressions, Clicks, CTR, Orders
4. ## Campaign Performance — table of ALL campaigns (sorted by spend desc): Campaign, Status, Spend, Revenue, ACoS, ROAS, Orders, Budget
5. ## Top Converting Search Terms — table of top 15 SCALE_UP terms: Term, Spend, Revenue, ACoS, ROAS, Orders, Campaign
6. ## Wasted Spend & Negative Keywords — table of top 12 ADD_NEGATIVE terms: Term, Wasted Spend, Clicks, Campaign, Recommended Match Type
7. ## Budget Analysis — paragraph analyzing budget utilization + table of top/bottom spenders
8. ## 5 Priority Actions for Next 7 Days — numbered list, each starting with "**Action:**"`,

  MBR: `
1. # Monthly Business Report header
2. ## Executive Summary — 5 sentences covering month performance, key wins, key issues
3. ## Monthly Performance Dashboard — table: Spend, Revenue, ACoS, ROAS, Impressions, Clicks, CTR, Conversion Rate, Total Orders
4. ## Campaign Portfolio Breakdown — two small tables: (a) by Status, (b) by Bidding Strategy — show campaign count and total spend per group
5. ## Top 10 Campaigns by Revenue — full metrics table
6. ## Bottom 5 Campaigns (High ACoS / Low Revenue) — table with remediation notes
7. ## Search Term Intelligence — summary table: Category, Count, Spend, Revenue; plus top 10 scale-up terms
8. ## Wasted Spend Analysis — total wasted spend figure + top 10 negative keyword recommendations with match types
9. ## Budget Optimization Opportunities — identify over/under-spending campaigns
10. ## 7 Strategic Recommendations — numbered list with "**Action:**" prefix
11. ## Next Month Action Plan — 3-5 bullet priorities`,

  AUDIT: `
1. # Campaign Performance Audit header
2. ## Account Health Overview — paragraph summary + quick-stats table (total campaigns, active, paused, archived, total budget, total spend, total revenue, overall ACoS, overall ROAS)
3. ## Campaign Status Breakdown — table: Status, Count, % of Total, Total Spend, Total Revenue, Avg ACoS
4. ## Bidding Strategy Analysis — table: Strategy, Campaign Count, Total Spend, Total Revenue, Avg ACoS, Avg ROAS
5. ## Full Campaign Performance Table — table of top 20 campaigns by spend with all metrics
6. ## ACoS Distribution Analysis — table of ACoS tiers: <15%, 15-25%, 25-40%, 40-70%, >70% — with campaign count and spend per tier
7. ## Budget Utilization — identify campaigns spending >95% of budget (risk of missing impressions) and campaigns spending <50% (possible bid issues)
8. ## Underperforming Campaigns Action Plan — table of worst 8 campaigns with specific recommended fixes
9. ## 10 Prioritized Optimization Recommendations — numbered, with "**Action:**" prefix and expected impact`,

  SEARCH: `
1. # Search Term Intelligence Report header
2. ## Executive Summary — search term landscape in 3-4 sentences with key numbers
3. ## Search Term Landscape Overview — table: Category, Count, Total Spend, Total Revenue, Avg ACoS — for SCALE_UP, ADD_EXACT, ADD_NEGATIVE, WATCH
4. ## High-Value Terms — Scale Up Bids — table of top 20 SCALE_UP terms: Term, Spend, Revenue, ACoS, ROAS, Orders, Current Campaign, Recommended Bid Action
5. ## Exact Match Keyword Opportunities — table of top 20 ADD_EXACT terms: Term, Spend, Revenue, ACoS, Purchases, Campaign, Recommended Action
6. ## Negative Keyword Recommendations — table of top 20 ADD_NEGATIVE terms: Term, Wasted Spend, Clicks, CPC, Campaign, Recommended Match Type (broad/phrase/exact)
7. ## Wasted Spend Summary — total dollar amount + paragraph on impact + top 5 worst offenders
8. ## Campaign-Level Search Term Health — table per campaign: Campaign Name, Total Terms, SCALE_UP, ADD_EXACT, ADD_NEGATIVE, Health Score
9. ## Implementation Priority List — ordered action plan (do this week, do this month)`,

  OVERVIEW: `
1. # Account Overview header
2. ## Account Snapshot — quick stats table (total campaigns, active %, total daily budget, total spend period, total revenue, overall ACoS, overall ROAS)
3. ## Campaign Portfolio Summary — by status table + by bidding strategy table
4. ## Performance KPIs — table with benchmarks: Metric, Value, Amazon Benchmark, Status (Good/Warning/Critical)
5. ## Search Term Health Summary — overview table + paragraph
6. ## Top 5 Quick Wins — specific, high-impact actions achievable in the next 48 hours
7. ## Account Health Assessment — overall rating (Strong/Good/Needs Attention/Critical) with 3-sentence justification`,
};

/**
 * Generate a professional Amazon advertising report from campaign + search term data.
 */
export async function generateAmazonReport({ reportType, startDate, endDate, campaigns, searchTerms, model = 'claude' }) {
  // Pre-compute aggregates
  const totalSpend      = campaigns.reduce((s, c) => s + (c.spend || 0), 0);
  const totalSales      = campaigns.reduce((s, c) => s + (c.sales || 0), 0);
  const totalClicks     = campaigns.reduce((s, c) => s + (c.clicks || 0), 0);
  const totalImpressions = campaigns.reduce((s, c) => s + (c.impressions || 0), 0);
  const totalOrders     = campaigns.reduce((s, c) => s + (c.purchases || 0), 0);
  const totalBudget     = campaigns.reduce((s, c) => s + (c.budget || 0), 0);
  const overallACoS     = totalSales > 0 ? (totalSpend / totalSales * 100).toFixed(1) : 'N/A';
  const overallROAS     = totalSpend > 0 ? (totalSales / totalSpend).toFixed(2) : 'N/A';
  const overallCTR      = totalImpressions > 0 ? (totalClicks / totalImpressions * 100).toFixed(3) : 'N/A';
  const convRate        = totalClicks > 0 ? (totalOrders / totalClicks * 100).toFixed(2) : 'N/A';

  // Campaign breakdowns
  const byStatus = {};
  const byStrategy = {};
  for (const c of campaigns) {
    byStatus[c.status] = (byStatus[c.status] || 0) + 1;
    if (c.strategy) byStrategy[c.strategy] = (byStrategy[c.strategy] || 0) + 1;
  }

  const sorted = [...campaigns].sort((a, b) => (b.spend || 0) - (a.spend || 0));
  const worstAcos = [...campaigns]
    .filter(c => c.spend > 0 && c.acos != null && c.acos > 0)
    .sort((a, b) => (b.acos || 0) - (a.acos || 0))
    .slice(0, 10);

  // Search term breakdowns
  const scaleUp   = searchTerms.filter(t => t.recommendation === 'SCALE_UP');
  const addExact  = searchTerms.filter(t => t.recommendation === 'ADD_EXACT');
  const addNeg    = searchTerms.filter(t => t.recommendation === 'ADD_NEGATIVE');
  const watch     = searchTerms.filter(t => t.recommendation === 'WATCH');
  const wastedSpend = addNeg.reduce((s, t) => s + (t.cost || 0), 0);

  const topScaleUp = [...scaleUp].sort((a, b) => (b.sales || 0) - (a.sales || 0)).slice(0, 30);
  const topExact   = [...addExact].sort((a, b) => (b.purchases || 0) - (a.purchases || 0)).slice(0, 25);
  const topNeg     = [...addNeg].sort((a, b) => (b.cost || 0) - (a.cost || 0)).slice(0, 25);

  const reportLabels = {
    WBR: 'Weekly Business Report',
    MBR: 'Monthly Business Report',
    AUDIT: 'Campaign Performance Audit',
    SEARCH: 'Search Term Intelligence Report',
    OVERVIEW: 'Account Overview',
  };

  const sections = REPORT_SECTIONS[reportType] ?? REPORT_SECTIONS.OVERVIEW;

  const userPrompt = `Generate a professional Amazon Advertising ${reportLabels[reportType] ?? 'Report'} for the period ${startDate} to ${endDate}.

## ACCOUNT AGGREGATES
- Campaigns: ${campaigns.length} total | ${byStatus['enabled'] ?? byStatus['active'] ?? 0} active | ${byStatus['paused'] ?? 0} paused | ${byStatus['archived'] ?? byStatus['ended'] ?? 0} archived
- Total Daily Budget: $${totalBudget.toFixed(2)}
- Total Ad Spend: $${totalSpend.toFixed(2)}
- Total Ad Revenue: $${totalSales.toFixed(2)}
- Overall ACoS: ${overallACoS}%
- Overall ROAS: ${overallROAS}x
- Total Impressions: ${totalImpressions.toLocaleString()}
- Total Clicks: ${totalClicks.toLocaleString()}
- Overall CTR: ${overallCTR}%
- Total Orders: ${totalOrders.toLocaleString()}
- Conversion Rate: ${convRate}%

## STATUS BREAKDOWN
${JSON.stringify(byStatus)}

## BIDDING STRATEGY BREAKDOWN
${JSON.stringify(byStrategy)}

## ALL CAMPAIGNS (${campaigns.length}, sorted by spend desc)
${JSON.stringify(sorted.slice(0, 50).map(c => ({
  name: c.name, status: c.status, budget: c.budget?.toFixed(2),
  spend: c.spend?.toFixed(2), sales: c.sales?.toFixed(2),
  acos: c.acos, roas: c.roas?.toFixed(2),
  clicks: c.clicks, impressions: c.impressions,
  purchases: c.purchases, ctr: c.ctr, strategy: c.strategy,
  topOfSearch: c.topOfSearch,
})))}

## WORST ACoS CAMPAIGNS
${JSON.stringify(worstAcos.map(c => ({ name: c.name, spend: c.spend?.toFixed(2), sales: c.sales?.toFixed(2), acos: c.acos, purchases: c.purchases })))}

## SEARCH TERMS SUMMARY
- Total: ${searchTerms.length} | SCALE_UP: ${scaleUp.length} | ADD_EXACT: ${addExact.length} | ADD_NEGATIVE: ${addNeg.length} | WATCH: ${watch.length}
- Estimated Wasted Spend (non-converting): $${wastedSpend.toFixed(2)}

## TOP SCALE_UP TERMS (${topScaleUp.length})
${JSON.stringify(topScaleUp.map(t => ({ term: t.searchTerm, spend: t.cost?.toFixed(2), sales: t.sales?.toFixed(2), acos: t.acos, roas: t.roas?.toFixed(2), orders: t.purchases, campaign: t.campaignName, matchType: t.matchType })))}

## TOP ADD_EXACT OPPORTUNITIES (${topExact.length})
${JSON.stringify(topExact.map(t => ({ term: t.searchTerm, spend: t.cost?.toFixed(2), sales: t.sales?.toFixed(2), acos: t.acos, orders: t.purchases, campaign: t.campaignName })))}

## TOP NEGATIVE KEYWORD RECOMMENDATIONS (${topNeg.length})
${JSON.stringify(topNeg.map(t => ({ term: t.searchTerm, wastedSpend: t.cost?.toFixed(2), clicks: t.clicks, cpc: t.cpc?.toFixed(2), campaign: t.campaignName, matchType: t.matchType })))}

---

Generate the complete report following EXACTLY this section structure:
${sections}

Write the full report now. Use the real numbers from the data above. Be specific.`;

  const raw = model === 'claude'
    ? await callClaude(userPrompt, [], REPORT_SYSTEM_PROMPT)
    : await callGemini(userPrompt, [], REPORT_SYSTEM_PROMPT);

  return raw;
}

// ─────────────────────────────────────────────────────────────────────────────
// Listing Optimizer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Optimize an Amazon product listing using high-performing search terms.
 *
 * @param {{ asin, title, bullets, description, searchTerms }} payload
 * @param {'gemini'|'claude'} model
 * @returns {Promise<{ title: string, bullets: string[], description: string }>}
 */
export async function optimizeListing({ asin, title, bullets, description, searchTerms, uploadedKeywords }, model = 'gemini') {
  const bulletsText = (bullets ?? []).map((b, i) => `${i + 1}. ${b}`).join('\n');
  const priorityBlock = (uploadedKeywords ?? []).length > 0
    ? `\nPRIORITY KEYWORDS (user-uploaded — MUST include as many as possible, these take highest priority):\n${(uploadedKeywords).join(', ')}\n`
    : '';

  const userPrompt = `ASIN: ${asin ?? 'N/A'}

CURRENT TITLE:
${title ?? ''}

CURRENT BULLETS:
${bulletsText || '(none provided)'}

CURRENT DESCRIPTION:
${description ?? '(none provided)'}
${priorityBlock}
HIGH-PERFORMING SEARCH TERMS (SCALE_UP and ADD_EXACT — use these as secondary keywords):
${JSON.stringify((searchTerms ?? []).slice(0, 80).map(t => ({
  term: t.searchTerm,
  recommendation: t.recommendation,
  purchases: t.purchases,
  acos: t.acos,
  roas: t.roas,
})))}

Optimize the title, bullets, and description.${(uploadedKeywords ?? []).length > 0 ? ' Prioritize the PRIORITY KEYWORDS first, then the search terms.' : ' Use the search terms above.'} Return ONLY JSON.`;

  // Listing optimization is a structured rewrite, not a reasoning task.
  // Use a generous token budget so the full JSON always fits; for Gemini 2.5-flash
  // disable thinking (thinkingBudget: 0) so reasoning tokens don't eat output headroom.
  const raw = model === 'claude'
    ? await callClaude(userPrompt, [], LISTING_SYSTEM_PROMPT, 8192)
    : await callGemini(userPrompt, [], LISTING_SYSTEM_PROMPT, {
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingBudget: 0 },
      });

  // Extract the JSON object robustly: find first '{' and last '}' to handle
  // any preamble/postamble text the model adds despite "ONLY JSON" instructions.
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  const jsonStr = start !== -1 && end > start ? raw.slice(start, end + 1) : raw.trim();
  try {
    return JSON.parse(jsonStr);
  } catch {
    const tail = raw.length > 200 ? `…${raw.slice(-100)}` : '';
    throw new Error(`AI returned invalid JSON for listing optimization: ${raw.slice(0, 200)}${tail}`);
  }
}
