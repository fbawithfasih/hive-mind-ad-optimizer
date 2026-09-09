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

import { claudeMessages } from '../llm.js';

export const REVIEW_MODEL = 'claude-sonnet-4-6';

/** Enough for ~150 proposals with one-sentence rationales. */
const MAX_TOKENS = 8192;

/**
 * @returns {Promise<string>} raw model text, for parseReviewResponse to handle
 * @throws  so reviewCandidates can degrade to policy-only
 */
export async function callModelForReview(systemPrompt, userMessage, { orgId = null } = {}) {
  // Metered against the org whose profile is being reviewed, and capped by
  // its plan; over the ceiling in strict mode this throws, and
  // reviewCandidates degrades to policy-only for the day. See services/llm.js.
  const { text } = await claudeMessages({
    model: REVIEW_MODEL, system: systemPrompt, maxTokens: MAX_TOKENS, orgId, purpose: 'review',
    messages: [{ role: 'user', content: userMessage }],
  });
  return text;
}

export default callModelForReview;
