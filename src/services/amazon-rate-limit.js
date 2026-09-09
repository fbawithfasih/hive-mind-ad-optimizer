/**
 * A per-profile ceiling on how fast we ask Amazon for things.
 *
 * Amazon Ads rate-limits per advertising profile, not per application, and
 * nothing here limited anything: the 04:30 sweep fanned out one job per
 * enrolled profile and each one asked for reports as fast as the event loop
 * allowed. At two orgs that is invisible. At a few hundred it is a sustained
 * 429, and because a 429 used to look like any other error it burned a BullMQ
 * attempt each time — the retry budget spent on being told to slow down.
 *
 * A token bucket in Redis, because the limit is per profile across every
 * process that might touch it: two API replicas and a worker replica share one
 * seller's quota, so an in-memory counter would divide the limit by the number
 * of processes and then exceed it anyway.
 *
 * ── Reserve, don't poll ──────────────────────────────────────────────────────
 *
 * A caller takes a token even when the bucket is empty, going into debt, and is
 * told how long to wait for it. That gives fair, ordered service without a
 * retry loop: ten simultaneous callers get ten different wait times rather than
 * all sleeping and all colliding again. Debt is capped so a stampede cannot
 * reserve a slot minutes into the future.
 *
 * ── It fails open ────────────────────────────────────────────────────────────
 *
 * No Redis, an unreachable Redis, a script error: the call goes through. This
 * limiter exists to smooth our own traffic, not to enforce correctness, and
 * making every Amazon request depend on a second datastore would turn a Redis
 * blip into a total outage. The 429 handling in http.js is the backstop, and it
 * is the one that has to work.
 */

import { getRedis, redisConfigured } from './redis.js';
import { createLogger } from '../api/utils/logger.js';

const logger = createLogger('ADS_RATE_LIMIT');

/**
 * Requests per second per profile, and how many may burst.
 *
 * Amazon publishes no fixed number — the limit varies by endpoint and is
 * advertised in response headers on some of them — so this is a deliberately
 * conservative floor rather than a measured maximum. Raise it with evidence
 * from the 429 counter, not by guessing.
 */
export const ADS_RATE = Number(process.env.ADS_RATE_PER_SECOND || 5);
export const ADS_BURST = Number(process.env.ADS_BURST || 10);

/** Longest a single request will wait for a token before going anyway. */
export const MAX_WAIT_MS = Number(process.env.ADS_MAX_WAIT_MS || 5_000);

/** Bucket keys expire when idle; a profile nobody touches costs nothing. */
const TTL_SECONDS = 120;

/**
 * Refill by elapsed time, take one token, report the wait.
 *
 * Returns milliseconds to wait: 0 when a token was free. Debt is floored at
 * one burst, so the worst wait any caller is told is bounded no matter how
 * many arrive at once.
 */
const TAKE_TOKEN = `
local capacity = tonumber(ARGV[1])
local rate     = tonumber(ARGV[2])
local now      = tonumber(ARGV[3])
local ttl      = tonumber(ARGV[4])

local state  = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(state[1])
local ts     = tonumber(state[2])

if tokens == nil or ts == nil then
  tokens = capacity
  ts = now
end

local elapsed = math.max(0, now - ts) / 1000
tokens = math.min(capacity, tokens + elapsed * rate)

tokens = tokens - 1
if tokens < -capacity then tokens = -capacity end

local wait = 0
if tokens < 0 then wait = math.ceil((-tokens) / rate * 1000) end

redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('EXPIRE', KEYS[1], ttl)
return wait
`;

let scriptDefined = false;

function client() {
  const conn = getRedis();
  if (!scriptDefined) {
    conn.defineCommand('takeAdsToken', { numberOfKeys: 1, lua: TAKE_TOKEN });
    scriptDefined = true;
  }
  return conn;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * How long this request should wait before going to Amazon.
 *
 * Exported separately from the sleeping so tests can assert the arithmetic
 * without spending the time.
 *
 * @param {string|number} profileId
 * @returns {Promise<number>} milliseconds; 0 to go now
 */
export async function reserveSlot(profileId) {
  if (!profileId || !redisConfigured()) return 0;
  try {
    const wait = await client().takeAdsToken(
      `ratelimit:ads:${profileId}`, ADS_BURST, ADS_RATE, Date.now(), TTL_SECONDS,
    );
    return Math.max(0, Number(wait) || 0);
  } catch (err) {
    // Fail open: see the module comment. One log line per failure would be
    // one per request during an outage, so this is deliberately quiet.
    logger.debug(`bucket unavailable for profile ${profileId}: ${err.message}`);
    return 0;
  }
}

/**
 * Wait for this profile's turn. Returns the milliseconds actually waited, so
 * a caller can log or count it.
 *
 * A wait longer than MAX_WAIT_MS is truncated rather than honoured: a BullMQ
 * worker parked for a minute is worse than a 429 the interceptor will handle,
 * and this way the queue keeps moving under load.
 */
export async function acquireAdsSlot(profileId) {
  const wait = await reserveSlot(profileId);
  if (wait <= 0) return 0;
  const capped = Math.min(wait, MAX_WAIT_MS);
  await sleep(capped);
  return capped;
}

export default acquireAdsSlot;
