const mongoose = require('mongoose');
require('dotenv').config({ path: 'C:/Users/admin/StudioProjects/HomeopathyBackend/.env' });
const { serializeLesson } = require('./controllers/courseController');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const course = await db.collection('courses').findOne({ _id: new mongoose.Types.ObjectId("6aab7ed254d18fda4f673a08") });
  const mod = course.modules.find(m => m._id.toString() === "6ac5de18e8a3829089c9ecbd");
  const les = mod.lessons.find(l => l._id.toString() === "6ac5de3ce8a3829089c9edc1");

  console.log("Raw Lesson in DB:", JSON.stringify(les, null, 2));

  const serialized = await serializeLesson(les, { user: { role: 'admin' } });
  console.log("\nSerialized Lesson:", JSON.stringify(serialized, null, 2));

  await mongoose.disconnect();
}
run();

