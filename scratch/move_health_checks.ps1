$filePath = "c:\Users\admin\StudioProjects\HomeopathyBackend\server.js"
$content = [System.IO.File]::ReadAllText($filePath)

$healthBlock = @"
// ── Health Check Endpoints (Lightweight, stateless, Render load balancer compatible) ──
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

"@

# Remove the old health check block
$oldBlockRegex = "(?s)// ── Health Check Endpoints.*?app\.get\('/', \(req, res\) => \{\r?\n\s+res\.json\(\{\r?\n\s+success: true,\r?\n\s+message: 'Backend is working',\r?\n\s+\}\);\r?\n\}\);\r?\n"
$content = [System.Text.RegularExpressions.Regex]::Replace($content, $oldBlockRegex, "")

# Insert health checks right before "// Routes"
$target = "// Routes"
$content = $content.Replace($target, "$healthBlock`r`n$target")

[System.IO.File]::WriteAllText($filePath, $content)
Write-Output "SUCCESS"
