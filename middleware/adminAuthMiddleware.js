const jwt = require('jsonwebtoken');
const Admin = require('../models/admin.model');
let User;
try { User = require('../models/User'); } catch (e) { /* optional */ }

const getJwtSecret = () => {
  return (
    process.env.JWT_SECRET ||
    'white_coat_academy_secret_jwt_key_2026_super_secure'
  );
};

/**
 * Admin Authentication Middleware
 * Protects Admin Dashboard endpoints by verifying the Admin's JWT.
 */
const adminAuthMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Bearer token missing.',
      });
    }

    const token = authHeader.split(' ')[1];
    if (!token || !token.trim()) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Token is empty.',
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, getJwtSecret());
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token',
        error: err.message,
      });
    }

    // ── DEBUG: Print the raw decoded JWT payload (adminAuthMiddleware) ────────
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║  [adminAuthMiddleware] DECODED JWT PAYLOAD            ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('  Route            :', req.method, req.originalUrl);
    console.log('  decoded.id       :', decoded.id);
    console.log('  decoded.userId   :', decoded.userId);
    console.log('  decoded.adminId  :', decoded.adminId);
    console.log('  decoded.role     :', decoded.role);
    console.log('  decoded.email    :', decoded.email);
    console.log('  Full payload     :', JSON.stringify(decoded));
    console.log('──────────────────────────────────────────────────────\n');

    const adminId = decoded.adminId || decoded.userId || decoded.id || decoded._id;

    if (!adminId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token: Admin ID missing.',
      });
    }

    // Lookup Admin in the database (Admin collection first, fallback to User collection)
    let admin = null;
    if (Admin) {
      admin = await Admin.findById(adminId);
    }
    if (!admin && User) {
      const userDoc = await User.findById(adminId);
      if (userDoc) {
        const userRole = (userDoc.role || '').toUpperCase().trim();
        if (userRole === 'ADMIN' || userRole === 'SUPERADMIN') {
          admin = userDoc;
        } else {
          return res.status(403).json({
            success: false,
            message: 'Forbidden: Admin access only.',
          });
        }
      }
    }

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Admin account not found.',
      });
    }

    // Check if account is active
    if (admin.isActive === false) {
      return res.status(403).json({
        success: false,
        message: 'Admin account is inactive',
      });
    }

    // Verify admin role (must be ADMIN or SUPERADMIN)
    const role = (admin.role || '').toUpperCase().trim();
    // ── DEBUG: Print DB-resolved admin and role comparison ──────────────────
    console.log('\n╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌');
    console.log('  [adminAuthMiddleware] DB Lookup + Role Check');
    console.log('  admin found in  :', admin.constructor.modelName || 'unknown collection');
    console.log('  admin._id       :', admin._id);
    console.log('  admin.role (raw):', admin.role, '  ← THIS is what is compared to ADMIN/SUPERADMIN');
    console.log('  role (uppercased):', role);
    console.log('  isActive        :', admin.isActive);
    console.log('  Passes role check?:', role === \'ADMIN\' || role === \'SUPERADMIN\');
    console.log('╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌\n');
    if (role !== 'ADMIN' && role !== 'SUPERADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Admin access only.',
      });
    }

    // Attach admin to request object
    req.admin = {
      id: admin._id.toString(),
      email: admin.email,
      role: admin.role,
    };
    req.user = {
      id: admin._id.toString(),
      userId: admin._id.toString(),
      email: admin.email,
      role: role.toLowerCase(),
    };

    next();
  } catch (error) {
    console.error('Admin Auth Middleware Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during authentication.',
      error: error.message,
    });
  }
};

module.exports = adminAuthMiddleware;
