/**
 * Outbound HTTP with timeouts.
 *
 * Node's global fetch and axios both default to NO timeout. Every call to
 * Amazon, Anthropic and Gemini was made without one, so a hung socket parked an
 * Express handler — and its database connection — indefinitely. This process
 * also runs all seven BullMQ workers, so a handful of hung sockets degrades
 * background work and the API together, with nothing in the logs to say why.
 *
 * A timeout is a promise about the slowest case that is still working, not the
 * typical case. Set one too low and you manufacture the outage you were trying
 * to prevent, so the budgets below are deliberately generous and split by the
 * kind of work rather than applied uniformly.
 */
import axios from 'axios';

export const TIMEOUT_MS = {
  /** Ordinary JSON API calls. Amazon's list/create endpoints answer in well under a second. */
  api: 30_000,
  /** LWA token refresh. On the critical path of every request, so it fails fast. */
  token: 15_000,
  /** Report payload downloads — gzipped, occasionally tens of MB. */
  download: 120_000,
  /** LLM generation. Claude at max_tokens 8192 can legitimately run past a minute. */
  llm: 120_000,
};

/**
 * Shared axios instance. Per-call overrides still work:
 *   http.get(url, { timeout: TIMEOUT_MS.download, responseType: 'arraybuffer' })
 */
export const http = axios.create({ timeout: TIMEOUT_MS.api });

/**
 * fetch() with a deadline. Rejects with a named error rather than the bare
 * `AbortError` DOMException, so callers and logs can tell a timeout apart from
 * a caller-initiated abort.
 *
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {number} [timeoutMs]
 */
export async function fetchWithTimeout(url, init = {}, timeoutMs = TIMEOUT_MS.api) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      const host = (() => { try { return new URL(url).host; } catch { return url; } })();
      const e = new Error(`Request to ${host} timed out after ${timeoutMs}ms`);
      e.name  = 'HttpTimeoutError';
      e.cause = err;
      throw e;
    }
    throw err;
  }
}

/** True for the error shapes that mean "the request never completed". */
export function isTimeout(err) {
  return err?.name === 'HttpTimeoutError'
      || err?.code === 'ECONNABORTED'   // axios timeout
      || err?.code === 'ETIMEDOUT';
}
