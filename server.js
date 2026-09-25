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
  'https://student.whitecoat.academy',
  'https://student-portal.whitecoat.academy',
  'https://whitecoatacademy.com',
  'https://www.whitecoatacademy.com',
  'https://admin.whitecoatacademy.com',
  'https://student.whitecoatacademy.com',
  'https://whitecodeacademy.com',
  'https://www.whitecodeacademy.com',
  'https://admin.whitecodeacademy.com',
  'https://student.whitecodeacademy.com',
];

if (process.env.ALLOWED_ORIGINS) {
  process.env.ALLOWED_ORIGINS.split(',').forEach((origin) => {
    const trimmed = origin.trim();
    if (trimmed && !allowedOrigins.includes(trimmed)) {
      allowedOrigins.push(trimmed);
    }
  });
}

const isOriginAllowed = (origin) => {
  if (!origin) return true; // Mobile apps, Postman, curl, server-to-server

  // Direct allowlist match
  if (allowedOrigins.includes(origin)) return true;

  // Domain regex checks for official domains & subdomains
  const domainPatterns = [
    /^https?:\/\/([a-zA-Z0-9-]+\.)*whitecoat\.academy$/i,
    /^https?:\/\/([a-zA-Z0-9-]+\.)*whitecoatacademy\.com$/i,
    /^https?:\/\/([a-zA-Z0-9-]+\.)*whitecodeacademy\.com$/i,
    /^https?:\/\/([a-zA-Z0-9-]+\.)*onrender\.com$/i,
    /^https?:\/\/([a-zA-Z0-9-]+\.)*vercel\.app$/i,
    /^https?:\/\/([a-zA-Z0-9-]+\.)*netlify\.app$/i,
    /^https?:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2|0\.0\.0\.0)(:\d+)?$/i,
  ];

  if (domainPatterns.some((pattern) => pattern.test(origin))) {
    return true;
  }

  // Mobile WebViews and hybrid app schemes
  if (
    origin.startsWith('file://') ||
    origin.startsWith('capacitor://') ||
    origin.startsWith('ionic://') ||
    origin.startsWith('tauri://') ||
    origin.startsWith('app://')
  ) {
    return true;
  }

  return false;
};

const corsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS error: Origin ${origin} not allowed by CORS policy`), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'x-student-id',
    'x-user-id',
    'Accept',
    'Origin',
    'X-Requested-With',
    'Access-Control-Allow-Origin',
    'Access-Control-Allow-Headers',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers',
  ],
  exposedHeaders: ['Content-Range', 'X-Content-Range', 'ETag', 'Authorization'],
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Explicit CORS headers safety net middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-student-id, x-user-id, Accept, Origin, X-Requested-With');
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Body Parser Middleware (Must be registered before any routes are defined)
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));


// ── Request timeout middleware ─────────────────────────────────────────────
// Uses 120s timeout for video uploads/recordings, 30s for general REST endpoints.
app.use((req, res, next) => {
  const url = (req.originalUrl || req.url || '').toLowerCase();
  const isUploadRoute = url.includes('/upload') || url.includes('/recordings') || url.includes('/media');
  const timeoutMs = isUploadRoute ? 120000 : 60000;

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
const adminAuthRoutes = require('./routes/adminAuthRoutes');

// ── Public Authentication Endpoints (Strictly public, NO auth middleware) ───
app.use('/api/admin/auth', adminAuthRoutes);
app.use('/api/v1/admin/auth', adminAuthRoutes);
app.use('/admin/auth', adminAuthRoutes);

app.use('/api/auth', authRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/auth', authRoutes);

app.use('/api/upload', require('./routes/uploadRoutes'));
app.use('/api/v1/upload', require('./routes/uploadRoutes'));
app.use('/api/media', require('./routes/uploadRoutes'));
app.use('/api/uploads', require('./routes/uploadRoutes'));
app.use('/api/upload-image', require('./routes/uploadRoutes'));

app.use('/courses', require('./routes/studentCurriculumRoutes'));
app.use('/api/courses', require('./routes/courseRoutes'));
app.use('/api/v1/courses', require('./routes/courseRoutes'));
app.use('/api/admin/courses', require('./routes/adminCourseRoutes'));
app.use('/api/v1/demo-videos', require('./routes/demoVideoRoutes'));
app.use('/api/demo-videos', require('./routes/demoVideoRoutes'));
app.use('/api/subscriptions', require('./routes/subscriptionPlanRoutes'));
app.use('/api/v1/subscriptions', require('./routes/subscriptionPlanRoutes'));
app.use('/api', require('./routes/recordingRoutes'));
app.use('/api/v1', require('./routes/recordingRoutes'));



const studentFacultyRoutes = require('./routes/studentFacultyRoutes');
app.use('/api/student/faculty', studentFacultyRoutes);
app.use('/api/v1/student/faculty', studentFacultyRoutes);

// Student self-service profile and management routes
const studentProfileRoutes = require('./routes/studentRoutes');
app.use('/api/students', studentProfileRoutes);
app.use('/api/v1/students', studentProfileRoutes);
app.use('/api/student', studentProfileRoutes);
app.use('/api/v1/student', studentProfileRoutes);

// Student curriculum and progress routes
app.use('/api/student', require('./routes/studentCurriculumRoutes'));
app.use('/api/v1/student', require('./routes/studentCurriculumRoutes'));
app.use('/api/admin/students', require('./routes/adminStudentRoutes'));
app.use('/api/v1/admin/students', require('./routes/adminStudentRoutes'));

const examRoutes = require('./routes/exam.routes');
app.use(examRoutes);
const studentExamRoutes = require('./src/student/student.routes');
app.use(studentExamRoutes);
const adminExamRoutes = require('./src/admin/admin.routes');
app.use(adminExamRoutes);
const unaniExamRoutes = require('./src/unani/exams/routes/unaniExam.routes');
app.use(unaniExamRoutes);
const facultyRoutes = require('./routes/facultyRoutes');
app.use('/api/admin/faculty', facultyRoutes);
app.use('/api/v1/admin/faculty', facultyRoutes);
const adminDashboardRoutes = require('./routes/adminDashboardRoutes');
app.use('/api/admin/dashboard-stats', adminDashboardRoutes);
app.use('/api/v1/admin/dashboard-stats', adminDashboardRoutes);
app.use('/api/admin/activities', adminDashboardRoutes);
app.use('/api/v1/admin/activities', adminDashboardRoutes);

const adminRoutes = require('./routes/adminRoutes');
app.use('/api/v1/admin', adminRoutes);
app.use('/api/admin', adminRoutes);


// ── Health / Wake-up endpoint ──────────────────────────────────────────────
// Zero-latency ping for the Flutter frontend to pre-warm the Render server
// from its cold start. No DB queries — responds as soon as the Node process
// is alive. The Flutter app fires this when the login screen loads so the
// server is already awake by the time the user taps "Login".
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is awake',
    timestamp: Date.now(),
  });
});
app.get('/api/v1/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is awake',
    timestamp: Date.now(),
  });
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
  if (err.message && err.message.startsWith('CORS error')) {
    return res.status(403).json({ success: false, message: err.message });
  }
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

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };