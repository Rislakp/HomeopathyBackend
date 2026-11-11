const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function checkRecentActivities() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const activities = await db.collection('activities').find({}).sort({ timestamp: -1, createdAt: -1 }).limit(20).toArray();
  console.log(`Recent activities: ${activities.length}`);
  for (const a of activities) {
    console.log(JSON.stringify(a, null, 2));
  }

  await mongoose.disconnect();
}

checkRecentActivities().catch(console.error);
