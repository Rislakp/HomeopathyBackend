const fs = require('fs');
let c = fs.readFileSync('tests/s3-media.test.js', 'utf8');
c = c.replace(
  "  Student.findOne = async () => ({\r\n    courseId: 'CRS-REG-6',\r\n    status: 'Active',\r\n    subscriptionStatus: 'Active',\r\n    email: 'student@example.test',\r\n  });",
  "  Student.findOne = () => ({ lean: async () => ({\r\n    courseId: 'CRS-REG-6',\r\n    status: 'Active',\r\n    subscriptionStatus: 'Active',\r\n    email: 'student@example.test',\r\n  }) });"
);
c = c.replace(
  "  Student.findOne = async () => ({\n    courseId: 'CRS-REG-6',\n    status: 'Active',\n    subscriptionStatus: 'Active',\n    email: 'student@example.test',\n  });",
  "  Student.findOne = () => ({ lean: async () => ({\n    courseId: 'CRS-REG-6',\n    status: 'Active',\n    subscriptionStatus: 'Active',\n    email: 'student@example.test',\n  }) });"
);
fs.writeFileSync('tests/s3-media.test.js', c);
