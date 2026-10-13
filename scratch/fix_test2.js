const fs = require('fs');
let c = fs.readFileSync('tests/s3-media.test.js', 'utf8');

function fixMock(str) {
  // It replaces: Student.findOne = () => ({ lean: async () => null });
  // with a promise that resolves to the object, but also has .lean()
  return str.replace(/Student\.findOne = \(\) => \(\{ lean: async \(\) => null \}\);/g, 
    "Student.findOne = () => { const p = Promise.resolve(null); p.lean = async () => null; return p; };"
  );
}

c = fixMock(c);

c = c.replace(
  "  Student.findOne = () => ({ lean: async () => ({\r\n    courseId: 'CRS-123', status: 'Active', subscriptionStatus: 'Active', email: 'learner@example.test'\r\n  }) });",
  "  Student.findOne = () => { const p = Promise.resolve({ courseId: 'CRS-123', status: 'Active', subscriptionStatus: 'Active', email: 'learner@example.test' }); p.lean = async () => await p; return p; };"
);

// also for the single line version if it was formatted that way:
c = c.replace(
  "  Student.findOne = () => ({ lean: async () => ({ courseId: 'CRS-123', status: 'Active', subscriptionStatus: 'Active', email: 'learner@example.test' }) });",
  "  Student.findOne = () => { const p = Promise.resolve({ courseId: 'CRS-123', status: 'Active', subscriptionStatus: 'Active', email: 'learner@example.test' }); p.lean = async () => await p; return p; };"
);

c = c.replace(
  "  Student.findOne = () => ({ lean: async () => ({\r\n    courseId: 'CRS-REG-6',\r\n    status: 'Active',\r\n    subscriptionStatus: 'Active',\r\n    email: 'student@example.test',\r\n  }) });",
  "  Student.findOne = () => { const p = Promise.resolve({ courseId: 'CRS-REG-6', status: 'Active', subscriptionStatus: 'Active', email: 'student@example.test' }); p.lean = async () => await p; return p; };"
);
c = c.replace(
  "  Student.findOne = () => ({ lean: async () => ({\n    courseId: 'CRS-REG-6',\n    status: 'Active',\n    subscriptionStatus: 'Active',\n    email: 'student@example.test',\n  }) });",
  "  Student.findOne = () => { const p = Promise.resolve({ courseId: 'CRS-REG-6', status: 'Active', subscriptionStatus: 'Active', email: 'student@example.test' }); p.lean = async () => await p; return p; };"
);

fs.writeFileSync('tests/s3-media.test.js', c);
console.log('Fixed s3-media.test.js mocks');
