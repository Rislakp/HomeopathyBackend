const fs = require('fs');
const path = require('path');

function replaceExact(filePath, needle, replacement) {
  const fullPath = path.resolve(filePath);
  let content = fs.readFileSync(fullPath, 'utf8');
  const normalizedNeedle = needle.replace(/\r?\n/g, content.includes('\r\n') ? '\r\n' : '\n');
  const normalizedReplacement = replacement.replace(/\r?\n/g, content.includes('\r\n') ? '\r\n' : '\n');
  if (!content.includes(normalizedNeedle)) {
    throw new Error(`Needle not found in ${filePath}:\n${normalizedNeedle.slice(0, 80)}...`);
  }
  content = content.replace(normalizedNeedle, normalizedReplacement);
  fs.writeFileSync(fullPath, content, 'utf8');
  console.log(`Successfully updated ${filePath}`);
}

// 3. controllers/s3UploadController.js
const s3UploadPath = 'controllers/s3UploadController.js';
let s3UpContent = fs.readFileSync(s3UploadPath, 'utf8');

const anchor1 = "if (!safeName) return fail(res, 400, 'A valid fileName is required.');";
const anchor2 = "if (req.body?.fileSize !== undefined && !validSize(req.body.fileSize, VIDEO_MAX_BYTES)) return fail(res, 400, 'fileSize must be a positive safe integer no greater than 2 TiB.');";
const idx1 = s3UpContent.indexOf(anchor1);
const idx2 = s3UpContent.indexOf(anchor2);
if (idx1 === -1 || idx2 === -1) throw new Error('Anchors not found in s3UploadController.js');

const originalMiddle = s3UpContent.slice(idx1, idx2);
const newMiddle = anchor1 + (s3UpContent.includes('\r\n') ? '\r\n' : '\n') +
  "  if (typeof contentType !== 'string' || !/^video\\/[a-z0-9][a-z0-9.+-]{0,126}$/i.test(contentType)) return fail(res, 400, 'contentType must be a valid video MIME type.');" + (s3UpContent.includes('\r\n') ? '\r\n' : '\n') +
  "  if (contentType.toLowerCase() === 'video/webm' || safeName.toLowerCase().endsWith('.webm')) {" + (s3UpContent.includes('\r\n') ? '\r\n' : '\n') +
  "    return fail(res, 400, 'WEBM format is not supported for iOS/Safari playback. Please upload MP4 with H.264 video and AAC audio.');" + (s3UpContent.includes('\r\n') ? '\r\n' : '\n') +
  "  }" + (s3UpContent.includes('\r\n') ? '\r\n' : '\n') + "  ";

s3UpContent = s3UpContent.slice(0, idx1) + newMiddle + s3UpContent.slice(idx2);

// Also update contentType logic in getMediaAccessUrl
const getMediaOld = "if (prefix === 'videos/' || prefix === 'live_records/') {\r\n      contentType = key.endsWith('.webm') ? 'video/webm' : (key.endsWith('.mov') ? 'video/quicktime' : 'video/mp4');\r\n    }";
const getMediaOldLF = "if (prefix === 'videos/' || prefix === 'live_records/') {\n      contentType = key.endsWith('.webm') ? 'video/webm' : (key.endsWith('.mov') ? 'video/quicktime' : 'video/mp4');\n    }";
const getMediaNew = "if (prefix === 'videos/' || prefix === 'live_records/') {\n      const keyLower = key.toLowerCase();\n      contentType = keyLower.endsWith('.mp4') || keyLower.endsWith('.m4v')\n        ? 'video/mp4'\n        : (keyLower.endsWith('.mov') ? 'video/quicktime' : (keyLower.endsWith('.webm') ? 'video/webm' : 'video/mp4'));\n    }";

if (s3UpContent.includes(getMediaOld)) {
  s3UpContent = s3UpContent.replace(getMediaOld, getMediaNew.replace(/\n/g, '\r\n'));
} else if (s3UpContent.includes(getMediaOldLF)) {
  s3UpContent = s3UpContent.replace(getMediaOldLF, getMediaNew);
} else {
  throw new Error('getMediaOld not found in s3UploadController.js');
}

fs.writeFileSync(s3UploadPath, s3UpContent, 'utf8');
console.log('Successfully updated controllers/s3UploadController.js');

// 4. controllers/courseController.js
const courseCtrlPath = 'controllers/courseController.js';
replaceExact(courseCtrlPath,
  "const ALLOWED_VIDEO_FORMATS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v'];",
  "const ALLOWED_VIDEO_FORMATS = ['mp4', 'mov', 'avi', 'mkv', 'flv', 'wmv', 'm4v'];"
);

// 5. middleware/upload.js
const uploadPath = 'middleware/upload.js';
replaceExact(uploadPath,
  "const ALLOWED_VIDEO_FORMATS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v'];",
  "const ALLOWED_VIDEO_FORMATS = ['mp4', 'mov', 'avi', 'mkv', 'flv', 'wmv', 'm4v'];"
);

// 6. controllers/demoVideoController.js
const demoVideoPath = 'controllers/demoVideoController.js';
replaceExact(demoVideoPath,
  "const contentType = key.toLowerCase().endsWith('.webm') ? 'video/webm' : (key.toLowerCase().endsWith('.mov') ? 'video/quicktime' : 'video/mp4');",
  "const keyLower = key.toLowerCase();\r\n      const contentType = keyLower.endsWith('.mp4') || keyLower.endsWith('.m4v')\r\n        ? 'video/mp4'\r\n        : (keyLower.endsWith('.mov') ? 'video/quicktime' : (keyLower.endsWith('.webm') ? 'video/webm' : 'video/mp4'));"
);

// 7. controllers/recordingController.js
const recordingPath = 'controllers/recordingController.js';
replaceExact(recordingPath,
  `const inferredMime = recS3Key.endsWith('.webm') || rec.format === 'webm'\r\n    ? 'video/webm'\r\n    : (recS3Key.endsWith('.mov') || rec.format === 'mov' ? 'video/quicktime' : 'video/mp4');`,
  `const inferredMime = recS3Key.endsWith('.mp4') || rec.format === 'mp4'\r\n    ? 'video/mp4'\r\n    : (recS3Key.endsWith('.mov') || rec.format === 'mov'\r\n      ? 'video/quicktime'\r\n      : (recS3Key.endsWith('.webm') || rec.format === 'webm' ? 'video/webm' : 'video/mp4'));`
);

console.log('All remaining code fixes applied successfully!');
