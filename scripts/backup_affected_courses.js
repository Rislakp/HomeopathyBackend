const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function backup() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Course = require('../models/Course');
  const courseIds = ['CRS-000040', 'CRS-000041', 'CRS-000042', 'CRS-000070'];
  const courses = await Course.find({ courseId: { $in: courseIds } }).lean();
  
  const backupDir = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, 'courses_backup_' + timestamp + '.json');
  fs.writeFileSync(backupFile, JSON.stringify(courses, null, 2));
  console.log('Successfully backed up ' + courses.length + ' courses to: ' + backupFile);
  await mongoose.disconnect();
}
backup().catch(console.error);
