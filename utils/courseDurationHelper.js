/**
 * Course Duration Helper
 *
 * Calculates the total configured course duration in minutes based on
 * the Admin Portal's lesson/module editor configured duration values.
 *
 * Supports formats:
 * - "90 mins", "50 min", "50 miin", "45m", "10 minute", "10 minutes"
 * - "2 hrs", "1.5 hours", "1 hr", "2h", "1.5h"
 * - "2400 sec", "120s", "300 seconds"
 * - "01:30:00", "45:00"
 * - Plain numeric strings or numbers: "50", 50 (from Admin Portal "Duration (mins)" field)
 * - Fallback to videoDuration (seconds) when durationOrPages is empty
 * - Page counts ("12 pages") are safely ignored (0 minutes)
 * - Handles missing, null, undefined, negative, or invalid values safely (0 minutes)
 * - Prevents double-counting when both module and lesson durations exist
 */

/**
 * Parse a raw duration value into whole minutes.
 *
 * @param {string|number|null|undefined} rawVal
 * @param {number} [fallbackSeconds=0]
 * @returns {number} Whole minutes (non-negative integer)
 */
function parseDurationMinutes(rawVal, fallbackSeconds = 0) {
  if (rawVal !== null && rawVal !== undefined && rawVal !== '') {
    if (typeof rawVal === 'number') {
      return Number.isFinite(rawVal) && rawVal > 0 ? Math.round(rawVal) : 0;
    }

    const str = String(rawVal).trim().toLowerCase();
    if (!str) {
      return fallbackSeconds > 0 && Number.isFinite(fallbackSeconds) ? Math.round(fallbackSeconds / 60) : 0;
    }

    // Explicitly reject page counts (e.g., "12 pages", "18 page") - documents, not duration
    if (/^\d+\s*pages?$/i.test(str) || str.includes('page')) {
      return 0;
    }

    // Handle clock format: "hh:mm:ss" or "mm:ss"
    if (str.includes(':')) {
      const parts = str.split(':').map((p) => parseFloat(p.trim()));
      if (parts.every((p) => !isNaN(p) && p >= 0)) {
        if (parts.length === 3) {
          const [hr, min, sec] = parts;
          return Math.round((hr * 60) + min + (sec / 60));
        }
        if (parts.length === 2) {
          const [min, sec] = parts;
          return Math.round(min + (sec / 60));
        }
      }
    }

    // Match hours: "2 hrs", "1.5 hours", "1 hr", "2h", "1.5h"
    const hrMatch = str.match(/^([\d.]+)\s*(?:h|hr|hrs|hours?)$/i);
    if (hrMatch) {
      const h = parseFloat(hrMatch[1]);
      return Number.isFinite(h) && h > 0 ? Math.round(h * 60) : 0;
    }

    // Match minutes: "90 mins", "50 min", "50 miin", "45m", "10 minute", "10 minutes"
    const minMatch = str.match(/^([\d.]+)\s*(?:m|min|mins|miin|minute|minutes?)$/i);
    if (minMatch) {
      const m = parseFloat(minMatch[1]);
      return Number.isFinite(m) && m > 0 ? Math.round(m) : 0;
    }

    // Match seconds: "2400 sec", "120s", "300 seconds"
    const secMatch = str.match(/^([\d.]+)\s*(?:s|sec|secs|seconds?)$/i);
    if (secMatch) {
      const s = parseFloat(secMatch[1]);
      return Number.isFinite(s) && s > 0 ? Math.round(s / 60) : 0;
    }

    // Plain numeric string: "50", "90", "10" -> configured in Admin Portal "Duration (mins)"
    const num = parseFloat(str);
    if (Number.isFinite(num) && num > 0) {
      return Math.round(num);
    }
  }

  // Fallback to videoDuration (seconds) if available
  if (fallbackSeconds > 0 && Number.isFinite(fallbackSeconds)) {
    return Math.round(fallbackSeconds / 60);
  }

  return 0;
}

/**
 * Parse an individual lesson's configured duration in minutes.
 *
 * @param {object} lesson
 * @returns {number}
 */
function parseLessonDuration(lesson) {
  if (!lesson || typeof lesson !== 'object') return 0;

  const rawVal = lesson.durationOrPages !== undefined && lesson.durationOrPages !== null && lesson.durationOrPages !== ''
    ? lesson.durationOrPages
    : (lesson.duration !== undefined && typeof lesson.duration === 'string' ? lesson.duration : null);

  const fallbackSeconds = (typeof lesson.videoDuration === 'number' && Number.isFinite(lesson.videoDuration) && lesson.videoDuration > 0)
    ? lesson.videoDuration
    : (Array.isArray(lesson.videoParts) && lesson.videoParts.length > 0
        ? lesson.videoParts.reduce((acc, vp) => {
            const d = Number(vp?.duration || vp?.videoDuration || 0);
            return acc + (Number.isFinite(d) && d > 0 ? d : 0);
          }, 0)
        : 0);

  return parseDurationMinutes(rawVal, fallbackSeconds);
}

/**
 * Calculate the total duration in minutes for an entire course.
 * Scoped strictly to the provided course document and its modules/lessons.
 * Avoids double-counting: when lessons in a module have durations, the module's
 * own total is not added again.
 *
 * @param {object} course
 * @returns {number} Total course duration in whole minutes
 */
function calculateCourseTotalDurationMinutes(course) {
  if (!course || typeof course !== 'object') return 0;

  let totalMinutes = 0;
  const modules = Array.isArray(course.modules) ? course.modules : [];

  for (const moduleItem of modules) {
    if (!moduleItem || typeof moduleItem !== 'object') continue;

    let moduleLessonMinutes = 0;
    const lessons = Array.isArray(moduleItem.lessons) ? moduleItem.lessons : [];
    for (const lesson of lessons) {
      const mins = parseLessonDuration(lesson);
      if (mins > 0) {
        moduleLessonMinutes += mins;
      }
    }

    if (moduleLessonMinutes > 0) {
      // Lessons exist with duration; count their sum
      totalMinutes += moduleLessonMinutes;
    } else if (moduleItem.duration || moduleItem.durationMinutes) {
      // Fallback: if no lesson durations exist, check module-level duration
      const modDuration = moduleItem.durationMinutes || moduleItem.duration;
      const modMins = parseDurationMinutes(modDuration, 0);
      if (modMins > 0) {
        totalMinutes += modMins;
      }
    }
  }

  return totalMinutes;
}

module.exports = {
  parseDurationMinutes,
  parseLessonDuration,
  calculateCourseTotalDurationMinutes,
};
