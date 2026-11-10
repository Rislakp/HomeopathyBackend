/**
 * In-memory sliding-window rate limiter middleware.
 * Provides rate limiting for public auth endpoints without requiring Redis.
 */
const createRateLimiter = ({
  windowMs = 15 * 60 * 1000, // 15 minutes default
  max = 5,                   // 5 requests per window default
  message = 'Too many requests. Please try again later.',
  keyGenerator,
} = {}) => {
  const store = new Map();

  // Periodic cleanup of stale entries every 5 minutes to prevent memory leaks
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of store.entries()) {
      if (now > record.resetTime) {
        store.delete(key);
      }
    }
  }, 5 * 60 * 1000);

  // Do not hold Node process open in test environments
  if (cleanupTimer.unref) {
    cleanupTimer.unref();
  }

  const defaultKeyGen = (req) => {
    const clientIp = req.ip ||
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.connection?.remoteAddress ||
      'unknown';

    const identifier = req.body?.email
      ? String(req.body.email).trim().toLowerCase()
      : '';

    return `${clientIp}_${identifier}`;
  };

  const limiter = (req, res, next) => {
    const keyGen = keyGenerator || defaultKeyGen;
    const key = keyGen(req);
    const now = Date.now();

    let record = store.get(key);

    if (!record || now > record.resetTime) {
      record = {
        count: 1,
        resetTime: now + windowMs,
      };
      store.set(key, record);
    } else {
      record.count += 1;
    }

    const remaining = Math.max(0, max - record.count);
    const resetSeconds = Math.ceil((record.resetTime - now) / 1000);

    res.setHeader('RateLimit-Limit', max);
    res.setHeader('RateLimit-Remaining', remaining);
    res.setHeader('RateLimit-Reset', resetSeconds);

    if (record.count > max) {
      res.setHeader('Retry-After', resetSeconds);
      return res.status(429).json({
        success: false,
        message,
        retryAfterSeconds: resetSeconds,
      });
    }

    next();
  };

  // Helper for test isolation
  limiter.reset = () => {
    store.clear();
  };

  limiter.destroy = () => {
    clearInterval(cleanupTimer);
    store.clear();
  };

  return limiter;
};

module.exports = {
  createRateLimiter,
};

