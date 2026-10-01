const mongoose = require('mongoose');
require('dotenv').config();

const uri = process.env.MONGODB_URI || 'mongodb+srv://rizlaah01_db_user:j8qWhyvSFCBQbnBg@cluster0.fhwuccm.mongodb.net/homeopathy_db?retryWrites=true&w=majority';

async function run() {
  await mongoose.connect(uri);
  const ContentItemProgress = mongoose.model('ContentItemProgress', new mongoose.Schema({}, { strict: false }));
  const docs = await ContentItemProgress.find({ courseId: new mongoose.Types.ObjectId('6aa7d55338f6fbef4dd6d1f6') }).lean();
  console.log('Docs count for course:', docs.length);
  for (const d of docs) {
    console.log(d);
  }
  await mongoose.disconnect();
}
run().catch(console.error);
