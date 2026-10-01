require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// â”€â”€ Process-level safety net â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Catches any async promise rejection that escapes a try/catch.
// Without this, Node silently ignores the error and the HTTP request hangs forever.
process.on('unhandledRejection', (reason, promise) => {
  console.error('[UnhandledRejection] Unhandled Promise Rejection:', reason);
  // Do NOT exit â€” let Express keep serving; individual request already timed out.
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
const requestLogger = require('./utils/requestLogger');
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
  'https://unani.whitecoat.academy',
  'https://whitecoatacademy.com',
  'https://www.whitecoatacademy.com',
  'https://admin.whitecoatacademy.com',
  'https://student.whitecoatacademy.com',
  'https://whitecodeacademy.com',
  'https://www.whitecodeacademy.com',
  'https://admin.whitecodeacademy.com',
  'https://student.whitecodeacademy.com',
  'http://localhost:50079',
  'http://localhost:5000',
  'http://localhost:5001',
  'http://localhost:3000',
  'http://localhost:5173',
];

if (process.env.ALLOWED_ORIGINS) {
  process.env.ALLOWED_ORIGINS.split(',').forEach((origin) => {
    const trimmed = origin.trim();
    if (trimmed && !allowedOrigins.includes(trimmed)) {
      allowedOrigins.push(trimmed);
    }
  });
}

// Helper to check if origin is localhost or 127.0.0.1 on any port (http or https)
const isLocalhostOrigin = (origin) => {
  if (!origin) return false;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
};

const isOriginAllowed = (origin) => {
  if (!origin) return true; // Mobile apps, Postman, curl, server-to-server

  // Direct allowlist match
  if (allowedOrigins.includes(origin)) return true;

  // Localhost & 127.0.0.1 dynamic development ports (Flutter Web, Vite, React, etc.)
  if (isLocalhostOrigin(origin)) {
    return true;
  }

  // Domain regex checks for official domains & subdomains
  const domainPatterns = [
    /^https?:\/\/([a-zA-Z0-9-]+\.)*whitecoat\.academy$/i,
    /^https?:\/\/([a-zA-Z0-9-]+\.)*whitecoatacademy\.com$/i,
    /^https?:\/\/([a-zA-Z0-9-]+\.)*whitecodeacademy\.com$/i,
    /^https?:\/\/(10\.0\.2\.2|0\.0\.0\.0)(:\d+)?$/i,
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

// Single, unified CORS configuration delegate
const corsOptionsDelegate = (req, callback) => {
  const origin = req.headers.origin;

  // Mobile apps, Postman, curl, server-to-server (no Origin header)
  if (!origin) {
    return callback(null, { origin: true });
  }

  // Validate allowed origin (dynamic localhost/127.0.0.1 ports or production whitelist)
  if (!isOriginAllowed(origin)) {
    return callback(null, { origin: false });
  }

  const requestedHeaders = req.headers['access-control-request-headers'];
  const standardHeaders = [
    'Authorization',
    'Content-Type',
    'Accept',
    'Origin',
    'X-Requested-With',
    'x-student-id',
    'x-user-id',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers',
  ];

  let allowedHeaders = standardHeaders;
  if (requestedHeaders) {
    const customList = requestedHeaders.split(',').map((h) => h.trim()).filter(Boolean);
    allowedHeaders = Array.from(new Set([...standardHeaders, ...customList]));
  }

  callback(null, {
    origin: true, // Returns exact requesting origin (required when credentials are true; never '*')
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: allowedHeaders,
    exposedHeaders: ['Content-Range', 'X-Content-Range', 'ETag', 'Authorization'],
    optionsSuccessStatus: 200,
    maxAge: 86400,
  });
};

// Single, unified CORS middleware handling all requests and preflights
app.use(cors(corsOptionsDelegate));
app.options('*', cors(corsOptionsDelegate));

// Body Parser Middleware (Must be registered before any routes are defined)
// JSON is for metadata and answers, not media. Multipart uploads are handled
// by multer and retain their own route-specific file-size limits.
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));


app.use(requestLogger);

// â”€â”€ Request timeout middleware â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Uses 120s timeout for video uploads/recordings, 30s for general REST endpoints.
app.use((req, res, next) => {
  const url = (req.originalUrl || req.url || '').toLowerCase();
  const isUploadRoute = url.includes('/upload') || url.includes('/recordings') || url.includes('/media');
  const timeoutMs = isUploadRoute ? 60000 : 30000;

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



// â”€â”€ Health Check Endpoints (Lightweight, stateless, Render load balancer compatible) â”€â”€
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
  });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    success: true,
    message: 'Server is awake',
    timestamp: Date.now(),
  });
});
app.get('/api/v1/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
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


// Routes
const authRoutes = require('./routes/authRoutes');
const adminAuthRoutes = require('./routes/adminAuthRoutes');

// â”€â”€ Public Authentication Endpoints (Strictly public, NO auth middleware) â”€â”€â”€
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
app.use('/api/s3-upload', require('./routes/s3UploadRoutes'));

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



const unaniSubscriptionRoutes = require('./src/unani/subscriptions/routes/unaniSubscription.routes');
app.use(unaniSubscriptionRoutes);

const studentFacultyRoutes = require('./routes/studentFacultyRoutes');
app.use('/api/student/faculty', studentFacultyRoutes);
app.use('/api/v1/student/faculty', studentFacultyRoutes);

// Student curriculum and progress routes
app.use('/api/student', require('./routes/studentCurriculumRoutes'));
app.use('/api/v1/student', require('./routes/studentCurriculumRoutes'));

// Student self-service profile and management routes
const studentProfileRoutes = require('./routes/studentRoutes');
app.use('/api/students', studentProfileRoutes);
app.use('/api/v1/students', studentProfileRoutes);
app.use('/api/student', studentProfileRoutes);
app.use('/api/v1/student', studentProfileRoutes);
app.use('/api/admin/students', require('./routes/adminStudentRoutes'));
app.use('/api/v1/admin/students', require('./routes/adminStudentRoutes'));

const rankImageRoutes = require('./routes/academicExamRankImage.routes');
app.use('/api/exams', rankImageRoutes);
app.use('/api/v1/exams', rankImageRoutes);

const examRoutes = require('./routes/exam.routes');
app.use(examRoutes);
const studentExamRoutes = require('./src/student/student.routes');
app.use(studentExamRoutes);
const adminExamRoutes = require('./src/admin/admin.routes');
app.use(adminExamRoutes);
const unaniExamRoutes = require('./src/unani/exams/routes/unaniExam.routes');
app.use(unaniExamRoutes);
const unaniRankRoutes = require('./src/unani/ranks/routes/unaniRank.routes');
app.use(unaniRankRoutes);

const facultyRoutes = require('./routes/facultyRoutes');
app.use('/api/faculty', facultyRoutes);
app.use('/api/v1/faculty', facultyRoutes);
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
      console.log(`ðŸš€ Server running on port ${PORT}`);
    });

    // Normal requests are capped by middleware at 30s; route-level response
    // timeouts allow uploads/extraction up to 60s. Do not leave a 10-minute
    // global socket timeout that masks stalled database work.
    server.timeout = 35000;
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;

    // Graceful Shutdown Handler for Render horizontal scaling
    const mongoose = require('mongoose');
    const handleGracefulShutdown = (signal) => {
      console.log(`\nðŸ›‘ [${signal}] Graceful shutdown initiated. Closing HTTP server...`);
      server.close(async () => {
        console.log(`âœ… [${signal}] HTTP server closed. Closing MongoDB connection pool...`);
        try {
          await mongoose.connection.close(false);
          console.log(`âœ… [${signal}] MongoDB connection closed cleanly.`);
          process.exit(0);
        } catch (err) {
          console.error(`âŒ [${signal}] Error closing MongoDB connection:`, err.message);
          process.exit(1);
        }
      });

      // Force exit after 10s if connections refuse to close in time
      setTimeout(() => {
        console.error(`âš ï¸ [${signal}] Forced shutdown after 10s timeout.`);
        process.exit(1);
      }, 10000).unref();
    };

    process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
  } catch (error) {
    console.error('âŒ Server startup failed:', error.message);
    process.exit(1);
  }
};

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
