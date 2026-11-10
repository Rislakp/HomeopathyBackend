const fs = require('fs');
let content = fs.readFileSync('utils/courseAccessHelper.js', 'utf8');

const target = `  let targetCourse = null;
  try {
    targetCourse = await CourseModel.findOne({ $or: targetCourseOrConditions })
      .select('_id courseId courseTitle status')
      .lean();
  } catch (err) {
    console.warn('[courseAccessHelper] Target course lookup error:', err.message);
  }

  if (!targetCourse) return false;

  // Non-staff can NEVER access unpublished (Draft or Archived) courses
  if (String(targetCourse.status || '').toLowerCase() !== 'published') {
    return false;
  }`;

const replacement = `  let targetCourse = null;
  try {
    let query = CourseModel.findOne({ $or: targetCourseOrConditions });
    if (query && typeof query.select === 'function') {
      query = query.select('_id courseId courseTitle status');
    }
    if (query && typeof query.lean === 'function') {
      query = query.lean();
    }
    targetCourse = await query;
  } catch (err) {
    console.warn('[courseAccessHelper] Target course lookup error:', err.message);
  }

  if (!targetCourse) return false;

  // Non-staff can NEVER access unpublished (Draft or Archived) courses
  const targetStatus = targetCourse.status ? String(targetCourse.status).toLowerCase() : 'published';
  if (targetStatus !== 'published') {
    return false;
  }`;

const targetCRLF = target.replace(/\n/g, '\r\n');
const replacementCRLF = replacement.replace(/\n/g, '\r\n');

if (content.includes(targetCRLF)) {
  content = content.replace(targetCRLF, replacementCRLF);
} else if (content.includes(target)) {
  content = content.replace(target, replacement);
} else {
  throw new Error('target not found in courseAccessHelper.js');
}

fs.writeFileSync('utils/courseAccessHelper.js', content, 'utf8');
console.log('Successfully updated courseAccessHelper.js');

