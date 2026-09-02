/**
 * The reviewer's model call.
 *
 * Kept separate from llm-review.js so that module stays pure: prompt building,
 * response parsing and the merge are all testable without a network, and this
 * is the only piece that needs stubbing.
 *
 * Claude rather than Gemini, deliberately. The reviewer's job is to catch the
 * cases the numbers miss — a competitor's brand, a seasonal line, a catalogue
 * gap — which is judgment over a long structured payload, and it is the one
 * step where a wrong call reaches a customer's account. The listing optimiser
 * uses Gemini for bulk rewriting where volume matters more; this is the
 * opposite trade.
 */

import { fetchWithTimeout, TIMEOUT_MS } from '../http.js';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

export const REVIEW_MODEL = 'claude-sonnet-4-6';

/** Enough for ~150 proposals with one-sentence rationales. */
const MAX_TOKENS = 8192;

/**
 * @returns {Promise<string>} raw model text, for parseReviewResponse to handle
 * @throws  so reviewCandidates can degrade to policy-only
 */
export async function callModelForReview(systemPrompt, userMessage) {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured');

  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: REVIEW_MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  }, TIMEOUT_MS.llm);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Review model error ${res.status}: ${err?.error?.message ?? res.statusText}`);
  }

  const json = await res.json();
  return json?.content?.[0]?.text ?? '';
}

export default callModelForReview;
