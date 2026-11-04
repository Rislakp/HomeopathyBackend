const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function searchWebm() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB');

  const collections = await mongoose.connection.db.listCollections().toArray();
  for (const col of collections) {
    const name = col.name;
    const regex = /webm/i;
    try {
      const docs = await mongoose.connection.db.collection(name).find({}).toArray();
      const matches = [];
      for (const doc of docs) {
        const jsonStr = JSON.stringify(doc);
        if (regex.test(jsonStr)) {
          matches.push(doc);
        }
      }
      if (matches.length > 0) {
        console.log(`\n================== Collection: ${name} (Matches: ${matches.length}) ==================`);
        for (const m of matches) {
          console.log(`_id: ${m._id}`);
          if (m.title) console.log(`title: ${m.title}`);
          if (m.courseTitle) console.log(`courseTitle: ${m.courseTitle}`);
          if (m.courseId) console.log(`courseId: ${m.courseId}`);
          if (m.name) console.log(`name: ${m.name}`);
          
          // Print specific matching fields or modules/lessons
          const str = JSON.stringify(m, null, 2);
          const lines = str.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (/webm/i.test(lines[i])) {
              const start = Math.max(0, i - 3);
              const end = Math.min(lines.length, i + 4);
              console.log('--- Context ---');
              console.log(lines.slice(start, end).join('\n'));
            }
          }
        }
      }
    } catch (e) {
      console.log(`Error checking collection ${name}:`, e.message);
    }
  }

  await mongoose.disconnect();
}

searchWebm().catch(err => { console.error(err); process.exit(1); });

