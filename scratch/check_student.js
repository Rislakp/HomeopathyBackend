const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
let Student;
try { Student = require('../models/Student'); } catch (e) {}
let Course;
try { Course = require('../models/Course'); } catch (e) {}

async function checkStudent() {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/homeopathy';
    console.log('Connecting to MongoDB at:', mongoUri);
    await mongoose.connect(mongoUri);

    const studentId = '6a829d425eb381105ab54c66';
    console.log('\n--- LOOKING UP STUDENT BY ID:', studentId, '---');

    // Check Student model
    if (Student) {
      const studentDoc = await Student.findById(studentId);
      console.log('Student document by _id:');
      console.log(studentDoc ? JSON.stringify(studentDoc.toObject(), null, 2) : 'NOT FOUND');
    }

    // Check User model
    const userDoc = await User.findById(studentId);
    console.log('User document by _id:');
    console.log(userDoc ? JSON.stringify(userDoc.toObject(), null, 2) : 'NOT FOUND');

    // Search by studentId in Student model or User model or search by name "students"
    console.log('\n--- SEARCHING FOR ALL STUDENTS WITH NAME "students" OR EMAIL / USERID ---');
    if (Student) {
      const studentsByName = await Student.find({ name: /students/i });
      console.log('Students by name matching "students":', JSON.stringify(studentsByName, null, 2));
    }

    const usersByName = await User.find({ name: /students/i });
    console.log('Users by name matching "students":', JSON.stringify(usersByName, null, 2));

    // Also list Courses in DB
    if (Course) {
      const courses = await Course.find({});
      console.log('\n--- ALL COURSES IN DB ---');
      console.log(courses.map(c => ({ id: c._id.toString(), courseId: c.courseId, courseTitle: c.courseTitle, title: c.title })));
    }

    await mongoose.disconnect();
  } catch (err) {
    console.error('Error checking student:', err);
    process.exit(1);
  }
}

checkStudent();
