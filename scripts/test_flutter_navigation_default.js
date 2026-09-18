const fs = require('fs');
const path = require('path');
const assert = require('assert');

function runNavigationTest() {
  console.log('====================================================');
  console.log('STARTING FLUTTER ADMIN NAVIGATION DEFAULT VERIFICATION');
  console.log('====================================================');

  const routerPath = path.join(__dirname, '../flutter_admin/lib/routes/app_router.dart');
  const routerContent = fs.readFileSync(routerPath, 'utf8');

  assert.ok(
    routerContent.includes("initialLocation = '/admin/dashboard'") || routerContent.includes("initialLocation: '/admin/dashboard'"),
    "GoRouter initialLocation must be set to '/admin/dashboard'"
  );
  console.log("✅ Verified AppRouter initialLocation is set to '/admin/dashboard'");

  const shellPath = path.join(__dirname, '../flutter_admin/lib/admin/screens/admin_main_shell.dart');
  const shellContent = fs.readFileSync(shellPath, 'utf8');

  assert.ok(
    shellContent.includes('_selectedIndex = 0') || shellContent.includes('initialIndex = 0'),
    'AdminMainShell initial index must default to 0 (Dashboard)'
  );
  console.log('✅ Verified AdminMainShell sidebar default index is set to 0 (Dashboard)');

  const mainPath = path.join(__dirname, '../flutter_admin/lib/main.dart');
  const mainContent = fs.readFileSync(mainPath, 'utf8');

  assert.ok(
    mainContent.includes('resetDefaultTabToDashboard()'),
    'main.dart must clear persistent tab state on startup'
  );
  console.log('✅ Verified main.dart resets persistent tab state on cold start');

  console.log('====================================================');
  console.log('FLUTTER NAVIGATION DEFAULT VERIFICATION PASSED CLEANLY');
  console.log('====================================================');
}

runNavigationTest();
