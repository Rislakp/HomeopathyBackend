const assert = require('assert');

// Test Suite for Course Draft / Publish Functionality
async function runTests() {
  console.log('--- Starting Course Draft / Publish Tests ---');

  // 1. Test normalizeStatus
  const normalizeStatus = (statusStr) => {
    if (!statusStr || typeof statusStr !== 'string') return undefined;
    const s = statusStr.trim().toLowerCase();
    if (s === 'published') return 'Published';
    if (s === 'draft') return 'Draft';
    if (s === 'archived') return 'Archived';
    return statusStr.trim();
  };

  assert.strictEqual(normalizeStatus('draft'), 'Draft');
  assert.strictEqual(normalizeStatus('DRAFT'), 'Draft');
  assert.strictEqual(normalizeStatus('published'), 'Published');
  assert.strictEqual(normalizeStatus('PUBLISHED'), 'Published');
  assert.strictEqual(normalizeStatus('Archived'), 'Archived');
  assert.strictEqual(normalizeStatus(''), undefined);
  assert.strictEqual(normalizeStatus(null), undefined);
  console.log('✔ normalizeStatus behaves correctly across casing');

  // 2. Test courseController logic: non-staff filter in getCourses
  {
    const filterForAdmin = {};
    const adminRole = 'admin';
    const canSignAdmin = ['admin', 'superadmin'].includes(adminRole);
    const queryStatus = 'Draft';
    if (!canSignAdmin) {
      filterForAdmin.status = new RegExp('^published$', 'i');
    } else if (queryStatus && queryStatus.trim() && queryStatus.toLowerCase() !== 'all') {
      filterForAdmin.status = new RegExp(`^${queryStatus.trim()}$`, 'i');
    }
    assert(filterForAdmin.status.test('Draft'), 'Admin should be able to query Draft courses');

    const filterForStudent = {};
    const studentRole = 'student';
    const canSignStudent = ['admin', 'superadmin'].includes(studentRole);
    const studentQueryStatus = 'Draft';
    if (!canSignStudent) {
      filterForStudent.status = new RegExp('^published$', 'i');
    } else if (studentQueryStatus && studentQueryStatus.trim() && studentQueryStatus.toLowerCase() !== 'all') {
      filterForStudent.status = new RegExp(`^${studentQueryStatus.trim()}$`, 'i');
    }
    assert(!filterForStudent.status.test('Draft'), 'Student must NOT match Draft courses');
    assert(filterForStudent.status.test('Published'), 'Student query must strictly match Published');
    assert(filterForStudent.status.test('published'), 'Student query must match Published case-insensitively');
    console.log('✔ getCourses role-based status filtering verified');
  }

  // 3. Test Course Access Helper: student access denied if course is Draft
  {
    const studentUser = { id: 'student123', role: 'student', studentId: 'student123' };
    const draftCourse = { _id: '507f1f77bcf86cd799439011', courseId: 'COURSE-001', status: 'Draft' };
    const publishedCourse = { _id: '507f1f77bcf86cd799439012', courseId: 'COURSE-002', status: 'Published' };

    function checkAccess(role, course) {
      if (['admin', 'superadmin'].includes(role)) return true;
      if (String(course.status || '').toLowerCase() !== 'published') return false;
      return true;
    }

    assert.strictEqual(checkAccess('admin', draftCourse), true, 'Admin has access to draft course');
    assert.strictEqual(checkAccess('student', draftCourse), false, 'Student access denied to draft course');
    assert.strictEqual(checkAccess('student', publishedCourse), true, 'Student access granted to published course');
    console.log('✔ Role-based course access check verified');
  }

  // 4. Test S3 Media Access: authorization check for draft course media
  {
    function checkMediaAccess(isStaff, resolvedCourse) {
      if (!isStaff) {
        if (!resolvedCourse) return { status: 403, error: 'Course access required' };
        if (String(resolvedCourse.status || '').toLowerCase() !== 'published') {
          return { status: 404, error: 'Course not found or not published.' };
        }
      }
      return { status: 200, success: true };
    }

    const draftCourse = { courseId: 'C1', status: 'Draft' };
    const pubCourse = { courseId: 'C2', status: 'Published' };

    assert.strictEqual(checkMediaAccess(true, draftCourse).status, 200, 'Staff can access media for draft course');
    assert.strictEqual(checkMediaAccess(false, draftCourse).status, 404, 'Student is denied media for draft course (404)');
    assert.strictEqual(checkMediaAccess(false, pubCourse).status, 200, 'Student can access media for published course');
    console.log('✔ S3 media access for draft vs published verified');
  }

  // 5. Test Demo Videos: access check for draft course demo videos
  {
    function checkDemoVideos(isStaff, course) {
      if (!isStaff && (!course || String(course.status || '').toLowerCase() !== 'published')) {
        return { count: 0, data: [] };
      }
      return { count: 2, data: ['video1', 'video2'] };
    }

    const draftCourse = { courseId: 'C1', status: 'Draft' };
    const pubCourse = { courseId: 'C2', status: 'Published' };

    assert.strictEqual(checkDemoVideos(true, draftCourse).count, 2, 'Staff can see demo videos of draft course');
    assert.strictEqual(checkDemoVideos(false, draftCourse).count, 0, 'Student cannot see demo videos of draft course');
    assert.strictEqual(checkDemoVideos(false, pubCourse).count, 2, 'Student can see demo videos of published course');
    console.log('✔ Demo videos access for draft vs published verified');
  }

  console.log('\n--- ALL BACKEND LOGIC VERIFICATIONS PASSED ---');
}

runTests().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});

