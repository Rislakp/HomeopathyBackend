/**
 * Normalize current multi-course assignments while retaining the legacy
 * single-course field as a compatible assignment.
 */
function normalizeExamCourseIds(courseIds, legacyCourseId = null) {
  const values = [
    ...(Array.isArray(courseIds) ? courseIds : []),
    legacyCourseId,
  ];
  const seen = new Set();
  const normalized = [];

  for (const value of values) {
    const identifier = value && typeof value === 'object' && typeof value.toHexString !== 'function'
      ? (value.courseId || value.id || value._id || value.courseRef)
      : value;
    const id = String(identifier || '').trim();
    const key = id.toLowerCase();
    if (!id || seen.has(key)) continue;
    seen.add(key);
    normalized.push(id);
  }
  return normalized;
}

function getExamAssignedCourseIds(exam) {
  const assigned = Array.isArray(exam?.courseIds) ? exam.courseIds : [];
  return assigned.length > 0
    ? normalizeExamCourseIds(assigned)
    : normalizeExamCourseIds([], exam?.courseId);
}

function getStudentAssignedCourseIds(student) {
  return normalizeExamCourseIds([
    ...(Array.isArray(student?.courseIds) ? student.courseIds : []),
    ...(Array.isArray(student?.registeredCourseIds) ? student.registeredCourseIds : []),
    ...(Array.isArray(student?.registeredCourses) ? student.registeredCourses : []),
    ...(Array.isArray(student?.enrolled_courses) ? student.enrolled_courses : []),
    ...(Array.isArray(student?.enrolledCourses) ? student.enrolledCourses : []),
  ], student?.courseId || student?.courseRef || student?.course);
}

function studentMatchesExamCourseAssignment(exam, student) {
  const enrolled = new Set(getStudentAssignedCourseIds(student).map((id) => id.toLowerCase()));
  return getExamAssignedCourseIds(exam).some((id) => enrolled.has(id.toLowerCase()));
}

/**
 * Build Mongo filters for both legacy scalar assignments and the multi-course
 * array. Mongo returns each matching exam document only once for an $or query.
 */
function expandLegacyCourseFiltersForExamArrays(courseFilters) {
  const expanded = [];
  for (const filter of courseFilters || []) {
    expanded.push(filter);
    if (Object.prototype.hasOwnProperty.call(filter || {}, 'courseId')) {
      expanded.push({ courseIds: filter.courseId });
    }
  }
  return expanded;
}

function buildStudentPublishedExamClause() {
  return {
    $or: [
      { status: 'Published' },
      { status: 'published' },
      { status: { $exists: false } },
      { status: null },
      { status: '' },
    ],
  };
}

module.exports = {
  normalizeExamCourseIds,
  getExamAssignedCourseIds,
  getStudentAssignedCourseIds,
  studentMatchesExamCourseAssignment,
  expandLegacyCourseFiltersForExamArrays,
  buildStudentPublishedExamClause,
};
