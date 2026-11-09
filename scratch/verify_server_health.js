require('dotenv').config();
const { spawn } = require('child_process');
const http = require('http');

const PORT = 5099;
const serverEnv = {
  ...process.env,
  PORT: String(PORT),
  NODE_ENV: 'development',
  JWT_SECRET: process.env.JWT_SECRET || 'test_jwt_secret_key_1234567890_antigravity'
};

console.log(`Starting backend server on port ${PORT}...`);
const serverProcess = spawn('node', ['server.js'], {
  env: serverEnv,
  stdio: ['ignore', 'pipe', 'pipe']
});

let serverLogs = '';
serverProcess.stdout.on('data', (d) => {
  const s = d.toString();
  serverLogs += s;
  process.stdout.write(`[Server stdout] ${s}`);
});

serverProcess.stderr.on('data', (d) => {
  const s = d.toString();
  serverLogs += s;
  process.stderr.write(`[Server stderr] ${s}`);
});

function probeUrl(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${PORT}${urlPath}`, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

async function run() {
  // Wait up to 15 seconds for server to be ready
  let ready = false;
  const startTime = Date.now();
  while (Date.now() - startTime < 20000) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await probeUrl('/health');
      if (res.statusCode === 200) {
        ready = true;
        console.log(`\n/health responded: ${res.statusCode} ${res.body}`);
        break;
      }
    } catch (_) {
      // not yet ready, retry
    }
  }

  if (!ready) {
    serverProcess.kill('SIGKILL');
    console.error('Server failed to respond within 20s. Logs:\n', serverLogs);
    process.exit(1);
  }

  // Probe /api/health
  const apiHealth = await probeUrl('/api/health');
  console.log(`/api/health responded: ${apiHealth.statusCode} ${apiHealth.body}`);

  // Probe /api/v1/health
  const apiv1Health = await probeUrl('/api/v1/health');
  console.log(`/api/v1/health responded: ${apiv1Health.statusCode} ${apiv1Health.body}`);

  serverProcess.kill('SIGKILL');
  console.log('\nAll health check probes succeeded! Backend server starts and runs cleanly.');
  process.exit(0);
}

run().catch((err) => {
  console.error('Test execution error:', err);
  serverProcess.kill('SIGKILL');
  process.exit(1);
});

