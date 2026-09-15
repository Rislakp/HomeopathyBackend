const fs = require('fs');
const path = require('path');

const adminAuthRoutesPath = path.resolve('routes', 'adminAuthRoutes.js');
let adminAuthRoutesContent = fs.readFileSync(adminAuthRoutesPath, 'utf8');

// Update imports
adminAuthRoutesContent = adminAuthRoutesContent.replace('const { adminLogin } = require(\'../controllers/adminAuthController\');', 'const { adminLogin, registerAdmin } = require(\'../controllers/adminAuthController\');');

// Add register route
adminAuthRoutesContent = adminAuthRoutesContent.replace('// Route: POST /api/admin/auth/login', '// Route: POST /api/admin/auth/register\nrouter.post(\'/register\', registerAdmin);\n\n// Route: POST /api/admin/auth/login');

fs.writeFileSync(adminAuthRoutesPath, adminAuthRoutesContent, 'utf8');
console.log('Successfully updated adminAuthRoutes.js');
