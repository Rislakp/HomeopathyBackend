/**
 * Role-based Authorization Middleware
 * Usage: requireRole('admin') or requireRole('student') or requireRole('student', 'admin')
 */
const requireRole = (...allowedRoles) => {
  const normalizedAllowed = allowedRoles.map((role) => role.toLowerCase().trim());

  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. User role not determined.',
      });
    }

    const userRole = req.user.role.toLowerCase().trim();

    if (!normalizedAllowed.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    next();
  };
};

module.exports = {
  requireRole,
};
