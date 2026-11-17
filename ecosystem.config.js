// PM2 process config for production (EC2).
// Cluster mode runs several copies of the API. `pm2 reload` restarts them one at a
// time, so a deploy no longer takes the API down (no 502s while it restarts).
module.exports = {
  apps: [
    {
      name: 'ptblync-backend',
      script: 'server.js',
      cwd: __dirname,
      exec_mode: 'cluster',
      // Two copies by default; set WEB_CONCURRENCY to change (e.g. one per CPU core).
      instances: Number(process.env.WEB_CONCURRENCY) || 2,
      // server.js closes connections on SIGINT and force-exits after 10 s; give it 12 s.
      kill_timeout: 12000,
      listen_timeout: 20000,
      max_memory_restart: process.env.PM2_MAX_MEMORY || '900M',
      // No env overrides: server.js loads .env exactly as before.
    },
  ],
};
