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

// CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-student-id', 'x-user-id'],
}));

app.use(express.json());

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
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/courses', require('./routes/courseRoutes'));
const lessonRoutes = require('./routes/lesson.routes');
app.use(lessonRoutes);
const examRoutes = require('./routes/exam.routes');
app.use(examRoutes);
const studentRoutes = require('./src/student/student.routes');
app.use(studentRoutes);
const adminExamRoutes = require('./src/admin/admin.routes');
app.use(adminExamRoutes);
const adminRoutes = require('./routes/adminRoutes');
app.use('/api/v1/admin', adminRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/v1/students', adminRoutes);
app.use('/api/students', adminRoutes);

// MongoDB
connectDB();

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