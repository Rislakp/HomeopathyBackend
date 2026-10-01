require('dotenv').config();

const mongoose = require('mongoose');
const https = require('https');
const Course = require('../models/Course');

const checkUrl = (url) => new Promise((resolve) => {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return resolve({ reachable: false, reason: 'invalid URL' });
  }

  if (parsed.protocol !== 'https:') {
    return resolve({ reachable: false, reason: 'URL is not HTTPS' });
  }

  const request = https.request(parsed, { method: 'HEAD', timeout: 15000 }, (response) => {
    response.resume();
    resolve({
      reachable: response.statusCode >= 200 && response.statusCode < 400,
      status: response.statusCode,
      contentType: response.headers['content-type'] || '',
      bytes: Number(response.headers['content-length'] || 0),
    });
  });
  request.on('timeout', () => request.destroy(new Error('timeout')));
  request.on('error', (error) => resolve({ reachable: false, reason: error.message }));
  request.end();
});

const isPdf = (resource) => {
  const value = resource || {};
  return value.mimetype === 'application/pdf' || /\.pdf(?:$|[?#])/i.test(value.title || value.url || value.secure_url || '');
};

async function main() {
  const uri = process.env.USE_LOCAL_DB === 'true'
    ? process.env.MONGODB_LOCAL_URI
    : (process.env.MONGODB_URI || process.env.MONGO_URI);
  if (!uri) throw new Error('MongoDB connection string is not configured.');

  await mongoose.connect(uri);
  const courses = await Course.find({}, { courseTitle: 1, modules: 1 }).lean();
  const records = [];

  for (const course of courses) {
    for (const module of course.modules || []) {
      for (const lesson of module.lessons || []) {
        for (const category of ['pdfNotes', 'assignments', 'attachments']) {
          for (const resource of lesson[category] || []) {
            if (!isPdf(resource)) continue;
            const url = resource.secure_url || resource.url || '';
            const result = {
              course: course.courseTitle,
              lesson: lesson.lessonTitle,
              category,
              title: resource.title || '',
              url,
              public_id: resource.public_id || '',
              resource_type: resource.resource_type || '',
              mimetype: resource.mimetype || '',
            };
            result.url_check = url ? await checkUrl(url) : { reachable: false, reason: 'missing URL' };
            records.push(result);
          }
        }
      }
    }
  }

  console.log(JSON.stringify({ count: records.length, records }, null, 2));
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(`PDF diagnostic failed: ${error.message}`);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});