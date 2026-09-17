const Activity = require('../models/Activity');

/**
 * Helper utility function to log platform activities into MongoDB.
 * Ensures safe execution without interrupting main controller logic.
 *
 * @param {Object} params
 * @param {string} params.title - Activity title (e.g., "New student registration", "Exam published")
 * @param {string} params.description - Activity description (e.g., "Dr. Aris Thorne joined Materia Medica 101")
 * @param {string} params.type - Activity category (e.g., 'student', 'webinar', 'payment', 'exam')
 * @param {string|mongoose.Types.ObjectId} [params.adminId] - Admin ID (optional)
 * @param {string|mongoose.Types.ObjectId} [params.actor] - Actor ID (optional)
 * @returns {Promise<Object|null>} The saved Activity document or null on error
 */
const logActivity = async ({ title, description, type, adminId = null, actor = null }) => {
  try {
    if (!title || !description || !type) {
      console.warn('[ActivityLogger] Warning: missing required fields (title, description, or type).');
      return null;
    }

    const activity = await Activity.create({
      title,
      description,
      type,
      adminId: adminId || actor || null,
      actor: actor || adminId || null,
      createdAt: new Date(),
    });

    return activity;
  } catch (error) {
    console.error('[ActivityLogger] Error logging activity:', error.message);
    return null;
  }
};

/**
 * Optional Express middleware helper to log activity automatically on HTTP response finish
 */
const activityLoggerMiddleware = ({ type, getTitle, getDescription }) => {
  return (req, res, next) => {
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const title = typeof getTitle === 'function' ? getTitle(req) : getTitle;
        const description = typeof getDescription === 'function' ? getDescription(req) : getDescription;
        const adminId = req.admin?._id || req.user?._id || req.user?.id || null;

        if (title && description) {
          logActivity({ title, description, type, adminId });
        }
      }
    });
    next();
  };
};

module.exports = {
  logActivity,
  activityLoggerMiddleware,
};
