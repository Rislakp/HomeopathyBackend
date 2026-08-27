const mongoose = require('mongoose');
const { downloadAnswerKey } = require('../src/student/answerKey.controller');
const Exam = require('../src/common/models/exam.model');

// Mock Express Response Object
function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    send(buffer) {
      this.body = buffer;
      return this;
    }
  };
  return res;
}

async function testHttpRoute() {
  console.log('--- STARTING HTTP CONTROLLER INTEGRATION TEST ---');

  // Mock Request Object
  const validObjectId = new mongoose.Types.ObjectId().toString();
  const mockReq = {
    params: { id: validObjectId },
    user: {
      id: 'student_123',
      userId: 'student_123',
      name: 'Dr. John Doe',
      email: 'john.doe@whitecoat.academy',
      role: 'student'
    }
  };

  // Mock Exam.findById using stub/mock
  const originalFindById = Exam.findById;
  Exam.findById = function (id) {
    return {
      lean() {
        return Promise.resolve({
          _id: id,
          title: 'Homoeopathic Materia Medica Exam',
          marksPerQuestion: 1,
          negativeMark: 0.25,
          durationMinutes: 45,
          totalQuestions: 1,
          questions: [
            {
              _id: 'q101',
              questionText: 'What is the keynote symptom of Arnica Montana?',
              options: {
                A: 'Sore, bruised feeling all over the body',
                B: 'Burning pain relieved by heat',
                C: 'Rapid onset of high fever',
                D: 'Extreme thirst for cold water'
              },
              correctOption: 'A'
            }
          ]
        });
      }
    };
  };

  try {
    const mockRes = createMockRes();
    await downloadAnswerKey(mockReq, mockRes);

    console.log(`HTTP Status Code: ${mockRes.statusCode}`);
    console.log('HTTP Response Headers:', mockRes.headers);

    let passed = true;

    if (mockRes.statusCode === 200) {
      console.log('✅ Status code 200 OK');
    } else {
      console.error('❌ Expected status code 200, got:', mockRes.statusCode);
      passed = false;
    }

    if (mockRes.headers['Content-Type'] === 'application/pdf') {
      console.log('✅ Content-Type header is application/pdf');
    } else {
      console.error('❌ Invalid Content-Type header:', mockRes.headers['Content-Type']);
      passed = false;
    }

    if (mockRes.headers['Content-Disposition'] === 'attachment; filename="answer-key-watermarked.pdf"') {
      console.log('✅ Content-Disposition header matches answer-key-watermarked.pdf');
    } else {
      console.error('❌ Invalid Content-Disposition header:', mockRes.headers['Content-Disposition']);
      passed = false;
    }

    if (Buffer.isBuffer(mockRes.body) && mockRes.body.length > 500) {
      console.log(`✅ Response body is a valid Buffer of size ${mockRes.body.length} bytes`);
    } else {
      console.error('❌ Invalid response body type/size:', mockRes.body);
      passed = false;
    }

    if (!passed) {
      console.error('❌ HTTP Controller Integration Test Failed!');
      process.exit(1);
    } else {
      console.log('\n🎉 HTTP CONTROLLER INTEGRATION TEST PASSED SUCCESSFULLY!');
    }
  } finally {
    // Restore original model method
    Exam.findById = originalFindById;
  }
}

testHttpRoute().catch((err) => {
  console.error('HTTP Test Error:', err);
  process.exit(1);
});
