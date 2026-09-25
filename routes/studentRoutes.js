const express = require('express');
const router = express.Router();

const facultyController = require('../controllers/facultyController');
const adminStudentController = require('../controllers/adminStudentController');
const { adminAuth } = require('../middleware/adminAuth.middleware');
const { requireAuth } = require('../middleware/rbac');
const {
  getProfile,
  updateProfile,
  deleteAccount,
} = require('../controllers/studentProfileController');

// ─────────────────────────────────────────────────────────────────────────────
// 1. DEDICATED STUDENT SELF-SERVICE PROFILE ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/students/profile
 * GET /api/student/profile
 * Fetch authenticated student's full profile document.
 */
router.get('/profile', requireAuth, getProfile);
router.patch('/profile', requireAuth, updateProfile);
router.put('/profile', requireAuth, updateProfile);
router.delete('/profile', requireAuth, deleteAccount);

/**
 * GET /api/students/me
 * GET /api/student/me
 */
router.get('/me', requireAuth, getProfile);
router.patch('/me', requireAuth, updateProfile);
router.put('/me', requireAuth, updateProfile);

/**
 * GET /api/students/self
 * GET /api/student/self
 */
router.get('/self', requireAuth, getProfile);
router.patch('/self', requireAuth, updateProfile);
router.put('/self', requireAuth, updateProfile);

// ─────────────────────────────────────────────────────────────────────────────
// 2. ADMIN-ONLY: Export scores (must precede parameterized routes)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/export', adminAuth, adminStudentController.exportStudentsScores);

// ─────────────────────────────────────────────────────────────────────────────
// 3. STUDENT-FACING: Faculty info
// ─────────────────────────────────────────────────────────────────────────────
router.get('/faculty', facultyController.getStudentFaculty);
router.get('/faculty/:id', facultyController.getStudentFacultyById);

// ─────────────────────────────────────────────────────────────────────────────
// 4. ROOT /api/students DISPATCHER
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', requireAuth, (req, res, next) => {
  const role = (req.user?.role || '').toLowerCase().trim();
  if (role === 'admin' || role === 'superadmin') {
    return adminStudentController.getAdminStudents(req, res, next);
  }
  return getProfile(req, res, next);
});

router.post('/', adminAuth, adminStudentController.createStudent);

// ─────────────────────────────────────────────────────────────────────────────
// 5. PARAMETERIZED PROFILE ROUTES
// ─────────────────────────────────────────────────────────────────────────────
router.get('/profile/:id', requireAuth, getProfile);
router.patch('/profile/:id', requireAuth, updateProfile);
router.put('/profile/:id', requireAuth, updateProfile);
router.delete('/profile/:id', requireAuth, deleteAccount);

// ─────────────────────────────────────────────────────────────────────────────
// 6. ADMIN STUDENT ACTION ROUTES (Approve / Reject / Status / Results)
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id/approve', adminAuth, adminStudentController.approveStudent);
router.patch('/:id/approve', adminAuth, adminStudentController.approveStudent);
router.put('/:id/reject', adminAuth, adminStudentController.rejectStudent);
router.patch('/:id/reject', adminAuth, adminStudentController.rejectStudent);
router.put('/:id/status', adminAuth, adminStudentController.approveStudent);
router.patch('/:id/status', adminAuth, adminStudentController.approveStudent);
router.get('/:id/results', adminAuth, adminStudentController.getAdminStudentResults);

// ─────────────────────────────────────────────────────────────────────────────
// 7. PARAMETERIZED /:id ROUTE (Admin management or Student own profile)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', requireAuth, (req, res, next) => {
  const role = (req.user?.role || '').toLowerCase().trim();
  if (role === 'admin' || role === 'superadmin') {
    return adminStudentController.getStudentById(req, res, next);
  }
  return getProfile(req, res, next);
});

router.patch('/:id', requireAuth, (req, res, next) => {
  const role = (req.user?.role || '').toLowerCase().trim();
  if (role === 'admin' || role === 'superadmin') {
    return adminStudentController.updateStudent(req, res, next);
  }
  return updateProfile(req, res, next);
});

router.put('/:id', requireAuth, (req, res, next) => {
  const role = (req.user?.role || '').toLowerCase().trim();
  if (role === 'admin' || role === 'superadmin') {
    return adminStudentController.updateStudent(req, res, next);
  }
  return updateProfile(req, res, next);
});

router.delete('/:id', requireAuth, (req, res, next) => {
  const role = (req.user?.role || '').toLowerCase().trim();
  if (role === 'admin' || role === 'superadmin') {
    return adminStudentController.deleteStudent(req, res, next);
  }
  return deleteAccount(req, res, next);
});

module.exports = router;