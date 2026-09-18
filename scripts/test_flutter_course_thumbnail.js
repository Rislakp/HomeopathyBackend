const fs = require('fs');
const path = require('path');
const assert = require('assert');

function runCourseThumbnailTest() {
  console.log('====================================================');
  console.log('STARTING FLUTTER COURSE THUMBNAIL VERIFICATION');
  console.log('====================================================');

  const modelPath = path.join(__dirname, '../flutter_admin/lib/models/course_model.dart');
  const modelContent = fs.readFileSync(modelPath, 'utf8');

  assert.ok(
    modelContent.includes("json['thumbnail']") &&
    modelContent.includes("json['bannerUrl']") &&
    modelContent.includes("json['courseBanner']"),
    'CourseModel must inspect thumbnail, bannerUrl, and courseBanner fields'
  );
  console.log('✅ Verified CourseModel inspects thumbnail, bannerUrl, and courseBanner fields.');

  const widgetPath = path.join(__dirname, '../flutter_admin/lib/admin/widgets/course_thumbnail_widget.dart');
  const widgetContent = fs.readFileSync(widgetPath, 'utf8');

  assert.ok(
    widgetContent.includes('Image.network'),
    'CourseThumbnailWidget must use Image.network for remote image rendering'
  );
  console.log('✅ Verified Image.network rendering.');

  assert.ok(
    widgetContent.includes('errorBuilder:'),
    'CourseThumbnailWidget must provide errorBuilder for handling broken images'
  );
  console.log('✅ Verified errorBuilder fallback state.');

  assert.ok(
    widgetContent.includes('Icons.broken_image'),
    'CourseThumbnailWidget must render broken image icon fallback'
  );
  console.log('✅ Verified broken image fallback icon rendering.');

  console.log('====================================================');
  console.log('FLUTTER COURSE THUMBNAIL VERIFICATION PASSED');
  console.log('====================================================');
}

runCourseThumbnailTest();
