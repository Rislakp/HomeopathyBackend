const mongoose = require('mongoose');
require('dotenv').config();

const uri = process.env.MONGODB_URI || 'mongodb+srv://rizlaah01_db_user:j8qWhyvSFCBQbnBg@cluster0.fhwuccm.mongodb.net/homeopathy_db?retryWrites=true&w=majority';

async function run() {
  await mongoose.connect(uri);
  const Course = mongoose.model('Course', new mongoose.Schema({}, { strict: false }));
  const c = await Course.findById('6aa7d55338f6fbef4dd6d1f6').lean();
  console.log('Course Title:', c.title, 'courseId:', c.courseId);
  console.log('Course Modules:', JSON.stringify(c.modules, null, 2));
  await mongoose.disconnect();
}
run().catch(console.error);
