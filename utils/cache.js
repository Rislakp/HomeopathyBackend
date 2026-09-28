/**
 * Lightweight, high-performance in-memory TTL cache service.
 * Eliminates repetitive database queries for static/public data (course lists, categories,
 * subscription plans, faculty, and dashboard stats) during concurrent traffic bursts.
 *
 * Fully stateless per process instance; requires no external Redis infrastructure.
 */
class MemoryCache {
  constructor(defaultTtlSeconds = 30) {
    this.store = new Map();
    this.defaultTtlMs = defaultTtlSeconds * 1000;
  }

  /**
   * Get cached item if valid, otherwise return null
   */
  get(key) {
    const item = this.store.get(key);
    if (!item) return null;

    if (Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return item.value;
  }

  /**
   * Set cache item with optional custom TTL in seconds
   */
  set(key, value, ttlSeconds) {
    const ttlMs = ttlSeconds ? ttlSeconds * 1000 : this.defaultTtlMs;
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Invalidate specific key or prefix
   */
  del(keyOrPrefix) {
    for (const key of this.store.keys()) {
      if (key === keyOrPrefix || key.startsWith(keyOrPrefix)) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Clear all cached keys
   */
  flush() {
    this.store.clear();
  }
}

const memoryCache = new MemoryCache(30);

module.exports = memoryCache;
