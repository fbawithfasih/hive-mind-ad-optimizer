import { retryWithBackoff, withRetry } from '../retry.js';

// Use 0ms delays in all tests to keep the suite fast
const NO_DELAY = { initialDelayMs: 0, maxDelayMs: 0 };

describe('retryWithBackoff', () => {
  describe('success cases', () => {
    it('returns result on first attempt', async () => {
      const fn = jest.fn().mockResolvedValue('ok');
      const result = await retryWithBackoff(fn, NO_DELAY);
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('succeeds after one retryable failure', async () => {
      const err = Object.assign(new Error('rate limited'), { response: { status: 429 } });
      const fn = jest.fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValue('ok');

      const result = await retryWithBackoff(fn, { ...NO_DELAY, maxAttempts: 3 });
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('succeeds after two retryable failures', async () => {
      const err503 = Object.assign(new Error('unavailable'), { response: { status: 503 } });
      const fn = jest.fn()
        .mockRejectedValueOnce(err503)
        .mockRejectedValueOnce(err503)
        .mockResolvedValue('data');

      const result = await retryWithBackoff(fn, { ...NO_DELAY, maxAttempts: 3 });
      expect(result).toBe('data');
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe('non-retryable errors', () => {
    it('throws immediately on 400 Bad Request', async () => {
      const err = Object.assign(new Error('Bad Request'), { response: { status: 400 } });
      const fn = jest.fn().mockRejectedValue(err);

      await expect(retryWithBackoff(fn, { ...NO_DELAY, maxAttempts: 3 })).rejects.toThrow('Bad Request');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('throws immediately on 401 Unauthorized', async () => {
      const err = Object.assign(new Error('Unauthorized'), { response: { status: 401 } });
      const fn = jest.fn().mockRejectedValue(err);

      await expect(retryWithBackoff(fn, { ...NO_DELAY, maxAttempts: 3 })).rejects.toThrow();
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('throws immediately on 404 Not Found', async () => {
      const err = Object.assign(new Error('Not Found'), { response: { status: 404 } });
      const fn = jest.fn().mockRejectedValue(err);

      await expect(retryWithBackoff(fn, NO_DELAY)).rejects.toThrow('Not Found');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('retryable error conditions', () => {
    it('retries on 429 rate limit', async () => {
      const err = Object.assign(new Error('Too Many Requests'), { response: { status: 429 } });
      const fn = jest.fn().mockRejectedValue(err);

      await expect(retryWithBackoff(fn, { ...NO_DELAY, maxAttempts: 2 })).rejects.toThrow();
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('retries on 503 service unavailable', async () => {
      const err = Object.assign(new Error('Service Unavailable'), { response: { status: 503 } });
      const fn = jest.fn().mockRejectedValue(err);

      await expect(retryWithBackoff(fn, { ...NO_DELAY, maxAttempts: 2 })).rejects.toThrow();
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('retries on ECONNREFUSED', async () => {
      const err = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
      const fn = jest.fn().mockRejectedValue(err);

      await expect(retryWithBackoff(fn, { ...NO_DELAY, maxAttempts: 2 })).rejects.toThrow();
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('retries on ETIMEDOUT', async () => {
      const err = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
      const fn = jest.fn().mockRejectedValue(err);

      await expect(retryWithBackoff(fn, { ...NO_DELAY, maxAttempts: 2 })).rejects.toThrow();
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('retries on message containing "timeout"', async () => {
      const err = new Error('Request timeout after 30s');
      const fn = jest.fn().mockRejectedValue(err);

      await expect(retryWithBackoff(fn, { ...NO_DELAY, maxAttempts: 2 })).rejects.toThrow();
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('options', () => {
    it('respects maxAttempts', async () => {
      const err = Object.assign(new Error('unavailable'), { response: { status: 503 } });
      const fn = jest.fn().mockRejectedValue(err);

      await expect(retryWithBackoff(fn, { ...NO_DELAY, maxAttempts: 5 })).rejects.toThrow();
      expect(fn).toHaveBeenCalledTimes(5);
    });

    it('calls onRetry callback with attempt, delay, and error', async () => {
      const err = Object.assign(new Error('rate limited'), { response: { status: 429 } });
      const fn = jest.fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValue('ok');

      const onRetry = jest.fn();
      await retryWithBackoff(fn, { ...NO_DELAY, maxAttempts: 3, onRetry });

      expect(onRetry).toHaveBeenCalledTimes(1);
      const [attempt, delay, calledErr] = onRetry.mock.calls[0];
      expect(attempt).toBe(1);
      expect(typeof delay).toBe('number');
      expect(calledErr).toBe(err);
    });

    it('uses custom shouldRetry predicate', async () => {
      const err = new Error('custom error');
      const fn = jest.fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValue('ok');

      // Custom: always retry
      const result = await retryWithBackoff(fn, {
        ...NO_DELAY,
        maxAttempts: 3,
        shouldRetry: () => true,
      });
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('custom shouldRetry returning false stops immediately', async () => {
      const err = Object.assign(new Error('unavailable'), { response: { status: 503 } });
      const fn = jest.fn().mockRejectedValue(err);

      await expect(retryWithBackoff(fn, {
        ...NO_DELAY,
        maxAttempts: 3,
        shouldRetry: () => false,
      })).rejects.toThrow();
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});

describe('withRetry', () => {
  it('wraps function with retry logic', async () => {
    const err = Object.assign(new Error('rate limited'), { response: { status: 429 } });
    const inner = jest.fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValue('result');

    const wrapped = withRetry(inner, { ...NO_DELAY, maxAttempts: 3 });
    const result = await wrapped('arg1', 'arg2');

    expect(result).toBe('result');
    expect(inner).toHaveBeenCalledWith('arg1', 'arg2');
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it('passes all arguments to the wrapped function', async () => {
    const fn = jest.fn().mockResolvedValue(42);
    const wrapped = withRetry(fn, NO_DELAY);
    await wrapped('a', 'b', 'c');
    expect(fn).toHaveBeenCalledWith('a', 'b', 'c');
  });
});
