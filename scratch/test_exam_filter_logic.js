const assert = require('assert');
const mongoose = require('mongoose');

// Mock data structures to test filter generation logic
function mockStudentFilter(reqQuery, studentDoc, isStaff = false) {
  const filter = {};
  const queryType = reqQuery.testType || reqQuery.type;

  function normalizeTestType(type) {
    if (!type || typeof type !== 'string') return 'grand_mock';
    const clean = type.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (clean === 'course_test' || clean === 'coursetest') return 'course_test';
    return 'grand_mock';
  }

  const isExplicitGrandMock = queryType && normalizeTestType(queryType) === 'grand_mock';
  const isExplicitCourseTest = queryType && normalizeTestType(queryType) === 'course_test';
  const targetCourseId = reqQuery.courseId ? String(reqQuery.courseId).trim() : null;

  if (isExplicitGrandMock) {
    filter.testType = { $ne: 'course_test' };
    filter.$or = [
      { testType: 'grand_mock' },
      { testType: { $regex: /^(grand[-_ ]?mock|mock)$/i } },
      { testType: { $exists: false } },
      { testType: null },
      { testType: '' }
    ];
  } else if (isExplicitCourseTest) {
    filter.testType = 'course_test';
  }

  if (targetCourseId && !isExplicitGrandMock) {
    filter.testType = 'course_test';
    const specificCourseOr = [{ courseId: targetCourseId }];
    filter.$or = specificCourseOr;
  } else {
    if (!isStaff && studentDoc && !isExplicitGrandMock) {
      const studentCourseRef = studentDoc.courseRef;
      const studentCourseId = studentDoc.courseId;
      const studentCourseTitle = studentDoc.course;

      const courseOrFilter = [];
      if (studentCourseRef) {
        courseOrFilter.push({ courseId: studentCourseRef });
      }
      if (studentCourseId) {
        courseOrFilter.push({ courseId: studentCourseId });
      }
      if (studentCourseTitle) {
        courseOrFilter.push({ courseName: studentCourseTitle });
      }

      if (courseOrFilter.length > 0) {
        if (isExplicitCourseTest) {
          filter.$or = courseOrFilter;
        } else {
          // Allow enrolled course exams OR grand mocks
          filter.$or = [
            ...courseOrFilter.map(c => ({ ...c, testType: 'course_test' })),
            { testType: 'grand_mock' },
            { testType: { $regex: /^(grand[-_ ]?mock|mock)$/i } },
            { testType: { $exists: false } },
            { testType: null },
            { testType: '' }
          ];
        }
      } else {
        if (isExplicitCourseTest) {
          return { empty: true };
        } else {
          filter.testType = { $ne: 'course_test' };
        }
      }
    }
  }

  return filter;
}

console.log('--- Testing Student Exam Filter Scenarios ---');

// Scenario 1: Default portal landing (no query params) for enrolled student
const s1 = mockStudentFilter({}, { courseId: 'COURSE_A', course: 'BHMS Prep' });
console.log('Scenario 1 (Default for enrolled student):', JSON.stringify(s1, null, 2));
assert(Array.isArray(s1.$or), 's1.$or should be an array');
assert(s1.$or.some(item => item.courseId === 'COURSE_A' && item.testType === 'course_test'), 'Course tests should be constrained by testType: course_test');
assert(s1.$or.some(item => item.testType === 'grand_mock'), 'Grand mocks should be present in $or');
console.log('✓ Scenario 1 passed');

// Scenario 2: Explicit Grand Mock query (?testType=grand_mock)
const s2 = mockStudentFilter({ testType: 'grand_mock' }, { courseId: 'COURSE_A' });
console.log('Scenario 2 (Explicit Grand Mock):', JSON.stringify(s2, null, 2));
assert.strictEqual(s2.testType.$ne, 'course_test');
assert(!s2.$or.some(item => item.courseId), 'Should have no courseId filters');
console.log('✓ Scenario 2 passed');

// Scenario 3: Explicit Course Test query (?testType=course_test)
const s3 = mockStudentFilter({ testType: 'course_test' }, { courseId: 'COURSE_A' });
console.log('Scenario 3 (Explicit Course Test):', JSON.stringify(s3, null, 2));
assert.strictEqual(s3.testType, 'course_test');
assert(s3.$or.some(item => item.courseId === 'COURSE_A'), 'Should filter by student courseId');
assert(!s3.$or.some(item => item.testType === 'grand_mock'), 'Should NOT include grand mock filters');
console.log('✓ Scenario 3 passed');

// Scenario 4: Student without course opening portal (default)
const s4 = mockStudentFilter({}, {});
console.log('Scenario 4 (Student without course - default):', JSON.stringify(s4, null, 2));
assert.strictEqual(s4.testType.$ne, 'course_test', 'Should return grand mocks only');
console.log('✓ Scenario 4 passed');

// Scenario 5: Student without course requesting course tests
const s5 = mockStudentFilter({ testType: 'course_test' }, {});
console.log('Scenario 5 (Student without course - course_test):', JSON.stringify(s5, null, 2));
assert(s5.empty === true, 'Should return empty result immediately');
console.log('✓ Scenario 5 passed');

console.log('\n✅ ALL FILTER LOGIC TESTS PASSED!');
