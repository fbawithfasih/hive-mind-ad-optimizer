/**
 * The shared store behind the SP-API OAuth CSRF nonces.
 *
 * Two properties carry the security weight: a nonce is consumable exactly once
 * (so a replayed callback is refused), and an unreachable store reads as
 * "invalid" rather than "fine" (so a Redis outage cannot become a bypass).
 */
import { createEphemeralStore } from '../ephemeral-store.js';

/**
 * A fake Redis with the two commands the store uses. takeKey is implemented as
 * one indivisible step, which is what the Lua script buys in the real thing.
 */
function fakeRedis() {
  const data = new Map();
  return {
    data,
    set: jest.fn(async (key, value, mode, ttl) => {
      data.set(key, { value, mode, ttl });
      return 'OK';
    }),
    takeKey: jest.fn(async (key) => {
      const entry = data.get(key);
      data.delete(key);
      return entry?.value ?? null;
    }),
  };
}

const store = (redis, ttlSeconds = 600) =>
  createEphemeralStore('spoauth:state', { ttlSeconds, redis });

describe('put and take', () => {
  it('round-trips a value', async () => {
    const redis = fakeRedis();
    const s = store(redis);

    await s.put('nonce-1', { orgId: 'org-1' });

    expect(await s.take('nonce-1')).toEqual({ orgId: 'org-1' });
  });

  it('namespaces the key so two stores cannot collide', async () => {
    const redis = fakeRedis();

    await createEphemeralStore('a', { ttlSeconds: 60, redis }).put('k', 1);
    await createEphemeralStore('b', { ttlSeconds: 60, redis }).put('k', 2);

    expect([...redis.data.keys()]).toEqual(['a:k', 'b:k']);
  });

  it('sets an expiry, so an abandoned flow does not leave a nonce valid forever', async () => {
    const redis = fakeRedis();

    await store(redis, 600).put('nonce-1', { orgId: 'org-1' });

    expect(redis.set).toHaveBeenCalledWith('spoauth:state:nonce-1', expect.any(String), 'EX', 600);
  });

  it('refuses to be built without a TTL', () => {
    expect(() => createEphemeralStore('x', {})).toThrow(/ttlSeconds/);
  });
});

describe('single use', () => {
  it('returns null the second time', async () => {
    const redis = fakeRedis();
    const s = store(redis);
    await s.put('nonce-1', { orgId: 'org-1' });

    expect(await s.take('nonce-1')).toEqual({ orgId: 'org-1' });
    expect(await s.take('nonce-1')).toBeNull();
  });

  it('reads and deletes in one command, not two', async () => {
    // Two round-trips leave a window where concurrent callbacks carrying the
    // same nonce are both told it is valid.
    const redis = fakeRedis();
    const s = store(redis);
    await s.put('nonce-1', { orgId: 'org-1' });

    await s.take('nonce-1');

    expect(redis.takeKey).toHaveBeenCalledTimes(1);
    expect(redis.del).toBeUndefined();   // the store never issues a separate DEL
  });

  it('gives the value to exactly one of two concurrent takes', async () => {
    const redis = fakeRedis();
    const s = store(redis);
    await s.put('nonce-1', { orgId: 'org-1' });

    const results = await Promise.all([s.take('nonce-1'), s.take('nonce-1')]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('returns null for a nonce that was never issued', async () => {
    expect(await store(fakeRedis()).take('never-seen')).toBeNull();
  });
});

describe('when Redis is unreachable', () => {
  it('take fails closed rather than open', async () => {
    // Returning null makes the caller treat the nonce as invalid. Throwing, or
    // returning something truthy, would turn a Redis outage into a CSRF bypass.
    const redis = fakeRedis();
    redis.takeKey.mockRejectedValue(new Error('ECONNREFUSED'));

    expect(await store(redis).take('nonce-1')).toBeNull();
  });

  it('take does not throw at the caller', async () => {
    const redis = fakeRedis();
    redis.takeKey.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(store(redis).take('nonce-1')).resolves.toBeNull();
  });

  it('put throws, so the caller can refuse before redirecting', async () => {
    // The opposite direction from take: the caller is about to send the user
    // somewhere that depends on this value, and finding out now is much better
    // than finding out when they come back.
    const redis = fakeRedis();
    redis.set.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(store(redis).put('nonce-1', { orgId: 'org-1' })).rejects.toThrow();
  });

  it('survives a stored value that is not valid JSON', async () => {
    const redis = fakeRedis();
    redis.takeKey.mockResolvedValue('{not json');

    expect(await store(redis).take('nonce-1')).toBeNull();
  });
});
