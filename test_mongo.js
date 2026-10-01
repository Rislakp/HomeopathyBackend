const mongoose = require('mongoose');
require('dotenv').config({ path: 'C:/Users/admin/StudioProjects/HomeopathyBackend/.env' });

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const recordings = await db.collection('liverecords').find({ recordingFileUrl: { $ne: null } }).sort({ createdAt: -1 }).limit(1).toArray();
  console.log(JSON.stringify(recordings, null, 2));
  mongoose.disconnect();
}
run();
