const {
  requireAuth,
  requireRole,
  requireAdmin,
  requireStudent,
} = require('./rbac');

// Main default export is requireAuth
const authMiddleware = requireAuth;
authMiddleware.requireAuth = requireAuth;
authMiddleware.requireRole = requireRole;
authMiddleware.requireAdmin = requireAdmin;
authMiddleware.requireStudent = requireStudent;

module.exports = authMiddleware;