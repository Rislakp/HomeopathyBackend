const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function searchHash() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const collections = await db.listCollections().toArray();
  for (const col of collections) {
    const colName = col.name;
    const docs = await db.collection(colName).find({}).toArray();
    for (const doc of docs) {
      const str = JSON.stringify(doc);
      if (str.includes('1794378345794')) {
        console.log(`FOUND 1794378345794 in collection: ${colName}, doc _id: ${doc._id}`);
        console.log('Doc preview:', str.substring(0, 300));
      }
    }
  }

  await mongoose.disconnect();
}

searchHash().catch(console.error);
