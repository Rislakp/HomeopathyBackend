const mongoose = require('mongoose');
require('dotenv').config({ path: 'c:/Users/admin/StudioProjects/HomeopathyBackend/.env' });

const uri = process.env.MONGODB_URI || 'mongodb+srv://developer:WhiteCoatDev2026@cluster0.b7u2w.mongodb.net/homeopathy?retryWrites=true&w=majority&appName=Cluster0';

async function check() {
  await mongoose.connect(uri);
  const ids = [
    '6ad4c0601d1d06b448ce3785',
    '6adf190d2cea39ee852c3d07',
    '6adf08c82cea39ee852c25b0',
    '6adf1afb2cea39ee852c3ed9',
    '6ae316590cb975b06f54689e'
  ];

  const courses = await mongoose.connection.db.collection('courses').find({
    'modules.lessons._id': { $in: ids.map(id => new mongoose.Types.ObjectId(id)) }
  }).toArray();

  console.log(`Found ${courses.length} courses containing target lessons.`);
  for (const c of courses) {
    for (const m of (c.modules || [])) {
      for (const l of (m.lessons || [])) {
        if (ids.includes(l._id.toString())) {
          console.log(`- Lesson: ${l._id} (${l.title})`);
          console.log(`  meetingUrl: "${l.meetingUrl}"`);
          console.log(`  pdfNotes: ${(l.pdfNotes || []).length} items`);
          console.log(`  videoParts: ${(l.videoParts || []).length} items`);
        }
      }
    }
  }
  await mongoose.disconnect();
}

check().catch(console.error);

