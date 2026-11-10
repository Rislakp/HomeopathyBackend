const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { s3Client, bucket } = require('../config/s3');
const { resolveProfileImageUrl, normalizeS3Reference, signS3Reference } = require('../utils/s3MediaSigner');
const studentController = require('../src/student/student.controller');
const examController = require('../controllers/examController');
const adminController = require('../src/admin/admin.controller');
const Exam = require('../models/Exam');
const TestResult = require('../src/common/models/testResult.model');
const Student = require('../models/Student');
const User = require('../models/User');

// Synthetic in-memory credentials for test process
const defaultCredentialProvider = s3Client.config.credentials;
s3Client.config.credentials = async () => ({
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
});
process.on('exit', () => { s3Client.config.credentials = defaultCredentialProvider; });

const makeResponse = () => {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
      return this;
    },
  };
  return res;
};

// Mock Exam with private grand_mock_questions image
const makeMockExam = (customFields = {}) => {
  const examId = new mongoose.Types.ObjectId();
  const qId = new mongoose.Types.ObjectId();
  return {
    _id: examId,
    title: 'Clinical Pathology Grand Mock',
    testType: 'grand_mock',
    status: 'Published',
    durationMinutes: 60,
    marksPerQuestion: 2,
    negativeMark: 0.5,
    negativeMarkPenalty: 0.5,
    questions: [
      {
        _id: qId,
        questionText: 'Identify the histological feature in the image:',
        imageUrl: 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/grand_mock_questions/1791350500726-demo-pathology-slide.png',
        options: {
          A: 'Granuloma',
          B: 'Caseous necrosis',
          C: 'Langhans giant cell',
          D: 'Foreign body giant cell'
        },
        correctOption: 'C',
        explanation: 'Langhans cells have horseshoe arrangement of nuclei.'
      }
    ],
    ...customFields
  };
};

// ==============================================================================
// 1. utils/s3MediaSigner supports grand_mock_questions/
// ==============================================================================

test('1. utils/s3MediaSigner: normalizes and signs grand_mock_questions/ S3 URLs', async () => {
  const rawUrl = 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/grand_mock_questions/1791350500726-demo-pathology-slide.png';
  const s3Ref = normalizeS3Reference(rawUrl);

  assert.ok(s3Ref, 'S3 reference must not be null');
  assert.equal(s3Ref.storageProvider, 's3');
  assert.equal(s3Ref.s3Key, 'grand_mock_questions/1791350500726-demo-pathology-slide.png');

  const signed = await resolveProfileImageUrl(rawUrl);
  assert.ok(signed.includes('X-Amz-Signature'), 'Signed URL must contain SigV4 signature');
  assert.ok(signed.includes('X-Amz-Algorithm=AWS4-HMAC-SHA256'), 'Signed URL must specify HMAC-SHA256 algorithm');
  assert.ok(signed.includes('response-content-disposition=inline'), 'Signed URL must specify inline disposition');
  assert.ok(signed.includes('response-content-type=image%2Fpng'), 'Signed URL must specify image/png MIME type');
});

// ==============================================================================
// 2. student.controller.js startExam signs question images & strips correctOption
// ==============================================================================

