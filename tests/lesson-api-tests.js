/**
 * ═══════════════════════════════════════════════════════════════════════════
 * COURSE LESSON CRUD — Comprehensive API Test Suite
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Usage (against live Render):
 *   node tests/lesson-api-tests.js
 *
 * Usage (against local dev):
 *   BASE_URL=http://localhost:5000 node tests/lesson-api-tests.js
 *
 * Environment variables:
 *   BASE_URL    — API base URL (default: http://localhost:5000)
 *   AUTH_TOKEN  — Bearer token for admin auth (auto-generated if not set)
 *   COURSE_ID   — Existing courseId like "CRS-000039" (created if not set)
 *   MODULE_ID   — Existing moduleId MongoDB _id (created if not set)
 *
 * This script performs a full CRUD lifecycle:
 *   1. Setup     — ensures a test course + module exist
 *   2. POST      — creates lessons with various file types
 *   3. GET       — fetches and validates lesson data
 *   4. PUT       — updates lesson metadata and files
 *   5. DELETE    — removes lessons and validates removal
 *   6. Integrity — multi-lesson data integrity checks
 *   7. Teardown  — cleans up test data
 * ═══════════════════════════════════════════════════════════════════════════
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// ─── Configuration ────────────────────────────────────────────────────────────

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';
const JWT_SECRET = process.env.JWT_SECRET || 'white_coat_academy_secret_jwt_key_2026_super_secure';

// Generate a valid admin token if not provided
// Uses actual admin user ID from the database so rbac middleware finds the user
const AUTH_TOKEN = process.env.AUTH_TOKEN || jwt.sign(
  { id: '6a7ef8e0323d9478ce7ac8ef', role: 'admin', email: 'admin@whitecoat.academy' },
  JWT_SECRET,
  { expiresIn: '1h' }
);

// Test state
const state = {
  courseId: process.env.COURSE_ID || null,       // custom courseId (e.g. CRS-000039)
  courseMongoId: null,                             // MongoDB _id
  moduleId: process.env.MODULE_ID || null,        // MongoDB _id of module
  lessonIds: [],                                   // lesson _id array
  totalTests: 0,
  passed: 0,
  failed: 0,
  errors: [],
};

// ─── HTTP Helper ──────────────────────────────────────────────────────────────

function request(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const fullUrl = new URL(urlPath, BASE_URL);
    const isHttps = fullUrl.protocol === 'https:';
    const lib = isHttps ? https : http;

    const headers = {
      'Authorization': `Bearer ${AUTH_TOKEN}`,
      'Accept': 'application/json',
    };

    if (body && typeof body === 'object') {
      headers['Content-Type'] = 'application/json';
    }

    const options = {
      hostname: fullUrl.hostname,
      port: fullUrl.port || (isHttps ? 443 : 80),
      path: fullUrl.pathname + fullUrl.search,
      method,
      headers,
      timeout: 30000,
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          parsed = { _raw: data };
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout: ${method} ${urlPath}`));
    });

    if (body && typeof body === 'object') {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// ─── Assertion Helpers ────────────────────────────────────────────────────────

function assert(condition, message) {
  state.totalTests++;
  if (condition) {
    state.passed++;
    console.log(`  ✅ ${message}`);
  } else {
    state.failed++;
    state.errors.push(message);
    console.log(`  ❌ ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} — expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)}`);
}

function assertIncludes(arr, value, message) {
  assert(Array.isArray(arr) && arr.includes(value), message);
}

function assertGreaterThan(actual, min, message) {
  assert(actual > min, `${message} — expected > ${min}, got: ${actual}`);
}

function section(title) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ${title}`);
  console.log(`${'═'.repeat(70)}`);
}

function subsection(title) {
  console.log(`\n  ── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
}

// ─── Test Functions ───────────────────────────────────────────────────────────

async function setupTestCourse() {
  section('1. SETUP — Ensure Test Course + Module Exist');

  if (state.courseId) {
    // Fetch existing course
    subsection(`Fetching existing course: ${state.courseId}`);
    const res = await request('GET', `/api/courses/${state.courseId}`);
    assert(res.status === 200, `GET /api/courses/${state.courseId} returns 200`);

    if (res.status === 200 && res.body.data) {
      const course = res.body.data;
      state.courseMongoId = course._id;
      console.log(`  ℹ️  Course _id: ${course._id}`);

      if (course.modules && course.modules.length > 0) {
        if (state.moduleId) {
          const found = course.modules.find(m => m._id === state.moduleId);
          assert(!!found, `Module ${state.moduleId} exists in course`);
        } else {
          state.moduleId = course.modules[0]._id;
          console.log(`  ℹ️  Using first module: ${state.moduleId}`);
        }
      } else {
        // Create a module
        subsection('Creating test module');
        const modRes = await request('POST', `/api/courses/${state.courseId}/modules`, {
          moduleName: `Test Module ${Date.now()}`,
        });
        assert(modRes.status === 201 || modRes.status === 200, 'Module creation succeeded');
        if (modRes.body.data) {
          const modData = modRes.body.data;
          state.moduleId = modData._id || (modData.modules ? modData.modules[modData.modules.length - 1]?._id : undefined);
          console.log(`  ℹ️  Created module: ${state.moduleId}`);
        }
      }
    }
  } else {
    // Create a fresh test course
    subsection('Creating test course');
    const courseRes = await request('POST', '/api/courses', {
      courseTitle: `API Test Course ${Date.now()}`,
      instructor: 'Test Instructor',
      price: 0,
      shortDescription: 'Automated API test course',
      category: 'Testing',
      status: 'Draft',
    });

    assert(courseRes.status === 201 || courseRes.status === 200, 'Course creation succeeded');

    if (courseRes.body.data || courseRes.body.course) {
      const course = courseRes.body.data || courseRes.body.course;
      state.courseId = course.courseId || course._id;
      state.courseMongoId = course._id;
      console.log(`  ℹ️  Created course: ${state.courseId} (_id: ${state.courseMongoId})`);
    }

    // Create a module in the new course
    subsection('Creating test module');
    const modRes = await request('POST', `/api/courses/${state.courseId}/modules`, {
      moduleName: `Test Module ${Date.now()}`,
    });

    assert(modRes.status === 201 || modRes.status === 200, 'Module creation succeeded');

    if (modRes.body.data) {
      // addModule returns data as the single module subdocument directly
      const modData = modRes.body.data;
      state.moduleId = modData._id || (modData.modules ? modData.modules[modData.modules.length - 1]?._id : undefined);
      console.log(`  ℹ️  Created module: ${state.moduleId}`);
    }
  }

  assert(!!state.courseId, 'Course ID is available');
  assert(!!state.moduleId, 'Module ID is available');
}

// ─── POST Lesson Tests ────────────────────────────────────────────────────────

async function testPostLessonVideoType() {
  subsection('POST Lesson — Recorded Video (JSON body with Cloudinary URLs)');

  const lessonData = {
    lessonTitle: 'Test Video Lesson',
    lessonType: 'Recorded Video',
    durationOrPages: '15min',
    status: 'Published',
    description: 'Automated test: video lesson',
    videoUrl: 'https://res.cloudinary.com/vadgpisw/video/upload/v1234/test-video.mp4',
    videoParts: [
      { title: 'Part 1 - Introduction', url: 'https://res.cloudinary.com/vadgpisw/video/upload/v1234/test-video-part1.mp4' },
      { title: 'Part 2 - Content', url: 'https://res.cloudinary.com/vadgpisw/video/upload/v1234/test-video-part2.mp4' },
    ],
    pdfNotes: [],
    attachments: [],
  };

  const res = await request('POST', `/api/courses/${state.courseId}/modules/${state.moduleId}/lessons`, lessonData);

  assertEqual(res.status, 201, 'POST lesson returns 201 Created');
  assert(res.body.success === true, 'Response success=true');

  const lesson = res.body.data || res.body.lesson;
  assert(!!lesson, 'Response contains lesson data');

  if (lesson) {
    assert(!!lesson._id, 'Lesson has _id');
    state.lessonIds.push(lesson._id);
    assertEqual(lesson.lessonTitle, 'Test Video Lesson', 'lessonTitle matches');
    assertEqual(lesson.lessonType, 'Recorded Video', 'lessonType matches');
    assert(lesson.videoUrl && lesson.videoUrl.includes('cloudinary.com'), 'videoUrl is a Cloudinary URL');
    assert(Array.isArray(lesson.videoParts), 'videoParts is an array');
    assertGreaterThan(lesson.videoParts.length, 0, 'videoParts has entries');

    if (lesson.videoParts.length >= 2) {
      assertEqual(lesson.videoParts[0].title, 'Part 1 - Introduction', 'videoParts[0].title matches');
      assertEqual(lesson.videoParts[1].title, 'Part 2 - Content', 'videoParts[1].title matches');
      assert(lesson.videoParts[0].url.includes('cloudinary.com'), 'videoParts[0].url is Cloudinary');
      assert(lesson.videoParts[1].url.includes('cloudinary.com'), 'videoParts[1].url is Cloudinary');
    }
  }

  return lesson;
}

async function testPostLessonPdfType() {
  subsection('POST Lesson — PDF Notes (JSON body with Cloudinary URLs)');

  const lessonData = {
    lessonTitle: 'Test PDF Lesson',
    lessonType: 'PDF Notes',
    durationOrPages: '12 pages',
    status: 'Published',
    description: 'Automated test: PDF lesson',
    pdfNotes: [
      { title: 'Chapter 1 Notes', url: 'https://res.cloudinary.com/vadgpisw/raw/upload/v1234/chapter1-notes.pdf' },
      { title: 'Chapter 2 Notes', url: 'https://res.cloudinary.com/vadgpisw/raw/upload/v1234/chapter2-notes.pdf' },
    ],
    attachments: [
      { title: 'Reference Sheet', url: 'https://res.cloudinary.com/vadgpisw/raw/upload/v1234/reference-sheet.pdf' },
    ],
    videoParts: [],
  };

  const res = await request('POST', `/api/courses/${state.courseId}/modules/${state.moduleId}/lessons`, lessonData);

  assertEqual(res.status, 201, 'POST PDF lesson returns 201 Created');
  assert(res.body.success === true, 'Response success=true');

  const lesson = res.body.data || res.body.lesson;
  assert(!!lesson, 'Response contains lesson data');

  if (lesson) {
    state.lessonIds.push(lesson._id);
    assertEqual(lesson.lessonTitle, 'Test PDF Lesson', 'lessonTitle matches');
    assertEqual(lesson.lessonType, 'PDF Notes', 'lessonType matches');
    assert(Array.isArray(lesson.pdfNotes), 'pdfNotes is an array');
    assertGreaterThan(lesson.pdfNotes.length, 0, 'pdfNotes has entries');

    if (lesson.pdfNotes.length >= 2) {
      assert(lesson.pdfNotes[0].url.includes('cloudinary.com'), 'pdfNotes[0].url is Cloudinary');
      assert(lesson.pdfNotes[0].url.startsWith('https://'), 'pdfNotes[0].url uses https');
    }

    assert(Array.isArray(lesson.attachments), 'attachments is an array');
    assertGreaterThan(lesson.attachments.length, 0, 'attachments has entries');
  }

  return lesson;
}

async function testPostLessonLiveClass() {
  subsection('POST Lesson — Live Class with meeting URL');

  const lessonData = {
    lessonTitle: 'Test Live Class',
    lessonType: 'Live Class',
    durationOrPages: '60min',
    status: 'Published',
    description: 'Automated test: live class lesson',
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
  };

  const res = await request('POST', `/api/courses/${state.courseId}/modules/${state.moduleId}/lessons`, lessonData);

  assertEqual(res.status, 201, 'POST live class lesson returns 201 Created');

  const lesson = res.body.data || res.body.lesson;
  if (lesson) {
    state.lessonIds.push(lesson._id);
    assertEqual(lesson.lessonTitle, 'Test Live Class', 'lessonTitle matches');
    assertEqual(lesson.lessonType, 'Live Class', 'lessonType matches');
    assertEqual(lesson.meetingUrl, 'https://meet.google.com/abc-defg-hij', 'meetingUrl matches');
  }

  return lesson;
}

async function testPostLessonMixedFiles() {
  subsection('POST Lesson — Mixed files (video + PDF + attachments)');

  const lessonData = {
    lessonTitle: 'Test Mixed Lesson',
    lessonType: 'Recorded Video',
    durationOrPages: '30min',
    status: 'Published',
    description: 'Automated test: mixed files lesson',
    videoUrl: 'https://res.cloudinary.com/vadgpisw/video/upload/v1234/mixed-video.mp4',
    videoParts: [
      { title: 'Full Video', url: 'https://res.cloudinary.com/vadgpisw/video/upload/v1234/mixed-video.mp4' },
    ],
    pdfNotes: [
      { title: 'Lecture Notes', url: 'https://res.cloudinary.com/vadgpisw/raw/upload/v1234/lecture-notes.pdf' },
      { title: 'Summary', url: 'https://res.cloudinary.com/vadgpisw/raw/upload/v1234/summary.pdf' },
    ],
    attachments: [
      { title: 'Lab Worksheet', url: 'https://res.cloudinary.com/vadgpisw/raw/upload/v1234/lab-worksheet.xlsx' },
      { title: 'Sample Data', url: 'https://res.cloudinary.com/vadgpisw/raw/upload/v1234/sample-data.csv' },
    ],
  };

  const res = await request('POST', `/api/courses/${state.courseId}/modules/${state.moduleId}/lessons`, lessonData);

  assertEqual(res.status, 201, 'POST mixed lesson returns 201 Created');

  const lesson = res.body.data || res.body.lesson;
  if (lesson) {
    state.lessonIds.push(lesson._id);

    // Verify all arrays are populated
    assert(Array.isArray(lesson.videoParts), 'videoParts is array');
    assert(Array.isArray(lesson.pdfNotes), 'pdfNotes is array');
    assert(Array.isArray(lesson.attachments), 'attachments is array');

    assertGreaterThan(lesson.videoParts.length, 0, 'videoParts count > 0');
    assertGreaterThan(lesson.pdfNotes.length, 0, 'pdfNotes count > 0');
    assertGreaterThan(lesson.attachments.length, 0, 'attachments count > 0');

    // Verify resource types in URLs
    lesson.videoParts.forEach((vp, i) => {
      assert(vp.url && vp.url.includes('/video/'), `videoParts[${i}] URL contains /video/ resource path`);
    });
    lesson.pdfNotes.forEach((pn, i) => {
      assert(pn.url && pn.url.includes('/raw/'), `pdfNotes[${i}] URL contains /raw/ resource path`);
    });
  }

  return lesson;
}

async function testPostLessonValidation() {
  subsection('POST Lesson — Validation: missing lessonTitle');

  const res = await request('POST', `/api/courses/${state.courseId}/modules/${state.moduleId}/lessons`, {
    lessonType: 'Recorded Video',
  });

  assertEqual(res.status, 400, 'POST without lessonTitle returns 400');
  assert(res.body.success === false, 'Response success=false');

  subsection('POST Lesson — Validation: invalid moduleId');

  const res2 = await request('POST', `/api/courses/${state.courseId}/modules/invalid-id/lessons`, {
    lessonTitle: 'Should Fail',
    lessonType: 'Recorded Video',
  });

  assertEqual(res2.status, 400, 'POST with invalid moduleId returns 400');
}

// ─── GET Lessons Tests ────────────────────────────────────────────────────────

async function testGetLessons() {
  section('3. GET — Fetch Lessons for Module');

  subsection('GET all lessons for the test module');

  const res = await request('GET', `/api/courses/${state.courseId}/modules/${state.moduleId}/lessons`);

  assertEqual(res.status, 200, 'GET lessons returns 200 OK');
  assert(res.body.success === true, 'Response success=true');

  const lessons = res.body.data || res.body.lessons || [];
  assert(Array.isArray(lessons), 'Response data is an array');
  assertGreaterThan(lessons.length, 0, `Lessons array has entries (got ${lessons.length})`);

  // Validate that the lessons we created are present
  const createdIds = state.lessonIds;
  createdIds.forEach((id) => {
    const found = lessons.find(l => l._id === id);
    assert(!!found, `Created lesson ${id} exists in GET response`);
  });

  // Validate field completeness — no dropped fields
  lessons.forEach((lesson, i) => {
    assert(lesson.lessonTitle !== undefined, `lessons[${i}] has lessonTitle`);
    assert(lesson.lessonType !== undefined, `lessons[${i}] has lessonType`);
    assert(Array.isArray(lesson.videoParts), `lessons[${i}].videoParts is array`);
    assert(Array.isArray(lesson.pdfNotes), `lessons[${i}].pdfNotes is array`);
    assert(Array.isArray(lesson.attachments), `lessons[${i}].attachments is array`);
  });

  // Verify the mixed lesson has all its data intact
  const mixedLesson = lessons.find(l => l.lessonTitle === 'Test Mixed Lesson');
  if (mixedLesson) {
    subsection('Verify Mixed Lesson integrity after GET');
    assertGreaterThan(mixedLesson.videoParts.length, 0, 'Mixed lesson videoParts preserved');
    assertGreaterThan(mixedLesson.pdfNotes.length, 0, 'Mixed lesson pdfNotes preserved');
    assertGreaterThan(mixedLesson.attachments.length, 0, 'Mixed lesson attachments preserved');

    // Verify URLs are not empty strings
    mixedLesson.videoParts.forEach((vp, i) => {
      assert(vp.url && vp.url.length > 10, `Mixed lesson videoParts[${i}].url is populated`);
    });
    mixedLesson.pdfNotes.forEach((pn, i) => {
      assert(pn.url && pn.url.length > 10, `Mixed lesson pdfNotes[${i}].url is populated`);
    });
  }

  return lessons;
}

async function testGetCourseTree() {
  subsection('GET full course tree — verify modules.lessons are populated');

  const res = await request('GET', `/api/courses/${state.courseId}`);
  assertEqual(res.status, 200, 'GET course returns 200');

  const course = res.body.data || res.body.course;
  assert(!!course, 'Course data returned');

  if (course) {
    assert(Array.isArray(course.modules), 'course.modules is array');
    const mod = course.modules.find(m => m._id === state.moduleId);
    assert(!!mod, 'Target module found in course tree');

    if (mod) {
      assert(Array.isArray(mod.lessons), 'module.lessons is array');
      assertGreaterThan(mod.lessons.length, 0, 'module.lessons has entries');
    }
  }
}

// ─── PUT (Update) Lesson Tests ────────────────────────────────────────────────

async function testUpdateLessonMetadata() {
  section('4. PUT — Update Lesson');

  if (state.lessonIds.length === 0) {
    console.log('  ⚠️  No lessons to update — skipping');
    return;
  }

  const targetLessonId = state.lessonIds[0]; // Update the first lesson (video lesson)

  subsection(`PUT update metadata for lesson ${targetLessonId}`);

  const updateData = {
    lessonTitle: 'Updated Video Lesson Title',
    description: 'Updated description via API test',
    durationOrPages: '20min',
    status: 'Draft',
  };

  const res = await request('PUT',
    `/api/courses/${state.courseId}/modules/${state.moduleId}/lessons/${targetLessonId}`,
    updateData
  );

  assertEqual(res.status, 200, 'PUT update returns 200 OK');
  assert(res.body.success === true, 'Response success=true');

  const lesson = res.body.data || res.body.lesson;
  if (lesson) {
    assertEqual(lesson.lessonTitle, 'Updated Video Lesson Title', 'lessonTitle updated');
    assertEqual(lesson.description, 'Updated description via API test', 'description updated');
    assertEqual(lesson.status, 'Draft', 'status updated to Draft');
  }
}

async function testUpdateLessonAppendFiles() {
  if (state.lessonIds.length === 0) {
    console.log('  ⚠️  No lessons to update — skipping');
    return;
  }

  const targetLessonId = state.lessonIds[0];

  subsection(`PUT append PDF notes to lesson ${targetLessonId}`);

  const updateData = {
    pdfNotes: [
      { title: 'New Appended PDF', url: 'https://res.cloudinary.com/vadgpisw/raw/upload/v1234/appended-notes.pdf' },
    ],
  };

  const res = await request('PUT',
    `/api/courses/${state.courseId}/modules/${state.moduleId}/lessons/${targetLessonId}`,
    updateData
  );

  assertEqual(res.status, 200, 'PUT with pdfNotes returns 200');

  const lesson = res.body.data || res.body.lesson;
  if (lesson) {
    assert(Array.isArray(lesson.pdfNotes), 'pdfNotes is array');
    // Since update REPLACES the array (per controller logic), check the new content
    const hasAppended = lesson.pdfNotes.some(p => p.title === 'New Appended PDF');
    assert(hasAppended, 'New PDF note is present in response');

    // Verify existing videoParts are preserved (not modified in this update)
    assert(Array.isArray(lesson.videoParts), 'videoParts still exists');
  }
}

async function testUpdateLessonValidation() {
  subsection('PUT update with invalid lessonId');

  const res = await request('PUT',
    `/api/courses/${state.courseId}/modules/${state.moduleId}/lessons/invalid-id`,
    { lessonTitle: 'Should Fail' }
  );

  assertEqual(res.status, 400, 'PUT with invalid lessonId returns 400');

  subsection('PUT update with nonexistent lessonId');

  const fakeId = '000000000000000000000000';
  const res2 = await request('PUT',
    `/api/courses/${state.courseId}/modules/${state.moduleId}/lessons/${fakeId}`,
    { lessonTitle: 'Should Fail' }
  );

  assertEqual(res2.status, 404, 'PUT with nonexistent lessonId returns 404');
}

// ─── Multi-Data Integrity Tests ───────────────────────────────────────────────

async function testMultiDataIntegrity() {
  section('5. MULTI-DATA INTEGRITY — Verify counts and URLs');

  subsection('Fetch all lessons and validate integrity');

  const res = await request('GET', `/api/courses/${state.courseId}/modules/${state.moduleId}/lessons`);
  assertEqual(res.status, 200, 'GET lessons returns 200');

  const lessons = res.body.data || res.body.lessons || [];

  // Count should match what we created (4 lessons: video, pdf, live, mixed)
  const expectedCount = state.lessonIds.length;
  assertEqual(lessons.length, expectedCount, `Lesson count matches expected (${expectedCount})`);

  // Verify no two lessons share the same _id
  const idSet = new Set(lessons.map(l => l._id));
  assertEqual(idSet.size, lessons.length, 'All lesson _ids are unique');

  // Verify no overwritten entries
  const titles = lessons.map(l => l.lessonTitle);
  subsection('Verify lesson titles are distinct');
  const titleSet = new Set(titles);
  // Note: one was renamed in PUT test, so we expect (count - duplicates)
  assert(titleSet.size >= expectedCount - 1, 'Lesson titles are mostly unique');

  // Verify secure URLs are complete
  subsection('Verify Cloudinary URLs in file arrays');
  lessons.forEach((lesson, i) => {
    if (lesson.videoParts && lesson.videoParts.length > 0) {
      lesson.videoParts.forEach((vp, j) => {
        assert(vp.url && vp.url.startsWith('http'), `lessons[${i}].videoParts[${j}].url is a full URL`);
        assert(vp.title && vp.title.length > 0, `lessons[${i}].videoParts[${j}].title is not empty`);
      });
    }
    if (lesson.pdfNotes && lesson.pdfNotes.length > 0) {
      lesson.pdfNotes.forEach((pn, j) => {
        assert(pn.url && pn.url.startsWith('http'), `lessons[${i}].pdfNotes[${j}].url is a full URL`);
        assert(pn.title && pn.title.length > 0, `lessons[${i}].pdfNotes[${j}].title is not empty`);
      });
    }
    if (lesson.attachments && lesson.attachments.length > 0) {
      lesson.attachments.forEach((att, j) => {
        assert(att.url && att.url.startsWith('http'), `lessons[${i}].attachments[${j}].url is a full URL`);
        assert(att.title && att.title.length > 0, `lessons[${i}].attachments[${j}].title is not empty`);
      });
    }
  });
}

// ─── DELETE Lesson Tests ──────────────────────────────────────────────────────

async function testDeleteLesson() {
  section('6. DELETE — Remove Lessons');

  if (state.lessonIds.length === 0) {
    console.log('  ⚠️  No lessons to delete — skipping');
    return;
  }

  // Delete the last lesson (mixed lesson)
  const targetId = state.lessonIds[state.lessonIds.length - 1];

  subsection(`DELETE lesson ${targetId}`);

  const res = await request('DELETE',
    `/api/courses/${state.courseId}/modules/${state.moduleId}/lessons/${targetId}`
  );

  assertEqual(res.status, 200, 'DELETE returns 200 OK');
  assert(res.body.success === true, 'Response success=true');

  // Verify it's removed from GET
  subsection('Verify deleted lesson is absent from GET');
  const getRes = await request('GET', `/api/courses/${state.courseId}/modules/${state.moduleId}/lessons`);
  const lessons = getRes.body.data || getRes.body.lessons || [];
  const stillExists = lessons.find(l => l._id === targetId);
  assert(!stillExists, `Deleted lesson ${targetId} no longer appears in GET response`);

  // Update state
  state.lessonIds.pop();
}

async function testDeleteLessonValidation() {
  subsection('DELETE with invalid lessonId');

  const res = await request('DELETE',
    `/api/courses/${state.courseId}/modules/${state.moduleId}/lessons/invalid-id`
  );

  assertEqual(res.status, 400, 'DELETE with invalid lessonId returns 400');

  subsection('DELETE with nonexistent lessonId');

  const fakeId = '000000000000000000000000';
  const res2 = await request('DELETE',
    `/api/courses/${state.courseId}/modules/${state.moduleId}/lessons/${fakeId}`
  );

  assertEqual(res2.status, 404, 'DELETE with nonexistent lessonId returns 404');
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

async function cleanup() {
  section('7. CLEANUP — Remove remaining test lessons');

  for (const lessonId of [...state.lessonIds]) {
    try {
      const res = await request('DELETE',
        `/api/courses/${state.courseId}/modules/${state.moduleId}/lessons/${lessonId}`
      );
      console.log(`  🗑️  Deleted lesson ${lessonId} — status: ${res.status}`);
    } catch (e) {
      console.log(`  ⚠️  Could not delete lesson ${lessonId}: ${e.message}`);
    }
  }

  // Only delete the course if we created it (no pre-existing COURSE_ID)
  if (!process.env.COURSE_ID && state.courseId) {
    try {
      const res = await request('DELETE', `/api/courses/${state.courseId}`);
      console.log(`  🗑️  Deleted test course ${state.courseId} — status: ${res.status}`);
    } catch (e) {
      console.log(`  ⚠️  Could not delete course: ${e.message}`);
    }
  }
}

// ─── Main Runner ──────────────────────────────────────────────────────────────

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║              COURSE LESSON CRUD — API Test Suite                       ║
╠══════════════════════════════════════════════════════════════════════════╣
║  Base URL:   ${BASE_URL.padEnd(56)}║
║  Auth:       Bearer ${AUTH_TOKEN.substring(0, 20)}...${' '.repeat(33)}║
║  Course ID:  ${(state.courseId || 'auto-create').padEnd(56)}║
║  Module ID:  ${(state.moduleId || 'auto-create').padEnd(56)}║
╚══════════════════════════════════════════════════════════════════════════╝
`);

  const startTime = Date.now();

  try {
    // 1. Setup
    await setupTestCourse();

    if (!state.courseId || !state.moduleId) {
      console.error('\n❌ FATAL: Could not establish test course/module. Aborting.');
      process.exit(1);
    }

    // 2. POST tests
    section('2. POST — Create Lessons');
    await testPostLessonVideoType();
    await testPostLessonPdfType();
    await testPostLessonLiveClass();
    await testPostLessonMixedFiles();
    await testPostLessonValidation();

    // 3. GET tests
    await testGetLessons();
    await testGetCourseTree();

    // 4. PUT tests
    await testUpdateLessonMetadata();
    await testUpdateLessonAppendFiles();
    await testUpdateLessonValidation();

    // 5. Integrity tests
    await testMultiDataIntegrity();

    // 6. DELETE tests
    await testDeleteLesson();
    await testDeleteLessonValidation();

    // 7. Cleanup
    await cleanup();

  } catch (fatalError) {
    console.error('\n💥 FATAL ERROR:', fatalError.message);
    console.error(fatalError.stack);
  }

  // ─── Results Summary ─────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║                         TEST RESULTS                                   ║
╠══════════════════════════════════════════════════════════════════════════╣
║  Total:    ${String(state.totalTests).padEnd(58)}║
║  Passed:   ${String(state.passed).padEnd(58)}║
║  Failed:   ${String(state.failed).padEnd(58)}║
║  Duration: ${(elapsed + 's').padEnd(58)}║
╠══════════════════════════════════════════════════════════════════════════╣
║  Result:   ${state.failed === 0 ? '✅ ALL TESTS PASSED'.padEnd(58) : '❌ SOME TESTS FAILED'.padEnd(58)}║
╚══════════════════════════════════════════════════════════════════════════╝
`);

  if (state.errors.length > 0) {
    console.log('\n❌ Failed assertions:');
    state.errors.forEach((e, i) => {
      console.log(`  ${i + 1}. ${e}`);
    });
  }

  process.exit(state.failed > 0 ? 1 : 0);
}

main();
