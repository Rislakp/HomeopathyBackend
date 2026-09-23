const mongoose = require('mongoose');
require('dotenv').config();

const uri = process.env.MONGODB_URI || 'mongodb+srv://rizlaah01_db_user:j8qWhyvSFCBQbnBg@cluster0.fhwuccm.mongodb.net/homeopathy_db?retryWrites=true&w=majority';

async function run() {
  await mongoose.connect(uri);
  console.log('Connected to DB');
  
  const Course = mongoose.model('Course', new mongoose.Schema({}, { strict: false }));
  const ContentItemProgress = mongoose.model('ContentItemProgress', new mongoose.Schema({}, { strict: false }));
  const CourseProgress = mongoose.model('CourseProgress', new mongoose.Schema({}, { strict: false }));
  const Student = mongoose.model('Student', new mongoose.Schema({}, { strict: false }));

  const courses = await Course.find({ title: { $regex: 'demo', $options: 'i' } }).lean();
  console.log('=== COURSES FOUND ===', courses.length);
  for (const c of courses) {
    console.log('Course ID:', c._id, 'Custom ID:', c.courseId, 'Title:', c.title);
    if (c.modules) {
      console.log('Modules count:', c.modules.length);
      for (const m of c.modules) {
        console.log('  Module:', m._id, m.title || m.name);
        if (m.lessons) {
          console.log('    Lessons count:', m.lessons.length);
          for (const l of m.lessons) {
            console.log('      Lesson:', l._id, l.title || l.name, 'lessonType:', l.lessonType);
            console.log('        videoParts:', JSON.stringify(l.videoParts));
            console.log('        pdfNotes:', JSON.stringify(l.pdfNotes));
            console.log('        assignments:', JSON.stringify(l.assignments));
            console.log('        attachments:', JSON.stringify(l.attachments));
            console.log('        videoUrl:', l.videoUrl, 'mediaUrlOrPath:', l.mediaUrlOrPath);
          }
        }
      }
    }
  }

  const allCIP = await ContentItemProgress.find({}).sort({ updatedAt: -1 }).limit(10).lean();
  console.log('=== LATEST ContentItemProgress count ===', allCIP.length);
  for (const cip of allCIP) {
    console.log('CIP:', JSON.stringify(cip, null, 2));
  }

  const allCP = await CourseProgress.find({}).sort({ updatedAt: -1 }).limit(5).lean();
  console.log('=== LATEST CourseProgress count ===', allCP.length);
  for (const cp of allCP) {
    console.log('CP:', JSON.stringify(cp, null, 2));
  }

  const students = await Student.find({}).lean();
  console.log('=== STUDENTS ===', students.map(s => ({ id: s._id, name: s.name, email: s.email })));

  await mongoose.disconnect();
}
run().catch(console.error);
