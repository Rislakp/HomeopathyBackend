const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function checkVideoConversions() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const list = await db.collection('videoconversions').find({}).sort({ createdAt: -1 }).toArray();
  console.log(`videoconversions count: ${list.length}`);
  for (const vc of list) {
    console.log(`_id: ${vc._id} | originalS3Key: ${vc.originalS3Key} | status: ${vc.status} | m4vS3Key: ${vc.m4vS3Key} | createdAt: ${vc.createdAt}`);
  }

  await mongoose.disconnect();
}

checkVideoConversions().catch(console.error);
