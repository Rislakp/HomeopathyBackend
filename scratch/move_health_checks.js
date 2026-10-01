const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
let content = fs.readFileSync(serverPath, 'utf8');

const healthBlock = `// ── Health Check Endpoints (Lightweight, stateless, Render load balancer compatible) ──
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
  });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    success: true,
    message: 'Server is awake',
    timestamp: Date.now(),
  });
});
app.get('/api/v1/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    success: true,
    message: 'Server is awake',
    timestamp: Date.now(),
  });
});

// Test
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Backend is working',
  });
});
`;

// Find where health checks currently exist
const startIndex = content.indexOf("app.get('/health'");
if (startIndex !== -1) {
  // Find where the block ends (after app.get('/', ... });)
  const endIndex = content.indexOf("});", content.indexOf("app.get('/'", startIndex)) + 3;
  if (endIndex > startIndex) {
    const before = content.slice(0, startIndex);
    // Find the comment line before startIndex
    const commentStart = before.lastIndexOf('//');
    content = content.slice(0, commentStart) + content.slice(endIndex);
  }
}

// Insert healthBlock before "// Routes"
const routesIndex = content.indexOf('// Routes');
if (routesIndex !== -1) {
  content = content.slice(0, routesIndex) + healthBlock + '\n\n' + content.slice(routesIndex);
}

fs.writeFileSync(serverPath, content, 'utf8');
console.log('SUCCESSFULLY MOVED HEALTH CHECKS');
