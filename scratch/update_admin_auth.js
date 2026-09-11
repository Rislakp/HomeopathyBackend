const fs = require('fs');
const path = require('path');

const authRoutesPath = path.resolve('routes', 'auth.routes.js');
const adminAuthControllerPath = path.resolve('controllers', 'adminAuthController.js');

const authRoutesContent = fs.readFileSync(authRoutesPath, 'utf8');
let adminAuthControllerContent = fs.readFileSync(adminAuthControllerPath, 'utf8');

// Extract the logic from auth.routes.js
// It's router.post('/register', async (req, res) => { ... });
const startIndex = authRoutesContent.indexOf('router.post(\'/register\', async (req, res) => {');
const endIndex = authRoutesContent.indexOf('});', startIndex + 50) + 3; // Find the closing brace of router.post

let registerLogic = authRoutesContent.substring(startIndex, endIndex);

// Format as a named function
registerLogic = registerLogic.replace('router.post(\'/register\', async (req, res) => {', 'const registerAdmin = async (req, res) => {');

// Add bcrypt require if missing
if (!adminAuthControllerContent.includes('bcryptjs')) {
    adminAuthControllerContent = "const bcrypt = require('bcryptjs');\n" + adminAuthControllerContent;
}

// Inject into adminAuthController.js before module.exports
const moduleExportsIndex = adminAuthControllerContent.indexOf('module.exports = {');
adminAuthControllerContent = adminAuthControllerContent.substring(0, moduleExportsIndex) + '\n' + registerLogic + '\n\n' + adminAuthControllerContent.substring(moduleExportsIndex);

// Add to exports
adminAuthControllerContent = adminAuthControllerContent.replace('module.exports = {', 'module.exports = {\n  registerAdmin,');

fs.writeFileSync(adminAuthControllerPath, adminAuthControllerContent, 'utf8');
console.log('Successfully updated adminAuthController.js');
