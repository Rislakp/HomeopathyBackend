const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function searchVideo2() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const collections = await db.listCollections().toArray();
  console.log('Collections in database:', collections.map(c => c.name));

  for (const col of collections) {
    const name = col.name;
    const docs = await db.collection(name).find({
      $or: [
        { title: { $regex: /video2/i } },
        { lessonTitle: { $regex: /video2/i } },
        { name: { $regex: /video2/i } },
        { 'modules.lessons.lessonTitle': { $regex: /video2/i } },
        { 'modules.lessons.title': { $regex: /video2/i } },
      ]
    }).toArray();
    if (docs.length > 0) {
      console.log(`\nFound ${docs.length} doc(s) in collection "${name}" matching "video2":`);
      for (const d of docs) {
        console.log(`  ID: ${d._id}`);
        if (d.title) console.log(`  title: ${d.title}`);
        if (d.lessonTitle) console.log(`  lessonTitle: ${d.lessonTitle}`);
        if (d.courseTitle) console.log(`  courseTitle: ${d.courseTitle}`);
        if (d.modules) {
          for (const m of d.modules) {
            for (const l of m.lessons || []) {
              const lt = l.lessonTitle || l.title || l.name;
              if (/video/i.test(lt)) {
                console.log(`    Lesson: ID=${l._id} title="${lt}" type="${l.lessonType || l.type}" s3Key="${l.s3Key}" videoParts=${l.videoParts?.length}`);
              }
            }
          }
        }
      }
    }
  }

  await mongoose.disconnect();
}

searchVideo2().catch(console.error);
