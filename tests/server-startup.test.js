const { spawnSync } = require('child_process');

console.log('Testing Server Production Mode JWT_SECRET Check...');

// Run without JWT_SECRET
const env = { ...process.env, NODE_ENV: 'production' };
delete env.JWT_SECRET; // Explicitly remove it for the test

const result1 = spawnSync('node', ['server.js'], { env });

if (result1.status !== 1) {
  console.error('Test Failed: Server did not exit with code 1 when JWT_SECRET missing in production');
  process.exit(1);
}

if (!result1.stderr.toString().includes('FATAL ERROR: JWT_SECRET environment variable is missing')) {
  console.error('Test Failed: Missing expected fatal error message');
  process.exit(1);
}

console.log('✔ Passed: Server fails safely when JWT_SECRET missing in production');

// We won't test with JWT_SECRET since it would actually start the server and hang the test,
// but the exit code 1 check confirms the behavior.
console.log('\nAll Tests Passed!');
