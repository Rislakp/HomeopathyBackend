require('dotenv').config();

// ── Process-level safety net ──────────────────────────────────────────────────
// Catches any async promise rejection that escapes a try/catch.
// Without this, Node silently ignores the error and the HTTP request hangs forever.
process.on('unhandledRejection', (reason, promise) => {
  console.error('[UnhandledRejection] Unhandled Promise Rejection:', reason);
  // Do NOT exit — let Express keep serving; individual request already timed out.
});

// Catches synchronous throws that escape all error boundaries.
process.on('uncaughtException', (err) => {
  console.error('[UncaughtException] Fatal synchronous error:', err);
  // Exit and let the process manager (PM2 / Docker) restart cleanly.
  process.exit(1);
});

const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');

const app = express();

// CORS Allowlist
const allowedOrigins = [
  'https://whitecoat.academy',
  'https://www.whitecoat.academy',
  'https://admin.whitecoat.academy',
];

if (process.env.ALLOWED_ORIGINS) {
  process.env.ALLOWED_ORIGINS.split(',').forEach((origin) => {
    const trimmed = origin.trim();
    if (trimmed && !allowedOrigins.includes(trimmed)) {
      allowedOrigins.push(trimmed);
    }
  });
}

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser clients (mobile apps, Postman, curl, server-to-server) where origin is undefined
    if (!origin) {
      return callback(null, true);
    }

    // Check allowlist
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Allow localhost and 127.0.0.1 on any port (for local dev & Flutter Web)
    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    if (isLocalhost) {
      return callback(null, true);
    }

    return callback(new Error(`CORS error: Origin ${origin} not allowed by CORS policy`), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-student-id', 'x-user-id', 'Accept', 'Origin', 'X-Requested-With'],
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Body Parser Middleware (Must be registered before any routes are defined)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ── Global request timeout (30 s) ─────────────────────────────────────────────
// Ensures Flutter never waits forever if a handler gets stuck.
app.use((req, res, next) => {
  res.setTimeout(30000, () => {
    if (!res.headersSent) {
      res.status(503).json({
        success: false,
        message: 'Request timed out. Please try again.',
      });
    }
  });
  next();
});

// Routes
const authRoutes = require('./routes/authRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/auth', authRoutes);

app.use('/api/courses', require('./routes/courseRoutes'));
app.use('/api/subscriptions', require('./routes/subscriptionPlanRoutes'));
app.use('/api/v1/subscriptions', require('./routes/subscriptionPlanRoutes'));

const studentFacultyRoutes = require('./routes/studentFacultyRoutes');
app.use('/api/student/faculty', studentFacultyRoutes);
app.use('/api/student_new', require('./routes/studentRoutes'));
app.use('/api/faculty_new', require('./routes/facultyRoutes'));
app.use('/api/admin/students', require('./routes/adminStudentRoutes'));

const examRoutes = require('./routes/exam.routes');
app.use(examRoutes);
const studentRoutes = require('./src/student/student.routes');
app.use(studentRoutes);
const adminExamRoutes = require('./src/admin/admin.routes');
app.use(adminExamRoutes);
const facultyRoutes = require('./routes/facultyRoutes');
app.use('/api/admin/faculty', facultyRoutes);
app.use('/api/v1/admin/faculty', facultyRoutes);
const adminRoutes = require('./routes/adminRoutes');
app.use('/api/admin/auth', require('./routes/adminAuthRoutes'));
app.use('/api/v1/admin', adminRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/v1/students', adminRoutes);
app.use('/api/students', adminRoutes);


// MongoDB
connectDB().then(() => {
  const { seedInitialAdmin } = require('./controllers/adminAuthController');
  seedInitialAdmin();
});

// Test
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Backend is working',
  });
});

// 404 Route Not Found Catch-All
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`
  });
});

// 500 Global Error Handler Middleware
app.use((err, req, res, next) => {
  console.error('Express Error Handler:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});