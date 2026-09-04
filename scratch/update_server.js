const fs = require('fs');
const path = require('path');

const serverPath = path.resolve('server.js');
let serverContent = fs.readFileSync(serverPath, 'utf8');

// Remove references to auth.routes.js
serverContent = serverContent.replace('const newAuthRoutes = require(\'./routes/auth.routes\');\n', '');
serverContent = serverContent.replace('app.use(\'/api/auth_new\', newAuthRoutes);\n', '');

fs.writeFileSync(serverPath, serverContent, 'utf8');
console.log('Successfully updated server.js');

// Delete auth.routes.js
fs.unlinkSync(path.resolve('routes', 'auth.routes.js'));
console.log('Successfully deleted auth.routes.js');
