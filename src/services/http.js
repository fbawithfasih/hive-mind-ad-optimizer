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

import { acquireAdsSlot } from './amazon-rate-limit.js';
import { createLogger } from '../api/utils/logger.js';

const logger = createLogger('HTTP');

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

// ─────────────────────────────────────────────────────────────────────────────
// Throttling: asking Amazon to slow down before it has to tell us
// ─────────────────────────────────────────────────────────────────────────────

/** Attempts after the first. Three tries total. */
export const MAX_RETRIES = Number(process.env.AMAZON_MAX_RETRIES || 2);

/** No single backoff waits longer than this, whatever Retry-After says. */
export const MAX_BACKOFF_MS = 30_000;

/**
 * Read a header from either shape axios hands us: a plain object on the way
 * out, an AxiosHeaders instance once normalised, and lower-cased on responses.
 */
function headerOf(container, name) {
  if (!container) return null;
  if (typeof container.get === 'function') {
    const via = container.get(name);
    if (via != null) return via;
  }
  return container[name] ?? container[name.toLowerCase()] ?? null;
}

/**
 * Amazon's `Amazon-Advertising-API-Scope` header carries the profile id, and
 * the profile is exactly the dimension Amazon rate-limits on. Reading it here
 * means every per-profile Ads call is throttled without any of the twelve
 * call sites knowing about it — and a call with no scope (LWA token refresh,
 * the profiles list) is left alone, correctly, since neither is per-profile.
 */
function adsProfileOf(config) {
  return headerOf(config?.headers, 'Amazon-Advertising-API-Scope');
}

/**
 * `Retry-After` is either a number of seconds or an HTTP-date. Both are
 * honoured, and both are capped: a header saying 3600 is not a reason to park
 * a worker for an hour.
 *
 * @returns {number|null} milliseconds, or null when there is no usable header
 */
export function retryAfterMs(header, now = Date.now()) {
  if (header === undefined || header === null || header === '') return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(Math.max(0, seconds * 1000), MAX_BACKOFF_MS);
  const at = Date.parse(String(header));
  if (Number.isNaN(at)) return null;
  return Math.min(Math.max(0, at - now), MAX_BACKOFF_MS);
}

/**
 * Should this failure be tried again?
 *
 * A 429 always. Amazon rejects a throttled request before doing anything with
 * it, so repeating it cannot repeat an effect — which is the whole reason this
 * class of error deserves different treatment from every other 4xx.
 *
 * A 5xx only when repeating the request is safe. A POST that returned 503 may
 * have been applied before the failure: retrying `addKeywords` could add the
 * same keyword twice, and while Amazon answers DUPLICATE_VALUE for that, the
 * agent counts it as applied and the day's evidence base gains a row that
 * describes nothing. GET and HEAD are safe by definition; PUT here sets
 * absolute state (campaign budget, campaign status), so repeating it lands on
 * the same value.
 */
export function shouldRetry(error) {
  const status = error?.response?.status;
  if (status === 429) return true;
  if (status !== 502 && status !== 503 && status !== 504) return false;
  const method = String(error?.config?.method ?? 'get').toLowerCase();
  return method === 'get' || method === 'head' || method === 'put';
}

/** Exponential with jitter, for when Amazon does not say how long to wait. */
function backoffFor(attempt) {
  return Math.min(500 * 2 ** (attempt - 1) + Math.random() * 500, MAX_BACKOFF_MS);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait for this profile's turn before the request goes out. Acquiring is
// itself fail-open, so a Redis problem cannot stop an Amazon call.
http.interceptors.request.use(async (config) => {
  const profileId = adsProfileOf(config);
  if (profileId) {
    const waited = await acquireAdsSlot(profileId);
    if (waited > 0) logger.debug(`throttled ${waited}ms before ${config.method} ${config.url} (profile ${profileId})`);
  }
  return config;
});

// A 429 used to look like any other error: it burned a BullMQ attempt and, in
// the report pollers, counted as a failed poll. Now it is what it is — a
// request to come back later — and we do.
http.interceptors.response.use(null, async (error) => {
  const { config, response } = error ?? {};
  if (!config || !shouldRetry(error)) throw error;

  const attempt = (config.__amazonRetry ?? 0) + 1;
  if (attempt > MAX_RETRIES) {
    logger.warn(`giving up on ${config.method} ${config.url} after ${MAX_RETRIES} retries (last status ${response?.status})`);
    throw error;
  }
  config.__amazonRetry = attempt;

  const advised = retryAfterMs(headerOf(response?.headers, 'Retry-After'));
  const delay   = advised ?? backoffFor(attempt);
  logger.warn(`${response?.status} from ${config.url} — retry ${attempt}/${MAX_RETRIES} in ${Math.round(delay)}ms${advised === null ? '' : ' (Retry-After)'}`);

  await sleep(delay);
  // Back through the request interceptor, so the retry takes a token too.
  return http.request(config);
});

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
