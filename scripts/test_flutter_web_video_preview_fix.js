const fs = require('fs');
const path = require('path');
const assert = require('assert');

function runWebVideoPreviewFixTest() {
  console.log('====================================================');
  console.log('STARTING FLUTTER WEB VIDEO PREVIEW FIX VERIFICATION');
  console.log('====================================================');

  const dialogPath = path.join(__dirname, '../flutter_admin/lib/admin/widgets/video_preview_dialog.dart');
  const content = fs.readFileSync(dialogPath, 'utf8');

  // 1. Verify VideoPlayerController.networkUrl usage
  assert.ok(
    content.includes('VideoPlayerController.networkUrl('),
    'VideoPreviewDialog must initialize using VideoPlayerController.networkUrl()'
  );
  console.log('✅ 1. Verified VideoPlayerController.networkUrl() initialization.');

  // 2. Verify required debug print logs
  const requiredLogs = [
    "[VideoPreview] URL:",
    "[VideoPreview] Initializing video player...",
    "[VideoPreview] Video initialized",
    "[VideoPreview] Duration:",
    "[VideoPreview] Aspect Ratio:",
    "[VideoPreview] Video initialization error:"
  ];

  for (const log of requiredLogs) {
    assert.ok(content.includes(log), `Required debug log missing: "${log}"`);
  }
  console.log('✅ 2. Verified all required debug console log prints are present.');

  // 3. Verify user-facing error message
  assert.ok(
    content.includes('Unable to play this video.'),
    'User-facing error message must display "Unable to play this video."'
  );
  console.log('✅ 3. Verified user-facing error message handling ("Unable to play this video.").');

  // 4. Verify missing/empty URL handling
  assert.ok(
    content.includes('No video available.'),
    'Missing or empty URL must display "No video available."'
  );
  console.log('✅ 4. Verified empty/null URL handling ("No video available.").');

  // 5. Verify VideoPlayer rendering & controls
  assert.ok(
    content.includes('VideoPlayer(_controller!)') &&
    content.includes('VideoProgressIndicator'),
    'Dialog must render VideoPlayer and VideoProgressIndicator controls'
  );
  console.log('✅ 5. Verified embedded VideoPlayer widget & playback controls.');

  console.log('====================================================');
  console.log('FLUTTER WEB VIDEO PREVIEW FIX VERIFICATION PASSED');
  console.log('====================================================');
}

runWebVideoPreviewFixTest();
