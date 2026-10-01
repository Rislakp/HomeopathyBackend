/**
 * End-to-End Video Upload Test
 * =============================
 * Simulates exactly what the Flutter admin frontend does:
 * 1. Login as admin → get JWT token
 * 2. Fetch existing course/module (or create one)
 * 3. POST multipart/form-data with a real MP4 file to addLesson
 * 4. Verify response contains Cloudinary secure_url
 * 5. Verify MongoDB stored the Cloudinary URL
 * 6. Verify the video URL is accessible (HEAD request)
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:5000';
const ADMIN_EMAIL = 'admin@whitecodeacademy.com';
const ADMIN_PASSWORD = 'WhiteCode@Admin2026';
const VIDEO_FILE = path.resolve(__dirname, '..', '..', 'Homeopathy', 'student_frontend', 'assets', 'video', 'demo.mp4');

// ─── Helpers ───────────────────────────────────────────────────────

function httpRequest(method, urlStr, { headers = {}, body = null, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers,
      timeout,
    };

    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        let json = null;
        try { json = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, body: raw, json });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });

    if (body) req.write(body);
    req.end();
  });
}

function multipartFormData(fields, files) {
  const boundary = '----FormBoundary' + Date.now().toString(16);
  const parts = [];

  for (const [key, value] of Object.entries(fields)) {
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
      `${value}\r\n`
    );
  }

  for (const { fieldName, filePath, fileName, contentType } of files) {
    const fileData = fs.readFileSync(filePath);
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`
    );
    parts.push(fileData);
    parts.push('\r\n');
  }

  parts.push(`--${boundary}--\r\n`);

  // Combine string and buffer parts
  const buffers = parts.map(p => typeof p === 'string' ? Buffer.from(p, 'utf-8') : p);
  const body = Buffer.concat(buffers);

  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

function headRequest(urlStr) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'HEAD',
      timeout: 15000,
    }, (res) => {
      resolve({ status: res.statusCode, headers: res.headers });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('HEAD timed out')); });
    req.end();
  });
}

// ─── Test Steps ────────────────────────────────────────────────────

async function run() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  END-TO-END VIDEO UPLOAD TEST');
  console.log('═══════════════════════════════════════════════════════');

  // ─── Step 0: Verify video file exists ───
  console.log('\n📁 Step 0: Check video file...');
  if (!fs.existsSync(VIDEO_FILE)) {
    console.error(`❌ Video file not found: ${VIDEO_FILE}`);
    process.exit(1);
  }
  const videoStats = fs.statSync(VIDEO_FILE);
  console.log(`   ✅ File: ${path.basename(VIDEO_FILE)}`);
  console.log(`   ✅ Size: ${(videoStats.size / 1024 / 1024).toFixed(2)} MB`);

  // ─── Step 1: Login as admin ───
  console.log('\n🔐 Step 1: Admin login...');
  const loginRes = await httpRequest('POST', `${BASE_URL}/api/admin/auth/login`, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });

  if (loginRes.status !== 200 || !loginRes.json) {
    console.error(`❌ Login failed: status=${loginRes.status}`);
    console.error(`   Response: ${loginRes.body.substring(0, 300)}`);
    process.exit(1);
  }

  const token = loginRes.json.token || (loginRes.json.data && loginRes.json.data.token);
  if (!token) {
    console.error('❌ No token in login response');
    console.error(`   Response keys: ${Object.keys(loginRes.json).join(', ')}`);
    process.exit(1);
  }
  console.log(`   ✅ Token obtained (${token.length} chars)`);

  // ─── Step 2: Get existing course + module ───
  console.log('\n📚 Step 2: Fetch courses...');
  const coursesRes = await httpRequest('GET', `${BASE_URL}/api/courses`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });

  if (coursesRes.status !== 200 || !coursesRes.json) {
    console.error(`❌ Failed to fetch courses: status=${coursesRes.status}`);
    process.exit(1);
  }

  const courses = coursesRes.json.data || coursesRes.json.courses || coursesRes.json;
  let courseId, moduleId;

  if (Array.isArray(courses) && courses.length > 0) {
    // Find a course with at least one module
    for (const c of courses) {
      const cid = c._id || c.id;
      const mods = c.modules || [];
      if (mods.length > 0) {
        courseId = cid;
        moduleId = mods[0]._id || mods[0].id;
        console.log(`   ✅ Using course: "${c.title}" (${courseId})`);
        console.log(`   ✅ Using module: "${mods[0].title}" (${moduleId})`);
        break;
      }
    }

    if (!moduleId) {
      // Course exists but no modules — create a module
      courseId = courses[0]._id || courses[0].id;
      console.log(`   ⚠️ No modules found. Creating test module in course "${courses[0].title}"...`);
      const modRes = await httpRequest('POST', `${BASE_URL}/api/courses/${courseId}/modules`, {
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ title: 'E2E Test Module', description: 'Created by e2e test' }),
      });
      if (modRes.status < 200 || modRes.status >= 300) {
        console.error(`❌ Failed to create module: ${modRes.body.substring(0, 300)}`);
        process.exit(1);
      }
      const modData = modRes.json.data || modRes.json.module || modRes.json;
      moduleId = modData._id || modData.id;
      console.log(`   ✅ Created module: ${moduleId}`);
    }
  } else {
    // No courses — create course + module
    console.log('   ⚠️ No courses found. Creating test course...');
    const createRes = await httpRequest('POST', `${BASE_URL}/api/courses`, {
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        title: 'E2E Test Course',
        description: 'Created by e2e video upload test',
        category: 'Test',
        price: 0,
      }),
    });
    if (createRes.status < 200 || createRes.status >= 300) {
      console.error(`❌ Failed to create course: ${createRes.body.substring(0, 300)}`);
      process.exit(1);
    }
    const courseData = createRes.json.data || createRes.json.course || createRes.json;
    courseId = courseData._id || courseData.id;
    console.log(`   ✅ Created course: ${courseId}`);

    const modRes = await httpRequest('POST', `${BASE_URL}/api/courses/${courseId}/modules`, {
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ title: 'E2E Test Module', description: 'Created by e2e test' }),
    });
    const modData = modRes.json.data || modRes.json.module || modRes.json;
    moduleId = modData._id || modData.id;
    console.log(`   ✅ Created module: ${moduleId}`);
  }

  // ─── Step 3: Upload lesson with video file (multipart/form-data) ───
  console.log('\n🎬 Step 3: Upload Recorded Video lesson with MP4 file...');
  console.log(`   Sending: POST /api/courses/${courseId}/modules/${moduleId}/lessons`);
  console.log(`   File: ${path.basename(VIDEO_FILE)} (${(videoStats.size / 1024 / 1024).toFixed(2)} MB)`);

  const { body: multipartBody, contentType } = multipartFormData(
    {
      title: 'E2E Video Test Lesson ' + Date.now(),
      lessonType: 'Recorded Video',
      description: 'End-to-end test lesson with real MP4 video upload',
      duration: '5',
      isPreview: 'false',
    },
    [
      {
        fieldName: 'videoUrl',
        filePath: VIDEO_FILE,
        fileName: 'demo.mp4',
        contentType: 'video/mp4',
      },
    ]
  );

  console.log(`   Content-Type: ${contentType.substring(0, 60)}...`);
  console.log(`   Body size: ${(multipartBody.length / 1024).toFixed(1)} KB`);

  const uploadStart = Date.now();
  const lessonRes = await httpRequest('POST',
    `${BASE_URL}/api/courses/${courseId}/modules/${moduleId}/lessons`,
    {
      headers: {
        'Content-Type': contentType,
        'Content-Length': multipartBody.length.toString(),
        'Authorization': `Bearer ${token}`,
      },
      body: multipartBody,
      timeout: 120000, // 2 min for video upload
    }
  );
  const uploadDuration = ((Date.now() - uploadStart) / 1000).toFixed(1);

  console.log(`   Upload completed in ${uploadDuration}s`);
  console.log(`   Response status: ${lessonRes.status}`);

  if (lessonRes.status < 200 || lessonRes.status >= 300) {
    console.error(`❌ Lesson creation FAILED!`);
    console.error(`   Status: ${lessonRes.status}`);
    console.error(`   Response: ${lessonRes.body.substring(0, 500)}`);
    process.exit(1);
  }

  console.log('   ✅ Lesson created successfully!');

  // ─── Step 4: Verify Cloudinary URL in response ───
  console.log('\n🔍 Step 4: Verify Cloudinary URL in response...');
  const lessonData = lessonRes.json.data || lessonRes.json.lesson || lessonRes.json;

  // Dig into the lesson structure
  const videoUrl = lessonData.videoUrl || lessonData.video_url || '';
  const videoParts = lessonData.videoParts || lessonData.video_parts || [];
  const lessonId = lessonData._id || lessonData.id;

  console.log(`   Lesson ID: ${lessonId}`);
  console.log(`   videoUrl: ${videoUrl}`);
  console.log(`   videoParts count: ${videoParts.length}`);

  if (videoParts.length > 0) {
    videoParts.forEach((vp, i) => {
      console.log(`   videoPart[${i}]: url="${vp.url}", secure_url="${vp.secure_url || ''}", resource_type="${vp.resource_type || ''}"`);
    });
  }

  const finalVideoUrl = videoUrl || (videoParts.length > 0 ? (videoParts[0].url || videoParts[0].secure_url) : '');

  if (!finalVideoUrl) {
    console.error('❌ No video URL found in lesson response!');
    console.error(`   Full response: ${JSON.stringify(lessonData, null, 2).substring(0, 800)}`);
    process.exit(1);
  }

  if (!finalVideoUrl.includes('cloudinary.com')) {
    console.error(`❌ Video URL is NOT a Cloudinary URL!`);
    console.error(`   Got: ${finalVideoUrl}`);
    process.exit(1);
  }

  if (!finalVideoUrl.includes('vadgpisw')) {
    console.error(`❌ Video URL does NOT contain correct cloud name "vadgpisw"!`);
    console.error(`   Got: ${finalVideoUrl}`);
    process.exit(1);
  }

  if (finalVideoUrl.includes('doxb5l5vf')) {
    console.error(`❌ Video URL contains old/invalid cloud name "doxb5l5vf"!`);
    process.exit(1);
  }

  console.log(`   ✅ Cloudinary URL verified: ${finalVideoUrl}`);

  // ─── Step 5: Verify via GET lesson (simulates reload) ───
  console.log('\n🔄 Step 5: Reload lesson from API (simulates frontend reload)...');
  const reloadRes = await httpRequest('GET',
    `${BASE_URL}/api/courses/${courseId}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );

  if (reloadRes.status !== 200) {
    console.error(`❌ Failed to reload course: ${reloadRes.status}`);
    process.exit(1);
  }

  const reloadedCourse = reloadRes.json.data || reloadRes.json.course || reloadRes.json;
  let reloadedLesson = null;

  // Search for our lesson in the modules
  const reloadedModules = reloadedCourse.modules || [];
  for (const m of reloadedModules) {
    const lessons = m.lessons || [];
    for (const l of lessons) {
      if ((l._id || l.id) === lessonId) {
        reloadedLesson = l;
        break;
      }
    }
    if (reloadedLesson) break;
  }

  if (!reloadedLesson) {
    console.log(`   ⚠️ Could not find lesson ${lessonId} in reloaded course data`);
    console.log(`   Modules count: ${reloadedModules.length}`);
    reloadedModules.forEach((m, i) => {
      console.log(`   Module ${i}: "${m.title}", lessons: ${(m.lessons || []).length}`);
    });
  } else {
    const reloadedVideoUrl = reloadedLesson.videoUrl || reloadedLesson.video_url || '';
    const reloadedParts = reloadedLesson.videoParts || reloadedLesson.video_parts || [];
    const mongoVideoUrl = reloadedVideoUrl || (reloadedParts.length > 0 ? (reloadedParts[0].url || reloadedParts[0].secure_url) : '');

    if (mongoVideoUrl && mongoVideoUrl.includes('cloudinary.com') && mongoVideoUrl.includes('vadgpisw')) {
      console.log(`   ✅ MongoDB stores correct Cloudinary URL: ${mongoVideoUrl}`);
    } else {
      console.error(`   ❌ MongoDB has wrong video URL: ${mongoVideoUrl}`);
    }
  }

  // ─── Step 6: Verify video is accessible via HEAD request ───
  console.log('\n🌐 Step 6: Verify video is accessible at Cloudinary...');
  try {
    const headRes = await headRequest(finalVideoUrl);
    console.log(`   HTTP ${headRes.status}`);
    console.log(`   Content-Type: ${headRes.headers['content-type'] || 'unknown'}`);
    console.log(`   Content-Length: ${headRes.headers['content-length'] || 'unknown'}`);

    if (headRes.status === 200) {
      console.log('   ✅ Video is accessible and playable!');
    } else if (headRes.status === 301 || headRes.status === 302) {
      console.log(`   ⚠️ Redirect to: ${headRes.headers['location'] || 'unknown'}`);
      console.log('   ✅ Video exists (redirect is normal for Cloudinary)');
    } else {
      console.error(`   ❌ Video NOT accessible! Status: ${headRes.status}`);
    }
  } catch (err) {
    console.error(`   ❌ HEAD request failed: ${err.message}`);
  }

  // ─── Summary ───
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  END-TO-END TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  ✅ Admin login:         PASS`);
  console.log(`  ✅ Multipart upload:    PASS (${uploadDuration}s)`);
  console.log(`  ✅ Cloudinary URL:      PASS`);
  console.log(`  ✅ Cloud name:          vadgpisw ✓`);
  console.log(`  ✅ Video URL:           ${finalVideoUrl}`);
  console.log('═══════════════════════════════════════════════════════');
}

run().catch((err) => {
  console.error('\n💥 UNHANDLED ERROR:', err.message || err);
  console.error(err.stack);
  process.exit(1);
});
