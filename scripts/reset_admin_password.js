require('dotenv').config();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Admin = require('../models/admin.model');

const ADMIN_EMAIL = 'admin@whitecodeacademy.com';
const ADMIN_PASSWORD = 'WhiteCode@Admin2026';

async function resetAdminPassword() {
  try {
    await connectDB();

    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    const admin = await Admin.findOneAndUpdate(
      { email: ADMIN_EMAIL },
      { $set: { password: passwordHash, role: 'SUPERADMIN', isActive: true } },
      { new: true }
    );

    if (!admin) {
      throw new Error(`Admin account not found: ${ADMIN_EMAIL}`);
    }

    console.log(`Password reset successfully for ${ADMIN_EMAIL}`);
  } finally {
    await mongoose.disconnect();
  }
}

resetAdminPassword().catch((error) => {
  console.error('Admin password reset failed:', error.message);
  process.exitCode = 1;
});
