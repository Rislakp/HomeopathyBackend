const mongoose = require('mongoose');
require('dotenv').config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');
  const collections = await mongoose.connection.db.listCollections().toArray();
  console.log('Collections count:', collections.length);

  const affectedSummary = [];

  for (const collInfo of collections) {
    const collName = collInfo.name;
    const coll = mongoose.connection.db.collection(collName);

    // Scan all documents in collection and inspect strings recursively
    const cursor = coll.find({});
    let matchCount = 0;

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      const str = JSON.stringify(doc);
      if (str.includes('/uploads/')) {
        matchCount++;
        // find specific paths
        findUploads(doc, collName, doc._id, doc.courseId || doc.title || '');
      }
    }
    if (matchCount > 0) {
      affectedSummary.push({ collection: collName, count: matchCount });
    }
  }

  console.log('\n--- Scan Complete Summary ---');
  console.log(JSON.stringify(affectedSummary, null, 2));
  await mongoose.disconnect();
}

function findUploads(obj, collName, docId, docLabel, path = '') {
  if (!obj || typeof obj !== 'object') return;
  for (const [key, value] of Object.entries(obj)) {
    const currPath = path ? `${path}.${key}` : key;
    if (typeof value === 'string') {
      if (value.includes('/uploads/')) {
        console.log(`[MATCH] Coll: ${collName} | Doc: ${docId} (${docLabel}) | Path: ${currPath} | Value: ${value}`);
      }
    } else if (typeof value === 'object') {
      findUploads(value, collName, docId, docLabel, currPath);
    }
  }
}

run().catch(console.error);
