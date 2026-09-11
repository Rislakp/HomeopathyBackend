require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const Student = require('../models/Student');

/**
 * Migration Script: Safely migrates existing database users from legacy boolean
 * flags (isAdmin: true/false) or missing role fields to proper RBAC roles.
 */
async function migrateUserRoles() {
  const isDryRun = process.argv.includes('--dry-run');

  console.log('==================================================');
  console.log(`Starting RBAC User Role Migration ${isDryRun ? '(DRY RUN)' : ''}...`);
  console.log('==================================================');

  try {
    await connectDB();

    const users = await User.find({}).lean();
    console.log(`Found ${users.length} total user records to evaluate.`);

    let migratedCount = 0;
    let unchangedCount = 0;
    const validRoles = ['student', 'admin', 'superadmin', 'teacher', 'staff'];

    for (const user of users) {
      let newRole = user.role ? user.role.toString().toLowerCase().trim() : null;
      let reason = 'Already valid';

      // Check legacy boolean flags
      if (user.isAdmin === true || user.is_admin === true) {
        newRole = 'admin';
        reason = 'Migrated from isAdmin=true';
      } else if (!newRole || !validRoles.includes(newRole)) {
        newRole = 'student';
        reason = 'Defaulted missing/invalid role to student';
      }

      if (user.role !== newRole) {
        console.log(`[MIGRATE] User: ${user.email} (${user._id}) -> Old Role: '${user.role}' | New Role: '${newRole}' (${reason})`);
        if (!isDryRun) {
          await User.updateOne({ _id: user._id }, { $set: { role: newRole } });

          // If role is student, ensure a Student profile exists
          if (newRole === 'student') {
            const studentExists = await Student.findOne({
              $or: [{ userId: user._id }, { email: user.email }],
            });
            if (!studentExists) {
              await Student.create({
                userId: user._id,
                name: user.name,
                email: user.email,
                phone: user.phone || user.contactNumber || '',
                contactNumber: user.contactNumber || user.phone || '',
                dateOfBirth: user.dateOfBirth || '',
                qualification: user.qualification || '',
                course: 'General',
                subscription: 'Free',
                status: 'Active',
                joinedDate: user.createdAt || new Date(),
              });
              console.log(`  -> Synced student profile for ${user.email}`);
            }
          }
        }
        migratedCount++;
      } else {
        unchangedCount++;
      }
    }

    console.log('\n==================================================');
    console.log(`Migration Complete:`);
    console.log(`- Total users evaluated : ${users.length}`);
    console.log(`- Migrated / Updated    : ${migratedCount}`);
    console.log(`- Unchanged (Already OK): ${unchangedCount}`);
    console.log('==================================================\n');

    process.exit(0);
  } catch (error) {
    console.error('Migration failed with error:', error);
    process.exit(1);
  }
}

migrateUserRoles();
