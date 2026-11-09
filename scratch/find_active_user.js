const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const u = await mongoose.connection.db.collection('users').find({ role: { $in: ['admin', 'superadmin'] } }).toArray();
  for (const user of u) {
    console.log({ email: user.email, name: user.name, role: user.role });
  }
  const activeStudents = await mongoose.connection.db.collection('students').find({ status: 'Active' }).limit(3).toArray();
  for (const s of activeStudents) {
    console.log('Active student:', { email: s.email, name: s.name, course: s.course, courseId: s.courseId, courseIds: s.courseIds });
  }
  process.exit(0);
}
check();

