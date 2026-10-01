const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const students = await mongoose.connection.db.collection('students').find({
    $or: [
      { subscriptionPlanId: { $exists: true, $ne: null } },
      { subscription: { $exists: true, $ne: null } },
      { unaniSubscriptionId: { $exists: true, $ne: null } }
    ]
  }).toArray();
  console.log('Students with subscription info count:', students.length);
  if (students.length > 0) {
    console.log('Sample student subscription fields:', {
      _id: students[0]._id,
      name: students[0].name,
      subscription: students[0].subscription,
      subscriptionPlanId: students[0].subscriptionPlanId,
      subscriptionStatus: students[0].subscriptionStatus,
      courseId: students[0].courseId,
      course: students[0].course
    });
  }
  process.exit(0);
}
check().catch(console.error);
