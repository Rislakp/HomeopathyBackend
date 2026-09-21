const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const dbUri = process.env.USE_LOCAL_DB === 'true'
      ? process.env.MONGODB_LOCAL_URI
      : (process.env.MONGODB_URI || process.env.MONGO_URI);

    // Guard: fail fast if the URI is missing instead of hanging forever
    if (!dbUri) {
      console.error('❌ MongoDB Connection Failed: No database URI configured.');
      console.error('   Set MONGODB_URI in your .env (or USE_LOCAL_DB=true with MONGODB_LOCAL_URI).');
      process.exit(1);
    }

    const isLocal = process.env.USE_LOCAL_DB === 'true';
    console.log(`🔌 Connecting to MongoDB (${isLocal ? 'LOCAL' : 'ATLAS'})...`);

    await mongoose.connect(dbUri, {
      // Fail after 15 seconds if the DB is unreachable instead of hanging
      // indefinitely. This prevents the Render server from getting stuck
      // in a state where it never starts listening on its PORT.
      serverSelectionTimeoutMS: 15000,
    });

    console.log('✅ MongoDB Connected');
  } catch (error) {
    console.error('❌ MongoDB Connection Failed');
    console.error(error.message);
    process.exit(1);
  }
};

module.exports = connectDB;