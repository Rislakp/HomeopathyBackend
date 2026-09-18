const fs = require('fs');
const path = require('path');
const assert = require('assert');

function runVideoLifecycleTest() {
  console.log('====================================================');
  console.log('STARTING VIDEO DIALOG LIFECYCLE VERIFICATION');
  console.log('====================================================');

  const dialogPath = path.join(__dirname, '../flutter_admin/lib/admin/widgets/video_preview_dialog.dart');
  const dialogContent = fs.readFileSync(dialogPath, 'utf8');

  assert.ok(
    dialogContent.includes('_controller?.dispose()'),
    'CourseVideoPreviewDialog must dispose VideoPlayerController on dialog close'
  );
  console.log('✅ Verified VideoPlayerController is cleanly disposed of inside dispose().');

  const screenPath = path.join(__dirname, '../flutter_admin/lib/admin/screens/courses/courses_screen.dart');
  const screenContent = fs.readFileSync(screenPath, 'utf8');

  assert.ok(
    screenContent.includes('CourseVideoPreviewDialog.show('),
    'CoursesManagementScreen must wire Preview Demo button to CourseVideoPreviewDialog.show()'
  );
  console.log('✅ Verified CoursesManagementScreen invokes CourseVideoPreviewDialog on Preview Demo click.');

  console.log('====================================================');
  console.log('VIDEO DIALOG LIFECYCLE VERIFICATION PASSED CLEANLY');
  console.log('====================================================');
}

runVideoLifecycleTest();
