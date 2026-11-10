const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { app } = require('../server');

let server;
let port;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
        });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

test('1. Approved Admin origin receives CORS headers on GET', async () => {
  const origin = 'https://admin.whitecoat.academy';
  const res = await request('/api/health', {
    method: 'GET',
    headers: { 'Origin': origin },
  });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.headers['access-control-allow-origin'], origin);
  assert.strictEqual(res.headers['access-control-allow-credentials'], 'true');
});

test('2. Approved Student origin receives CORS headers on GET', async () => {
  const origin = 'https://student.whitecoat.academy';
  const res = await request('/api/health', {
    method: 'GET',
    headers: { 'Origin': origin },
  });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.headers['access-control-allow-origin'], origin);
  assert.strictEqual(res.headers['access-control-allow-credentials'], 'true');
});

test('3. Main website origin receives CORS headers on GET', async () => {
  const origin = 'https://whitecoat.academy';
  const res = await request('/api/health', {
    method: 'GET',
    headers: { 'Origin': origin },
  });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.headers['access-control-allow-origin'], origin);
  assert.strictEqual(res.headers['access-control-allow-credentials'], 'true');
});

test('4. Approved localhost development origin (any port) receives CORS headers', async () => {
  for (const origin of ['http://localhost:50079', 'http://localhost:3000', 'http://127.0.0.1:5173']) {
    const res = await request('/api/health', {
      method: 'GET',
      headers: { 'Origin': origin },
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['access-control-allow-origin'], origin);
    assert.strictEqual(res.headers['access-control-allow-credentials'], 'true');
  }
});

test('5. Approved staging origin receives CORS headers', async () => {
  const origin = 'https://unani-landing-screen.onrender.com';
  const res = await request('/api/health', {
    method: 'GET',
    headers: { 'Origin': origin },
  });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.headers['access-control-allow-origin'], origin);
  assert.strictEqual(res.headers['access-control-allow-credentials'], 'true');
});

test('6. Unapproved external origin is blocked (no Access-Control-Allow-Origin)', async () => {
  const unapprovedOrigin = 'https://unauthorized-malicious-site.com';
  const res = await request('/api/health', {
    method: 'GET',
    headers: { 'Origin': unapprovedOrigin },
  });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.headers['access-control-allow-origin'], undefined);
  assert.strictEqual(res.headers['access-control-allow-credentials'], undefined);
});

test('7. OPTIONS preflight with x-auth-retried and standard headers returns 204 with allowed headers', async () => {
  const origin = 'https://student.whitecoat.academy';
  const res = await request('/api/courses', {
    method: 'OPTIONS',
    headers: {
      'Origin': origin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization, x-auth-retried, content-type',
    },
  });
  assert.strictEqual(res.statusCode, 204);
  assert.strictEqual(res.headers['access-control-allow-origin'], origin);
  assert.strictEqual(res.headers['access-control-allow-credentials'], 'true');
  const allowedHeaders = (res.headers['access-control-allow-headers'] || '').toLowerCase();
  assert.ok(allowedHeaders.includes('x-auth-retried'), 'Allowed headers must include x-auth-retried');
  assert.ok(allowedHeaders.includes('authorization'), 'Allowed headers must include authorization');
  assert.ok(allowedHeaders.includes('content-type'), 'Allowed headers must include content-type');
});

test('8. OPTIONS preflight from unapproved origin does not return CORS allow headers', async () => {
  const unapprovedOrigin = 'https://unauthorized-malicious-site.com';
  const res = await request('/api/courses', {
    method: 'OPTIONS',
    headers: {
      'Origin': unapprovedOrigin,
      'Access-Control-Request-Method': 'POST',
    },
  });
  assert.strictEqual(res.headers['access-control-allow-origin'], undefined);
});

test('9. HTTP 404 Route Not Found preserves CORS headers for approved origins', async () => {
  const origin = 'https://admin.whitecoat.academy';
  const res = await request('/api/nonexistent-route-endpoint-xyz', {
    method: 'GET',
    headers: { 'Origin': origin },
  });
  assert.strictEqual(res.statusCode, 404);
  assert.strictEqual(res.headers['access-control-allow-origin'], origin);
  assert.strictEqual(res.headers['access-control-allow-credentials'], 'true');
});

test('10. HTTP 401 Unauthorized preserves CORS headers for approved origins', async () => {
  const origin = 'https://student.whitecoat.academy';
  const res = await request('/api/s3-upload/media/access-url', {
    method: 'GET',
    headers: { 'Origin': origin },
  });
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.headers['access-control-allow-origin'], origin);
  assert.strictEqual(res.headers['access-control-allow-credentials'], 'true');
});

test('11. Standard methods are advertised in preflight (GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD)', async () => {
  const origin = 'https://admin.whitecoat.academy';
  const res = await request('/api/upload', {
    method: 'OPTIONS',
    headers: {
      'Origin': origin,
      'Access-Control-Request-Method': 'PUT',
    },
  });
  assert.strictEqual(res.statusCode, 204);
  const methods = res.headers['access-control-allow-methods'] || '';
  for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) {
    assert.ok(methods.includes(m), `Expected method ${m} in Access-Control-Allow-Methods`);
  }
});

test('12. Direct non-browser request without Origin header succeeds cleanly', async () => {
  const res = await request('/api/health', {
    method: 'GET',
  });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.headers['access-control-allow-origin'], undefined);
});

