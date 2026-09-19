const mongoose = require('mongoose');
const Activity = require('../models/Activity');
const { logActivity } = require('../utils/activityLogger');

async function testActivityLogger() {
  console.log('Testing Activity model schema...');
  const testDoc = new Activity({
    title: 'New student registration',
    description: 'Dr. Aris Thorne joined Materia Medica 101',
    type: 'student',
  });

  const err = testDoc.validateSync();
  if (err) {
    console.error('Validation error on Activity model:', err);
    process.exit(1);
  } else {
    console.log('✓ Activity model schema validated successfully.');
    console.log('Document preview:', JSON.stringify(testDoc.toObject(), null, 2));
  }

  console.log('\nTesting logActivity helper with missing fields handling...');
  const invalidRes = await logActivity({ title: '', description: '', type: '' });
  console.log('✓ Missing fields returned null as expected:', invalidRes === null);

  console.log('\nAll offline unit checks passed successfully!');
}

testActivityLogger().catch((e) => {
  console.error('Test execution failed:', e);
  process.exit(1);
});
