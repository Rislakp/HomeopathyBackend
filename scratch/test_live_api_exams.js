const jwt = require('jsonwebtoken');
const https = require('https');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: 'C:/Users/admin/StudioProjects/HomeopathyBackend/.env' });

const JWT_SECRET = process.env.JWT_SECRET;

async function request(url, token) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Origin': 'https://student.whitecoat.academy'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const Student = mongoose.model('Student', new mongoose.Schema({}, { strict: false }));
  const student = await Student.findOne({ accountStatus: { $in: ['Approved', 'Active'] } }).lean();

  if (!student) {
    console.log('No approved student found');
    return;
  }

  console.log(`Using student: ${student.email || student.name} (id: ${student._id}, userId: ${student.userId})`);

  const tokenPayload = {
    id: student.userId ? student.userId.toString() : student._id.toString(),
    userId: student.userId ? student.userId.toString() : student._id.toString(),
    studentId: student._id.toString(),
    email: student.email,
    role: 'student',
    status: 'Active',
    accountStatus: 'Approved'
  };

  const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '1h' });

  const examId = '6ac5d708e8a3829089c9ad8d'; // "demo questions"

  console.log('\n--- 1. Testing GET /api/student/exams/:id/start ---');
  const resStart = await request(`https://api.whitecoat.academy/api/student/exams/${examId}/start`, token);
  console.log('Status:', resStart.status);
  if (resStart.body?.data?.questions) {
    const q1 = resStart.body.data.questions[0];
    console.log('Question 1:');
    console.log('  Text:', q1.questionText);
    console.log('  imageUrl:', q1.imageUrl);
    console.log('  image:', q1.image);
  } else {
    console.log('Response body:', JSON.stringify(resStart.body, null, 2));
  }

  console.log('\n--- 2. Testing GET /api/exams/:id ---');
  const resExam = await request(`https://api.whitecoat.academy/api/exams/${examId}`, token);
  console.log('Status:', resExam.status);
  if (resExam.body?.data?.questions) {
    const q1 = resExam.body.data.questions[0];
    console.log('Question 1:');
    console.log('  Text:', q1.questionText);
    console.log('  imageUrl:', q1.imageUrl);
    console.log('  image:', q1.image);
  } else {
    console.log('Response body:', JSON.stringify(resExam.body, null, 2));
  }

  console.log('\n--- 3. Testing GET /api/student/exams/:id ---');
  const resStudentExam = await request(`https://api.whitecoat.academy/api/student/exams/${examId}`, token);
  console.log('Status:', resStudentExam.status);
  console.log('Response body:', JSON.stringify(resStudentExam.body, null, 2));

  await mongoose.disconnect();
}

main();
