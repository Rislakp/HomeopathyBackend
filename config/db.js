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

    const maxPoolSize = parseInt(process.env.DB_MAX_POOL_SIZE || '50', 10);
    const minPoolSize = parseInt(process.env.DB_MIN_POOL_SIZE || '5', 10);

    await mongoose.connect(dbUri, {
      // Production-safe connection pool settings for multi-instance Render scaling
      maxPoolSize,
      minPoolSize,
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
      family: 4, // Force IPv4 to prevent IPv6 DNS delays
    });

    console.log(`✅ MongoDB Connected cleanly (Pool size: ${minPoolSize} min / ${maxPoolSize} max)`);
  } catch (error) {
    console.error('❌ MongoDB Connection Failed');
    console.error(error.message);
    process.exit(1);
  }
};

module.exports = connectDB;
