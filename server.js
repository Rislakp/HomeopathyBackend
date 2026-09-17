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
const path = require('path');
const fs = require('fs');

// Ensure static uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

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
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));


// ── Request timeout middleware ─────────────────────────────────────────────
// Uses 120s timeout for video uploads/recordings, 30s for general REST endpoints.
app.use((req, res, next) => {
  const url = (req.originalUrl || req.url || '').toLowerCase();
  const isUploadRoute = url.includes('/upload') || url.includes('/recordings') || url.includes('/media');
  const timeoutMs = isUploadRoute ? 120000 : 30000;

  res.setTimeout(timeoutMs, () => {
    if (!res.headersSent) {
      res.status(503).json({
        success: false,
        message: 'Request timed out. Please try again.',
      });
    }
  });
  next();
});

// Fallback handler for requests to /uploads that contain spaces or encoded spaces
app.use('/uploads', (req, res, next) => {
  try {
    const decodedPath = decodeURIComponent(req.path);
    const targetPath = path.join(uploadsDir, decodedPath);
    if (fs.existsSync(targetPath)) {
      return next();
    }
    // Check if sanitized version exists (spaces replaced with hyphens)
    const sanitizedName = decodedPath.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9.\-_/]/g, '');
    const sanitizedPath = path.join(uploadsDir, sanitizedName);
    if (fs.existsSync(sanitizedPath)) {
      if (path.extname(sanitizedPath).toLowerCase() === '.pdf') {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline');
      }
      return res.sendFile(sanitizedPath);
    }
  } catch (e) {
    // Malformed URI, continue to express.static
  }
  next();
});

// Serve static files from the uploads and public directory
app.use('/uploads', express.static(uploadsDir, {
  setHeaders: (res, filePath) => {
    if (path.extname(filePath).toLowerCase() === '.pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline');
    }
  },
}));
app.use(express.static(uploadsDir));
app.use(express.static(path.join(__dirname, 'public')));

// Routes
const authRoutes = require('./routes/authRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/auth', authRoutes);

app.use('/api/upload', require('./routes/uploadRoutes'));
app.use('/api/v1/upload', require('./routes/uploadRoutes'));
app.use('/api/media', require('./routes/uploadRoutes'));
app.use('/api/uploads', require('./routes/uploadRoutes'));
app.use('/api/upload-image', require('./routes/uploadRoutes'));

app.use('/api/courses', require('./routes/courseRoutes'));
app.use('/api/admin/courses', require('./routes/adminCourseRoutes'));
app.use('/api/v1/demo-videos', require('./routes/demoVideoRoutes'));
app.use('/api/subscriptions', require('./routes/subscriptionPlanRoutes'));
app.use('/api/v1/subscriptions', require('./routes/subscriptionPlanRoutes'));
app.use('/api', require('./routes/recordingRoutes'));
app.use('/api/v1', require('./routes/recordingRoutes'));



const studentFacultyRoutes = require('./routes/studentFacultyRoutes');
app.use('/api/student/faculty', studentFacultyRoutes);
app.use('/api/student', require('./routes/studentCurriculumRoutes'));
app.use('/api/v1/student', require('./routes/studentCurriculumRoutes'));
app.use('/api/student_new', require('./routes/studentRoutes'));
// Student self-service profile CRUD (must be registered BEFORE the /api/students admin catch-all below)
app.use('/api/students/self', require('./routes/studentRoutes'));
app.use('/api/v1/students/self', require('./routes/studentRoutes'));
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
app.use('/api/v1/students', adminRoutes);  // admin student management (list, bulk ops)
app.use('/api/students', adminRoutes);       // admin student management (list, bulk ops)


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

const startServer = async () => {
  try {
    await connectDB();
    const { seedInitialAdmin } = require('./controllers/adminAuthController');
    await seedInitialAdmin();

    const server = app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });

    // Configure 10-minute timeout for handling large video file uploads
    server.timeout = 600000;
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;
  } catch (error) {
    console.error('❌ Server startup failed:', error.message);
    process.exit(1);
  }
};

startServer();