/**
 * The one door to Claude.
 *
 * Three places built the same request to api.anthropic.com/v1/messages by
 * hand — the chat, the agent's reviewer, the image prompt writer — and every
 * one of them threw the `usage` object away. Token spend was recorded nowhere,
 * no org could be told what its model calls cost, and nothing could stop one
 * org from costing more than its plan brings in. This wraps the call once so
 * that every model call is metered, capped, and cached the same way.
 *
 * ── Metered ──────────────────────────────────────────────────────────────────
 * usage.input_tokens and usage.output_tokens land in UsageMetric, kept apart
 * because they are priced apart. Cache reads count as input here; they are
 * far cheaper at Anthropic, but the ceiling is about bounding abuse, not
 * reproducing the invoice, and counting them keeps the number honest.
 *
 * ── Capped ───────────────────────────────────────────────────────────────────
 * Before the call, the org's monthly total is checked against its plan's
 * llmTokens. Warn mode passes and logs like every other limit; strict mode
 * throws LlmBudgetExceededError, which routes turn into a 402 and the agent's
 * reviewer turns into "policy only for today". The pessimistic estimate for
 * this call is its max_tokens, so an org at the line cannot slip one more
 * large call through.
 *
 * ── Cached ───────────────────────────────────────────────────────────────────
 * The system prompt is sent as a cache_control block. Every caller's system
 * prompt is static and long; Anthropic charges a cache read at a tenth of
 * the input price once the prefix is warm. Below the minimum cacheable size
 * the flag is simply ignored, so there is no case in which it hurts.
 */

import { fetchWithTimeout, TIMEOUT_MS } from './http.js';
import { trackUsage } from './razorpay.js';
import { checkPlanLimit, planLimitMode } from './plan-limits.js';
import { createLogger } from '../api/utils/logger.js';

const logger = createLogger('LLM');

const ANTHROPIC_URL     = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export const LLM_BUDGET_CODE = 'LLM_BUDGET_EXCEEDED';

export class LlmBudgetExceededError extends Error {
  constructor({ used, limit, tier }) {
    super(`This organization has used its monthly AI allowance (${used.toLocaleString('en-IN')} of ${limit.toLocaleString('en-IN')} tokens on the ${tier} plan). Upgrade to continue.`);
    this.name  = 'LlmBudgetExceededError';
    this.code  = LLM_BUDGET_CODE;
    this.used  = used;
    this.limit = limit;
    this.tier  = tier;
  }
}

/** Anthropic's system field, as a cacheable block. */
function systemBlocks(system) {
  if (!system) return undefined;
  if (Array.isArray(system)) return system;
  return [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
}

/**
 * Refuse, warn, or pass, according to the plan-limit mode.
 * @throws {LlmBudgetExceededError} in strict mode when the org is at its ceiling
 */
async function enforceBudget(orgId, maxTokens, purpose) {
  const mode = planLimitMode();
  if (mode === 'off' || !orgId) return;

  const r = await checkPlanLimit(orgId, 'llmTokens', maxTokens);
  if (r.allowed) return;

  if (mode !== 'strict') {
    logger.warn(`Org ${orgId} (${r.tier}) is over its AI token allowance (${r.used}/${r.limit}) — ${purpose} passing through`);
    return;
  }
  logger.info(`Org ${orgId} (${r.tier}) blocked at AI token allowance ${r.used}/${r.limit} (${purpose})`);
  throw new LlmBudgetExceededError({ used: r.used, limit: r.limit, tier: r.tier });
}

/**
 * One Claude messages call.
 *
 * @param {object} p
 * @param {string} p.model
 * @param {string|object[]} [p.system]
 * @param {object[]} p.messages          Anthropic message objects
 * @param {number} [p.maxTokens]
 * @param {string|null} [p.orgId]        who pays; null meters nothing and caps nothing
 * @param {string} [p.purpose]           for the log line, e.g. 'chat', 'review'
 * @param {number} [p.timeoutMs]
 * @returns {Promise<{ text: string, json: object, usage: object, stopReason: string|null }>}
 */
export async function claudeMessages({
  model, system, messages, maxTokens = 4096, orgId = null, purpose = 'llm', timeoutMs = TIMEOUT_MS.llm,
}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  await enforceBudget(orgId, maxTokens, purpose);

  const body = { model, max_tokens: maxTokens, messages };
  const sys = systemBlocks(system);
  if (sys) body.system = sys;

  const res = await fetchWithTimeout(ANTHROPIC_URL, {
    method:  'POST',
    headers: {
      'content-type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  }, timeoutMs);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Claude API error ${res.status}: ${err?.error?.message ?? res.statusText}`);
  }

  const json  = await res.json();
  const usage = json.usage ?? {};
  const input  = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  const output = usage.output_tokens ?? 0;

  if (orgId) {
    // Fire-and-forget: a metering write must never fail the answer it meters.
    if (input)  trackUsage(orgId, 'llmInputTokens',  input).catch((e) => logger.error(`meter input failed: ${e.message}`));
    if (output) trackUsage(orgId, 'llmOutputTokens', output).catch((e) => logger.error(`meter output failed: ${e.message}`));
  }

  if (json.stop_reason === 'max_tokens') {
    logger.warn(`Claude hit max_tokens (${maxTokens}) for ${purpose} — response was truncated`);
  }

  const text = Array.isArray(json.content)
    ? json.content.filter((b) => b?.type === 'text' || typeof b?.text === 'string').map((b) => b.text).join('')
    : '';

  return { text, json, usage, stopReason: json.stop_reason ?? null };
}

export default claudeMessages;
