/**
 * Short-lived, single-use values shared across processes.
 *
 * The SP-API OAuth flow kept its CSRF nonces in a module-level Map. That works
 * for exactly one long-lived process: a deploy mid-flow, or a second replica
 * answering the callback, loses the nonce and the seller sees "Security check
 * failed" at the last step of connecting their Amazon account — the highest
 * stakes point in onboarding, and the one they are least likely to retry.
 *
 * `take` is atomic. A CSRF nonce must be consumable exactly once, so read and
 * delete cannot be two round-trips with a window between them. The Lua script
 * is used in preference to GETDEL because it works on every Redis version this
 * might run against.
 */
import { getRedis, closeRedis } from './redis.js';
import { createLogger } from '../api/utils/logger.js';

const logger = createLogger('EPHEMERAL_STORE');

// GET and DEL as one operation, so two concurrent callbacks carrying the same
// nonce cannot both be told it is valid.
const TAKE_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if value then redis.call('DEL', KEYS[1]) end
return value
`;

let scriptDefined = false;

/** The shared client, with the atomic take script registered once. */
function client() {
  const conn = getRedis();
  if (!scriptDefined) {
    conn.defineCommand('takeKey', { numberOfKeys: 1, lua: TAKE_SCRIPT });
    scriptDefined = true;
  }
  return conn;
}

/**
 * A namespaced key/value store where every entry expires and every read
 * consumes.
 *
 * @param {string} namespace          key prefix, e.g. 'spoauth:state'
 * @param {object} opts
 * @param {number} opts.ttlSeconds    how long an entry survives
 * @param {object} [opts.redis]       injectable client (tests)
 */
export function createEphemeralStore(namespace, { ttlSeconds, redis } = {}) {
  if (!ttlSeconds) throw new Error('createEphemeralStore requires ttlSeconds');
  const conn = () => redis ?? client();
  const k = (key) => `${namespace}:${key}`;

  return {
    /**
     * Store a value under `key`. Throws if it cannot be stored — the caller is
     * about to send the user somewhere that depends on it, and failing here is
     * far better than failing on their return.
     */
    async put(key, value) {
      await conn().set(k(key), JSON.stringify(value), 'EX', ttlSeconds);
    },

    /**
     * Read and delete in one atomic step. Returns null when the key is absent,
     * already consumed, or expired — and also when Redis is unreachable, so a
     * caller checking a nonce fails closed.
     */
    async take(key) {
      try {
        const raw = await conn().takeKey(k(key));
        return raw == null ? null : JSON.parse(raw);
      } catch (err) {
        logger.error(`take(${namespace}) failed: ${err.message}`);
        return null;
      }
    },
  };
}

/** Close the shared connection (server shutdown, tests). */
export async function closeEphemeralStore() {
  scriptDefined = false;
  await closeRedis();
}
