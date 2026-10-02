const mongoose = require('mongoose');
require('dotenv').config();

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/whitecoat';

async function inspect() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');
  const db = mongoose.connection.db;

  const ranks = await db.collection('unaniranks').find({}).toArray();
  console.log('Total unaniranks:', ranks.length);
  ranks.forEach((r, i) => {
    console.log(`Rank #${i + 1}: name="${r.name}", profileImage="${r.profileImage}", s3Key="${r.s3Key || ''}"`);
  });

  const reviews = await db.collection('unanireviews').find({}).toArray();
  console.log('\nTotal unanireviews:', reviews.length);
  reviews.forEach((r, i) => {
    console.log(`Review #${i + 1}: name="${r.name}", profileImage="${r.profileImage}", s3Key="${r.s3Key || ''}"`);
  });

  await mongoose.disconnect();
}

inspect().catch(console.error);
