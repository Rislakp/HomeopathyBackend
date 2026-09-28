/**
 * Request Performance Logger Middleware
 *
 * Logs the duration of every API request in milliseconds.
 * Format:  [PERF] METHOD /path → STATUS in Xms
 *
 * Slow requests (>500ms) are highlighted with [SLOW] prefix.
 * Very slow requests (>2000ms) are highlighted with [CRITICAL] prefix.
 *
 * Usage: app.use(require('./utils/requestLogger'));
 */

function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();

  // Hook into response finish event to log timing
  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1e6; // nanoseconds → milliseconds
    const rounded = Math.round(durationMs * 100) / 100;

    const method = req.method;
    const url = req.originalUrl || req.url;
    const status = res.statusCode;

    let prefix = '[PERF]';
    if (rounded > 2000) {
      prefix = '[CRITICAL]';
    } else if (rounded > 500) {
      prefix = '[SLOW]';
    }

    // Only log non-static/asset requests
    const isAssetPath = /\.(js|css|ico|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|map)$/i.test(url);
    if (!isAssetPath) {
      console.log(`${prefix} ${method} ${url} → ${status} in ${rounded}ms`);
    }
  });

  next();
}

module.exports = requestLogger;
