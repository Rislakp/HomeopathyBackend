const fs = require('fs');
let content = fs.readFileSync('controllers/s3UploadController.js', 'utf8');

const target1 = `      if (!foundMedia) {
        let ExamModel;`;
const target1CRLF = target1.replace(/\n/g, '\r\n');

const replace1 = `      if (!foundMedia && mongoose.connection?.readyState === 1) {
        let ExamModel;`;
const replace1CRLF = replace1.replace(/\n/g, '\r\n');

if (content.includes(target1CRLF)) {
  content = content.replace(target1CRLF, replace1CRLF);
} else if (content.includes(target1)) {
  content = content.replace(target1, replace1);
} else {
  console.warn('target1 not found');
}

const target2 = `      if (String(resolvedCourse.status || '').toLowerCase() !== 'published') {`;
const target2CRLF = target2.replace(/\n/g, '\r\n');

const replace2 = `      const courseStatus = resolvedCourse.status ? String(resolvedCourse.status).toLowerCase() : 'published';
      if (courseStatus !== 'published') {`;
const replace2CRLF = replace2.replace(/\n/g, '\r\n');

if (content.includes(target2CRLF)) {
  content = content.replace(target2CRLF, replace2CRLF);
} else if (content.includes(target2)) {
  content = content.replace(target2, replace2);
} else {
  console.warn('target2 not found');
}

fs.writeFileSync('controllers/s3UploadController.js', content, 'utf8');
console.log('Successfully updated s3UploadController.js with resilient checks');

