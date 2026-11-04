const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, '../controllers/s3UploadController.js');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Update lesson-level check in courseContainsMediaKey
const targetLessonCheck = "if (getProp(lesson, 'videoS3Key') === targetKey || getProp(lesson, 's3Key') === targetKey) return true;";
const replaceLessonCheck = "if (getProp(lesson, 'videoS3Key') === targetKey || getProp(lesson, 's3Key') === targetKey || getProp(lesson, 'mp4S3Key') === targetKey) return true;";

if (!content.includes(targetLessonCheck)) {
  console.error('Target 1 not found!');
  process.exit(1);
}
content = content.replace(targetLessonCheck, replaceLessonCheck);

// 2. Update itemKey in courseContainsMediaKey
const targetItemKey = "const itemKey = getProp(item, 's3Key') || getProp(item, 'key') ||\r\n            getS3KeyFromUrl(getProp(item, 'url')) ||";
const replaceItemKey = "const itemKey = getProp(item, 's3Key') || getProp(item, 'key') ||\r\n            getProp(item, 'mp4S3Key') ||\r\n            getS3KeyFromUrl(getProp(item, 'url')) ||";

if (content.includes(targetItemKey)) {
  content = content.replace(targetItemKey, replaceItemKey);
} else {
  const targetItemKeyLf = targetItemKey.replace(/\r\n/g, '\n');
  const replaceItemKeyLf = replaceItemKey.replace(/\r\n/g, '\n');
  if (!content.includes(targetItemKeyLf)) {
    console.error('Target 2 not found!');
    process.exit(1);
  }
  content = content.replace(targetItemKeyLf, replaceItemKeyLf);
}

// 3. Update searchConditions
const targetSearch = "{ 'modules.lessons.videoParts.s3Key': key },";
const replaceSearch = "{ 'modules.lessons.mp4S3Key': key },\r\n        { 'modules.lessons.videoParts.s3Key': key },\r\n        { 'modules.lessons.videoParts.mp4S3Key': key },";

if (content.includes(targetSearch)) {
  content = content.replace(targetSearch, replaceSearch);
} else {
  const targetSearchLf = targetSearch.replace(/\r\n/g, '\n');
  const replaceSearchLf = replaceSearch.replace(/\r\n/g, '\n');
  if (!content.includes(targetSearchLf)) {
    console.error('Target 3 not found!');
    process.exit(1);
  }
  content = content.replace(targetSearchLf, replaceSearchLf);
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully updated s3UploadController.js');

