/**
 * Query cache utility for client-side API result caching
 * Reduces repeated API calls for frequently accessed data
 */

export class QueryCache {
  /**
   * Create a query cache with TTL support
   * @param {number} ttlMs - Time-to-live in milliseconds (default: 5 minutes)
   */
  constructor(ttlMs = 300000) {
    this.cache = new Map();
    this.ttl = ttlMs;
  }

  /**
   * Get cached value or fetch using provided function
   * @param {string} key - Cache key
   * @param {Function} fetcher - Async function that fetches the data
   * @returns {Promise<any>} Cached or freshly fetched data
   */
  async getOrFetch(key, fetcher) {
    const cached = this.cache.get(key);

    // Return cached value if still valid
    if (cached && Date.now() - cached.time < this.ttl) {
      return cached.value;
    }

    // Fetch fresh data
    const value = await fetcher();

    // Store in cache with timestamp
    this.cache.set(key, {
      value,
      time: Date.now(),
    });

    return value;
  }

  /**
   * Invalidate a specific cache entry
   * @param {string} key - Cache key to invalidate
   */
  invalidate(key) {
    this.cache.delete(key);
  }

  /**
   * Clear entire cache
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get current cache size
   * @returns {number} Number of cached entries
   */
  size() {
    return this.cache.size;
  }

  /**
   * Check if key exists and is valid
   * @param {string} key - Cache key
   * @returns {boolean} True if key is cached and not expired
   */
  has(key) {
    const cached = this.cache.get(key);
    if (!cached) return false;
    return Date.now() - cached.time < this.ttl;
  }

  /**
   * Cleanup expired entries
   * @returns {number} Number of entries removed
   */
  cleanup() {
    let removed = 0;
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.time >= this.ttl) {
        this.cache.delete(key);
        removed++;
      }
    }

    return removed;
  }
}

// Create pre-configured cache instances for common use cases

/**
 * Profiles cache - 24 hour TTL
 * Profiles rarely change, can be cached longer
 */
export const profilesCache = new QueryCache(24 * 60 * 60 * 1000); // 24 hours

/**
 * Search terms cache - 5 minute TTL
 * Search results can be cached but need frequent updates
 */
export const searchTermsCache = new QueryCache(5 * 60 * 1000); // 5 minutes

/**
 * Campaigns cache - 5 minute TTL
 * Campaign data can be cached but needs reasonable freshness
 */
export const campaignsCache = new QueryCache(5 * 60 * 1000); // 5 minutes

/**
 * Metrics cache - 10 minute TTL
 * Performance metrics can use moderate caching
 */
export const metricsCache = new QueryCache(10 * 60 * 1000); // 10 minutes

// Cleanup expired entries periodically (every 5 minutes)
setInterval(() => {
  profilesCache.cleanup();
  searchTermsCache.cleanup();
  campaignsCache.cleanup();
  metricsCache.cleanup();
}, 5 * 60 * 1000);
