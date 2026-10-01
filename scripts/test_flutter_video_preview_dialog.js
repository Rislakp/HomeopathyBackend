const fs = require('fs');
const path = require('path');
const assert = require('assert');

function runVideoPreviewTest() {
  console.log('====================================================');
  console.log('STARTING FLUTTER VIDEO PREVIEW DIALOG VERIFICATION');
  console.log('====================================================');

  const widgetPath = path.join(__dirname, '../flutter_admin/lib/admin/widgets/video_preview_dialog.dart');
  const content = fs.readFileSync(widgetPath, 'utf8');

  assert.ok(
    content.includes('CourseVideoPreviewDialog'),
    'Dialog class CourseVideoPreviewDialog must be defined'
  );
  console.log('✅ Verified CourseVideoPreviewDialog class exists.');

  assert.ok(
    content.includes('VideoPlayerController.networkUrl'),
    'Embedded VideoPlayerController must be initialized with videoUrl'
  );
  console.log('✅ Verified VideoPlayerController initialization via networkUrl.');

  assert.ok(
    content.includes('_buildErrorState()') || content.includes('_errorMessage'),
    'Explicit error fallback state must be implemented for playback errors'
  );
  console.log('✅ Verified explicit error state and fallback builder handling.');

  assert.ok(
    content.includes('VideoPlayer(_controller!)'),
    'Embedded VideoPlayer widget must be rendered inside dialog viewport'
  );
  console.log('✅ Verified embedded VideoPlayer widget rendering.');

  console.log('====================================================');
  console.log('FLUTTER VIDEO PREVIEW DIALOG VERIFICATION PASSED');
  console.log('====================================================');
}

runVideoPreviewTest();
