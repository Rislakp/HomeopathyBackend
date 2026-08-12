require('dotenv').config();

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