test('2. student.controller: startExam signs question images and protects answer keys', async (t) => {
  const origFindById = Exam.findById;
  const origFindOne = TestResult.findOne;
  const origStudentFindById = Student.findById;
  const origStudentFindOne = Student.findOne;
  const origStudentFind = Student.find;
  const origUserFindById = User.findById;
  const origUserFind = User.find;
  t.after(() => {
    Exam.findById = origFindById;
    TestResult.findOne = origFindOne;
    Student.findById = origStudentFindById;
    Student.findOne = origStudentFindOne;
    Student.find = origStudentFind;
    User.findById = origUserFindById;
    User.find = origUserFind;
  });

  const studentObjId = new mongoose.Types.ObjectId();
  const mockStudent = {
    _id: studentObjId,
    userId: studentObjId,
    accountStatus: 'Approved',
    status: 'Active',
    isApproved: true,
  };
  Student.findById = () => ({ lean: async () => mockStudent });
  Student.findOne = () => ({ lean: async () => mockStudent });
  Student.find = () => ({ lean: async () => [mockStudent] });
  User.findById = () => ({ select: () => ({ lean: async () => null }) });
  User.find = () => ({ lean: async () => [] });

  const mockExam = makeMockExam();
  Exam.findById = () => ({
    lean: async () => mockExam
  });
  TestResult.findOne = () => ({
    lean: async () => null
  });
  TestResult.create = async () => ({});

  const req = {
    params: { id: mockExam._id.toString() },
    user: {
      id: studentObjId.toString(),
      studentId: studentObjId.toString(),
      role: 'student',
      isApproved: true,
      accountStatus: 'Approved'
    }
  };
  const res = makeResponse();

  await studentController.startExam(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.ok(Array.isArray(res.body.data.questions), 'questions array returned');

  const q = res.body.data.questions[0];
  assert.ok(q.imageUrl.includes('X-Amz-Signature'), 'imageUrl must be SigV4 presigned');
  assert.ok(q.image.includes('X-Amz-Signature'), 'image field must match signed URL for Flutter');
  assert.ok(q.questionImage.includes('X-Amz-Signature'), 'questionImage field must match signed URL');
  assert.equal(q.correctOption, undefined, 'CRITICAL ANTI-CHEAT: correctOption must be stripped');
  assert.equal(q.explanation, undefined, 'CRITICAL ANTI-CHEAT: explanation must be stripped');
  assert.equal(q.questionText, 'Identify the histological feature in the image:');
});

// ==============================================================================
// 3. examController.js getGrandMockById signs images for both students and admins
// ==============================================================================

test('3. examController: getGrandMockById signs question images with role-based answer visibility', async (t) => {
  const origFindById = Exam.findById;
  const origStudentFindOne = Student.findOne;
  const origStudentFind = Student.find;
  const origUserFind = User.find;
  const origTestResultFind = TestResult.find;
  t.after(() => {
    Exam.findById = origFindById;
    Student.findOne = origStudentFindOne;
    Student.find = origStudentFind;
    User.find = origUserFind;
    TestResult.find = origTestResultFind;
  });

  const studentObjId = new mongoose.Types.ObjectId();
  const mockStudent = {
    _id: studentObjId,
    userId: studentObjId,
    accountStatus: 'Approved',
    status: 'Active',
    isApproved: true,
  };
  // examController.getGrandMockById calls Student.findOne WITHOUT .lean(), resolve directly
  Student.findOne = () => Promise.resolve(mockStudent);
  Student.find = () => ({ lean: async () => [mockStudent] });
  User.find = () => ({ lean: async () => [] });
  TestResult.find = () => ({ sort: () => ({ lean: async () => [] }) });

  const mockExam = makeMockExam();
  Exam.findById = () => ({
    lean: async () => mockExam
  });

  // A: Student request - use valid ObjectId so student auth check is triggered
  const studentReq = {
    params: { id: mockExam._id.toString() },
    user: { id: studentObjId.toString(), studentId: studentObjId.toString(), role: 'student' }
  };
  const studentRes = makeResponse();
  await examController.getGrandMockById(studentReq, studentRes);

  assert.equal(studentRes.statusCode, 200);
  const studentQ = studentRes.body.data.questions[0];
  assert.ok(studentQ.imageUrl.includes('X-Amz-Signature'), 'Student receives signed imageUrl');
  assert.ok(studentQ.image.includes('X-Amz-Signature'), 'Student receives signed image');
  assert.equal(studentQ.correctOption, undefined, 'Student never receives correctOption');

  // B: Admin request
  const adminReq = {
    params: { id: mockExam._id.toString() },
    user: { id: 'admin-1', role: 'admin' }
  };
  const adminRes = makeResponse();
  await examController.getGrandMockById(adminReq, adminRes);

  assert.equal(adminRes.statusCode, 200);
  const adminQ = adminRes.body.data.questions[0];
  assert.ok(adminQ.imageUrl.includes('X-Amz-Signature'), 'Admin receives signed imageUrl');
  assert.equal(adminQ.correctOption, 'C', 'Admin retains correctOption for authoring/review');
});


// ==============================================================================
// 4. adminController.js getGrandMockById signs question images
// ==============================================================================

test('4. adminController: getGrandMockById signs question images for admin management flow', async (t) => {
  const origFindById = Exam.findById;
  t.after(() => {
    Exam.findById = origFindById;
  });

  const mockExam = makeMockExam();
  Exam.findById = () => ({
    lean: async () => mockExam
  });

  const req = {
    params: { id: mockExam._id.toString() },
    user: { id: 'admin-1', role: 'admin' }
  };
  const res = makeResponse();

  await adminController.getGrandMockById(req, res);

  assert.equal(res.statusCode, 200);
  assert.ok(res.body.data.questions, 'questions array present');
  const q = res.body.data.questions[0];
  assert.ok(q.imageUrl.includes('X-Amz-Signature'), 'Admin receives signed imageUrl');
  assert.ok(q.image.includes('X-Amz-Signature'), 'Admin receives signed image');
});

// ==============================================================================
// 5. student.controller.js submitExam returns signed examInfo questions
// ==============================================================================

test('5. student.controller: submitExam evaluates score and returns signed question images', async (t) => {
  const origFindById = Exam.findById;
  const origFind = TestResult.find;
  const origFindOneAndUpdate = TestResult.findOneAndUpdate;
  const origStudentFindById = Student.findById;
  const origStudentFindOne = Student.findOne;
  const origStudentFind = Student.find;
  const origUserFindById = User.findById;
  const origUserFind = User.find;
  t.after(() => {
    Exam.findById = origFindById;
    TestResult.find = origFind;
    TestResult.findOneAndUpdate = origFindOneAndUpdate;
    Student.findById = origStudentFindById;
    Student.findOne = origStudentFindOne;
    Student.find = origStudentFind;
    User.findById = origUserFindById;
    User.find = origUserFind;
  });

  const studentObjId = new mongoose.Types.ObjectId();
  const mockStudent = {
    _id: studentObjId,
    userId: studentObjId,
    accountStatus: 'Approved',
    status: 'Active',
    isApproved: true,
  };
  Student.findById = () => ({ lean: async () => mockStudent });
  Student.findOne = () => ({ lean: async () => mockStudent });
  Student.find = () => ({ lean: async () => [mockStudent] });
  User.findById = () => ({ select: () => ({ lean: async () => null }) });
  User.find = () => ({ lean: async () => [] });

  const mockExam = makeMockExam();
  Exam.findById = () => ({
    lean: async () => mockExam
  });

  const inProgressId = new mongoose.Types.ObjectId();
  TestResult.find = () => ({
    sort: () => [{
      _id: inProgressId,
      status: 'In Progress',
      studentId: studentObjId
    }]
  });

  TestResult.findOneAndUpdate = async (filter, update) => ({
    _id: inProgressId,
    ...update.$set,
    createdAt: new Date()
  });

  const req = {
    params: { id: mockExam._id.toString() },
    user: {
      id: studentObjId.toString(),
      studentId: studentObjId.toString(),
      role: 'student',
      isApproved: true,
      accountStatus: 'Approved'
    },
    body: {
      answers: [
        { questionId: mockExam.questions[0]._id.toString(), selectedOption: 'C' }
      ]
    }
  };
  const res = makeResponse();

  await studentController.submitExam(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.score, 2, 'Selected correct answer gives 2 marks');
  assert.equal(res.body.data.totalCorrect, 1);

  const examInfoQ = res.body.data.examInfo.questions[0];
  assert.ok(examInfoQ.imageUrl.includes('X-Amz-Signature'), 'examInfo question imageUrl must be presigned');
  assert.ok(examInfoQ.image.includes('X-Amz-Signature'), 'examInfo question image must be presigned');
  assert.equal(examInfoQ.correctOption, 'C', 'Answer key revealed upon completion');
});
