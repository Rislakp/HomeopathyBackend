const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const dbUri = process.env.USE_LOCAL_DB === 'true'
      ? process.env.MONGODB_LOCAL_URI
      : (process.env.MONGODB_URI || process.env.MONGO_URI);

    await mongoose.connect(dbUri);

    console.log('✅ MongoDB Connected');
  } catch (error) {
    console.error('❌ MongoDB Connection Failed');
    console.error(error.message);
    process.exit(1);
  }
};

module.exports = connectDB;