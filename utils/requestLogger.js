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
    const rawUrl = req.originalUrl || req.url;
    const status = res.statusCode;

    // Redact sensitive query parameters if present
    const cleanUrl = rawUrl.replace(
      /([?&](?:token|password|auth|secret|jwt|key)=)[^&]*/gi,
      '$1[REDACTED]'
    );

    let severity = '';
    if (rounded > 2000) {
      severity = ' [CRITICAL]';
    } else if (rounded > 500) {
      severity = ' [SLOW]';
    }

    // Only log non-static/asset requests
    const isAssetPath = /\.(js|css|ico|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|map)$/i.test(cleanUrl);
    if (!isAssetPath) {
      console.log(`[PERF] ${method} ${cleanUrl} ${status} ${rounded}ms${severity}`);
    }
  });

  next();
}

module.exports = requestLogger;

