/**
 * The per-profile token bucket.
 *
 * Two properties carry the weight. It must actually pace requests — the
 * arithmetic is in Lua and the wait it returns is what the caller sleeps for.
 * And it must never be able to stop an Amazon call: a limiter that fails
 * closed turns a Redis blip into a total outage, which is strictly worse than
 * the throttling it was added to avoid.
 */
// `mock`-prefixed so jest's hoisted factory may reference it.
const mockTakeAdsToken = jest.fn();
jest.mock('../redis.js', () => ({
  redisConfigured: jest.fn(() => true),
  getRedis: jest.fn(() => ({ defineCommand: jest.fn(), takeAdsToken: mockTakeAdsToken })),
}));

import { redisConfigured } from '../redis.js';
import { reserveSlot, acquireAdsSlot, ADS_RATE, ADS_BURST, MAX_WAIT_MS } from '../amazon-rate-limit.js';

beforeEach(() => {
  jest.clearAllMocks();
  redisConfigured.mockReturnValue(true);
  mockTakeAdsToken.mockResolvedValue(0);
});

describe('reserveSlot', () => {
  it('asks for a token on the profile\'s own bucket, with the configured rate', async () => {
    await reserveSlot('12345');
    const [key, capacity, rate] = mockTakeAdsToken.mock.calls[0];
    expect(key).toBe('ratelimit:ads:12345');
    expect(capacity).toBe(ADS_BURST);
    expect(rate).toBe(ADS_RATE);
  });

  it('returns the wait the bucket reports', async () => {
    mockTakeAdsToken.mockResolvedValue(750);
    await expect(reserveSlot('12345')).resolves.toBe(750);
  });

  it('never returns a negative wait, whatever the script says', async () => {
    mockTakeAdsToken.mockResolvedValue(-5);
    await expect(reserveSlot('12345')).resolves.toBe(0);
  });

  it('does nothing without a profile — a call that is not per-profile is not per-profile limited', async () => {
    await expect(reserveSlot(null)).resolves.toBe(0);
    expect(mockTakeAdsToken).not.toHaveBeenCalled();
  });

  it('does nothing when Redis is not configured', async () => {
    redisConfigured.mockReturnValue(false);
    await expect(reserveSlot('12345')).resolves.toBe(0);
    expect(mockTakeAdsToken).not.toHaveBeenCalled();
  });
});

describe('failing open', () => {
  it('lets the request through when Redis is unreachable', async () => {
    mockTakeAdsToken.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(reserveSlot('12345')).resolves.toBe(0);
  });

  it('lets the request through when the script returns nonsense', async () => {
    mockTakeAdsToken.mockResolvedValue('not a number');
    await expect(reserveSlot('12345')).resolves.toBe(0);
  });
});

describe('acquireAdsSlot', () => {
  it('returns immediately when a token was free', async () => {
    const started = Date.now();
    await expect(acquireAdsSlot('12345')).resolves.toBe(0);
    expect(Date.now() - started).toBeLessThan(50);
  });

  it('waits the reported time', async () => {
    mockTakeAdsToken.mockResolvedValue(60);
    const started = Date.now();
    await expect(acquireAdsSlot('12345')).resolves.toBe(60);
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
  });

  it('truncates a long wait rather than parking a worker', async () => {
    // A minute of debt is worse than the 429 the interceptor will handle:
    // the queue has to keep moving. Fake timers so the test does not spend
    // the cap proving the cap.
    jest.useFakeTimers();
    try {
      mockTakeAdsToken.mockResolvedValue(60_000);
      const waiting = acquireAdsSlot('12345');
      await jest.advanceTimersByTimeAsync(MAX_WAIT_MS);
      await expect(waiting).resolves.toBe(MAX_WAIT_MS);
    } finally {
      jest.useRealTimers();
    }
  });
});
