const fs = require('fs');
const path = require('path');

const targetFile = path.resolve('controllers/s3UploadController.js');
let content = fs.readFileSync(targetFile, 'utf8');

const isCRLF = content.includes('\r\n');
const eol = isCRLF ? '\r\n' : '\n';

// Conflict 1
const c1Target = [
  '<<<<<<< HEAD',
  "      if (getProp(lesson, 'videoS3Key') === targetKey || getProp(lesson, 's3Key') === targetKey || getProp(lesson, 'mp4S3Key') === targetKey) return true;",
  '=======',
  "      if (getProp(lesson, 'videoS3Key') === targetKey || getProp(lesson, 's3Key') === targetKey || getProp(lesson, 'm4vS3Key') === targetKey) return true;",
  '>>>>>>> 93d3f8b0c1db39026c8ccc5fa55e936f66b6b703'
].join(eol);

const c1Replace = [
  '      if (',
  "        getProp(lesson, 'videoS3Key') === targetKey ||",
  "        getProp(lesson, 's3Key') === targetKey ||",
  "        getProp(lesson, 'm4vS3Key') === targetKey ||",
  "        getProp(lesson, 'mp4S3Key') === targetKey",
  '      ) return true;'
].join(eol);

if (!content.includes(c1Target)) {
  throw new Error('Conflict 1 target not found');
}
content = content.replace(c1Target, c1Replace);
console.log('Resolved Conflict 1');

// Conflict 2
const c2Target = [
  '<<<<<<< HEAD',
  "          const itemKey = getProp(item, 's3Key') || getProp(item, 'key') ||",
  "            getProp(item, 'mp4S3Key') ||",
  '=======',
  "          const itemKey = getProp(item, 's3Key') || getProp(item, 'm4vS3Key') || getProp(item, 'mp4S3Key') || getProp(item, 'key') ||",
  '>>>>>>> 93d3f8b0c1db39026c8ccc5fa55e936f66b6b703'
].join(eol);

const c2Replace = [
  "          const itemKey = getProp(item, 's3Key') ||",
  "            getProp(item, 'm4vS3Key') ||",
  "            getProp(item, 'mp4S3Key') ||",
  "            getProp(item, 'key') ||"
].join(eol);

if (!content.includes(c2Target)) {
  throw new Error('Conflict 2 target not found');
}
content = content.replace(c2Target, c2Replace);
console.log('Resolved Conflict 2');

// Conflict 3
const c3Target = [
  '<<<<<<< HEAD',
  "        { 'modules.lessons.videoParts.mp4S3Key': key },",
  '=======',
  "        { 'modules.lessons.m4vS3Key': key },",
  "        { 'modules.lessons.videoParts.m4vS3Key': key },",
  '>>>>>>> 93d3f8b0c1db39026c8ccc5fa55e936f66b6b703'
].join(eol);

const c3Replace = [
  "        { 'modules.lessons.m4vS3Key': key },",
  "        { 'modules.lessons.videoParts.m4vS3Key': key },",
  "        { 'modules.lessons.videoParts.mp4S3Key': key },"
].join(eol);

if (!content.includes(c3Target)) {
  throw new Error('Conflict 3 target not found');
}
content = content.replace(c3Target, c3Replace);
console.log('Resolved Conflict 3');

fs.writeFileSync(targetFile, content, 'utf8');
console.log('Updated controllers/s3UploadController.js successfully!');

