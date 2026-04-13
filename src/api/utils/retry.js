/**
 * Retry utilities with exponential backoff
 * Handles transient failures (429, 503) and network errors
 */

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @param {number} options.maxAttempts - Maximum number of attempts (default: 3)
 * @param {number} options.initialDelayMs - Initial delay in ms (default: 100)
 * @param {number} options.maxDelayMs - Maximum delay in ms (default: 5000)
 * @param {Function} options.shouldRetry - Function to determine if error is retryable (default: retry on 429, 503)
 * @param {Function} options.onRetry - Callback when retrying (for logging)
 * @returns {Promise} Result of successful function call
 */
export async function retryWithBackoff(
  fn,
  {
    maxAttempts = 3,
    initialDelayMs = 100,
    maxDelayMs = 5000,
    shouldRetry = defaultShouldRetry,
    onRetry = null,
  } = {}
) {
  let lastError;
  let attempt = 1;

  while (attempt <= maxAttempts) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if error is retryable
      if (!shouldRetry(error, attempt)) {
        throw error;
      }

      // Don't sleep on last attempt
      if (attempt === maxAttempts) {
        throw error;
      }

      // Calculate exponential backoff with jitter
      const delayMs = Math.min(
        initialDelayMs * Math.pow(2, attempt - 1) + Math.random() * 1000,
        maxDelayMs
      );

      if (onRetry) {
        onRetry(attempt, delayMs, error);
      }

      await new Promise(resolve => setTimeout(resolve, delayMs));
      attempt++;
    }
  }

  throw lastError;
}

/**
 * Default retry logic: retry on transient errors (429, 503, network errors)
 */
function defaultShouldRetry(error, attempt) {
  if (!error) return false;

  // Retry on rate limit and service unavailable
  if (error.response?.status === 429 || error.response?.status === 503) {
    return true;
  }

  // Retry on network errors
  if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
    return true;
  }

  // Retry on timeout
  if (error.code === 'ENOTFOUND' || error.message?.includes('timeout')) {
    return true;
  }

  return false;
}

/**
 * Wrap a function with automatic retry logic
 * Returns a function that retries on failure
 */
export function withRetry(fn, options = {}) {
  return async function retriedFn(...args) {
    return retryWithBackoff(
      () => fn(...args),
      options
    );
  };
}
