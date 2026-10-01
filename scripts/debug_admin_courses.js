require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');

async function debugCourses() {
  console.log('--- DEBUGGING GET COURSES ---');
  await connectDB();
  const Course = require('../models/Course');
  try {
    console.log('Querying Course.find()...');
    const courses = await Course.find().select('-modules.lessons.videoParts -modules.lessons.pdfNotes -modules.lessons.assignments -modules.lessons.attachments').sort({ createdAt: -1 }).lean();
    console.log(`Fetched ${courses.length} courses from DB.`);

    const toAbsoluteUrl = (urlStr, req) => {
      if (typeof urlStr !== 'string') return '';
      const trimmed = urlStr.trim();
      if (!trimmed) return '';
      if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:')) return trimmed;
      return `https://homeopathybackend-1.onrender.com/${trimmed.replace(/^\/+/, '')}`;
    };

    const serialized = courses.map((course, idx) => {
      const rawBanner = typeof course.thumbnail === 'string' ? course.thumbnail : (course.thumbnail?.url || course.bannerUrl || course.courseBanner || '');
      const absoluteBanner = toAbsoluteUrl(rawBanner, null);
      const totalModules = Array.isArray(course.modules) ? course.modules.length : 0;
      return {
        _id: course._id.toString(),
        id: course.courseId || course._id.toString(),
        title: course.courseTitle || course.title || '',
        category: course.category || '',
        instructor: course.instructor || '',
        price: course.price || 0,
        status: course.status || 'Published',
        thumbnail: absoluteBanner,
        bannerUrl: absoluteBanner,
        totalModules,
      };
    });

    console.log(`Successfully serialized ${serialized.length} courses.`);
    console.log('Sample course:', serialized[0]);
    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('Debug error:', err);
    await mongoose.connection.close();
    process.exit(1);
  }
}

debugCourses();
