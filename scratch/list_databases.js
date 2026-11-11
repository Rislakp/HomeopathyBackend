const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function listDatabases() {
  const conn = await mongoose.connect(process.env.MONGODB_URI);
  const adminDb = mongoose.connection.db.admin();
  const dbs = await adminDb.listDatabases();
  console.log('Databases on Cluster0:', dbs.databases.map(d => `${d.name} (${d.sizeOnDisk} bytes)`));
  
  for (const dbInfo of dbs.databases) {
    if (['admin', 'local'].includes(dbInfo.name)) continue;
    const db = mongoose.connection.client.db(dbInfo.name);
    const collections = await db.listCollections().toArray();
    console.log(`\nDB "${dbInfo.name}" collections:`, collections.map(c => c.name));
    
    // Check if this DB has a courses collection with lessons named video or video2
    if (collections.some(c => c.name === 'courses')) {
      const courses = await db.collection('courses').find({}).toArray();
      for (const c of courses) {
        for (const m of c.modules || []) {
          for (const l of m.lessons || []) {
            const title = (l.lessonTitle || l.title || l.name || '').toLowerCase();
            if (title.includes('video')) {
              console.log(`  [${dbInfo.name}] Course: "${c.courseTitle || c.title}" (${c.courseId}) -> Lesson: "${l.lessonTitle || l.title}" (${l._id})`);
            }
          }
        }
      }
    }
  }

  await mongoose.disconnect();
}

listDatabases().catch(console.error);
