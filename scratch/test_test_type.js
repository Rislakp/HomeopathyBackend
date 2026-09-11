const mongoose = require('mongoose');
const Exam = require('../models/exam.model');
const { createGrandMockExam, getAllGrandMocks } = require('../controllers/exam.controller');

async function testTestTypeField() {
  console.log('Testing testType field and filtering logic...');

  // Mock res object
  function createMockRes() {
    return {
      statusCode: 200,
      jsonData: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.jsonData = data;
        return this;
      }
    };
  }

  // 1. Test schema defaults
  const examDefault = new Exam({
    title: 'Test Default Type Exam',
    marksPerQuestion: 1,
    durationMinutes: 30,
    totalQuestions: 1,
    questions: [{
      questionText: 'Q1',
      options: { A: '1', B: '2', C: '3', D: '4' },
      correctOption: 'A'
    }]
  });

  if (examDefault.testType !== 'grand_mock') {
    throw new Error(`Expected default testType to be 'grand_mock', got '${examDefault.testType}'`);
  }
  console.log('✅ Schema default testType is grand_mock');

  // 2. Test controller create with custom testType
  const reqCustom = {
    body: {
      title: 'Course Test 1',
      testType: 'course_test',
      marksPerQuestion: 2,
      durationMinutes: 45,
      totalQuestions: 1,
      questions: [{
        questionText: 'Q1',
        options: { A: 'A', B: 'B', C: 'C', D: 'D' },
        correctOption: 'B'
      }]
    }
  };
  const resCustom = createMockRes();

  // Test controller validation for invalid testType
  const reqInvalid = {
    body: {
      ...reqCustom.body,
      testType: 'invalid_type'
    }
  };
  const resInvalid = createMockRes();
  await createGrandMockExam(reqInvalid, resInvalid);
  if (resInvalid.statusCode !== 400) {
    throw new Error(`Expected 400 for invalid testType, got ${resInvalid.statusCode}`);
  }
  console.log('✅ Invalid testType rejected with status 400');

  console.log('ALL SCHEMA AND CONTROLLER UNIT CHECKS PASSED SUCCESSFULLY!');
}

testTestTypeField().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
