const mongoose = require('mongoose');
const Course = require('../models/Course');

async function testCourseModel() {
  const courseDoc = new Course({
    courseBanner: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d',
    courseTitle: 'Advanced Materia Medica & Clinical Practice',
    instructor: 'Dr. A. K. Sharma',
    price: 4999,
    courseDescription: 'Comprehensive overview of polycrest remedies, potencies, and clinical posology.',
    status: 'Published',
    modules: [
      {
        moduleName: 'Module 1 — Introduction to Homeopathy',
        lessons: [
          {
            lessonTitle: 'Understanding Miasms in Practice',
            lessonType: 'Live Class',
            fileOrLink: 'https://whitecoat.academy/live/miasms-101',
          },
          {
            lessonTitle: 'Organon Aphorisms 1-20 Summary Notes',
            lessonType: 'PDF Notes',
            fileOrLink: 'https://whitecoat.academy/notes/organon-aph-1-20.pdf',
          },
        ],
      },
    ],
  });

  const err = courseDoc.validateSync();
  if (err) {
    console.error('Validation error:', err);
    process.exit(1);
  }

  console.log('✅ Course schema validation passed!');
  console.log('Course Title:', courseDoc.courseTitle);
  console.log('Instructor:', courseDoc.instructor);
  console.log('Price:', courseDoc.price);
  console.log('Modules Count:', courseDoc.modules.length);
  console.log('First Module Name:', courseDoc.modules[0].moduleName);
  console.log('Lessons in Module 1:', courseDoc.modules[0].lessons.length);
  console.log('First Lesson Title:', courseDoc.modules[0].lessons[0].lessonTitle);
  console.log('First Lesson Type:', courseDoc.modules[0].lessons[0].lessonType);
}

testCourseModel();
