const { normalizeTestType } = require('../controllers/exam.controller');

function testNormalization() {
  console.log('Testing normalizeTestType function across variations...');

  const testCases = [
    { input: 'Course Test', expected: 'course_test' },
    { input: 'course-test', expected: 'course_test' },
    { input: 'course_test', expected: 'course_test' },
    { input: 'COURSE TEST', expected: 'course_test' },
    { input: 'Grand Mock', expected: 'grand_mock' },
    { input: 'grand-mock', expected: 'grand_mock' },
    { input: 'grand_mock', expected: 'grand_mock' },
    { input: undefined, expected: 'grand_mock' },
    { input: null, expected: 'grand_mock' },
    { input: '', expected: 'grand_mock' },
    { input: 'random_string', expected: 'grand_mock' },
  ];

  for (const tc of testCases) {
    const result = normalizeTestType(tc.input);
    console.log(`  Input: "${tc.input}" → Normalized: "${result}" (Expected: "${tc.expected}")`);
    if (result !== tc.expected) {
      throw new Error(`Failed for input: "${tc.input}". Expected "${tc.expected}", got "${result}"`);
    }
  }

  console.log('\n✅ ALL NORMALIZATION TEST CASES PASSED SUCCESSFULLY!');
}

try {
  testNormalization();
} catch (err) {
  console.error('Test Failed:', err);
  process.exit(1);
}
