const fs = require('fs');
let c = fs.readFileSync('server.js', 'utf8');
c = c.replace(/app\.use\('\/api\/admin', adminRoutes\);[\s\S]*?\}\);[\s\r\n]*\/\/ 404 Route Not Found Catch-All/, "app.use('/api/admin', adminRoutes);\n\n// 404 Route Not Found Catch-All");
fs.writeFileSync('server.js', c, 'utf8');
console.log('Cleaned server.js successfully');
