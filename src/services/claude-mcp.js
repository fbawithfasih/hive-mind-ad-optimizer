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

async function callGemini(userCommand, conversationHistory = [], systemPrompt = SYSTEM_PROMPT) {
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
    generationConfig: { maxOutputTokens: 4096 },
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

async function callClaude(userCommand, conversationHistory = [], systemPrompt = SYSTEM_PROMPT) {
  const messages = [
    ...conversationHistory
      .filter((m) => typeof m.content === 'string')
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
    { role: 'user', content: userCommand },
  ];

  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
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

  const raw = model === 'claude'
    ? await callClaude(userPrompt, [], LISTING_SYSTEM_PROMPT)
    : await callGemini(userPrompt, [], LISTING_SYSTEM_PROMPT);

  // Strip markdown code fences if the model wrapped the JSON
  const jsonStr = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  try {
    return JSON.parse(jsonStr);
  } catch {
    throw new Error(`AI returned invalid JSON for listing optimization: ${raw.slice(0, 200)}`);
  }
}
