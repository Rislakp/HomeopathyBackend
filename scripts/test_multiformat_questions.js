const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const connectDB = require('../config/db');
const Exam = require('../models/exam.model');
const {
  validateAndSanitizeQuestion,
  validateAndSanitizeQuestions,
  createGrandMockExam,
  getGrandMockById,
  updateGrandMockExam,
  addQuestionToExam,
  updateQuestionInExam,
  deleteQuestionFromExam
} = require('../controllers/exam.controller');

// Mock Express req and res objects
function createMockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
  return res;
}

async function runTests() {
  console.log('🧪 Starting Multi-Format Questions (Passages, Images, Tables) Test Suite...\n');

  // 1. Connect to MongoDB
  try {
    await connectDB();
    console.log('✅ Connected to MongoDB.');
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  }

  let createdExamId = null;

  try {
    // 2. Unit Testing Helper Functions
    console.log('\n--- 1. Testing Question Validation & Sanitization Helpers ---');
    
    // Valid multi-format question
    const sampleInputQ = {
      questionText: 'Which remedy corresponds to the clinical case in the table?',
      passage: 'A 45-year-old patient presented with severe anxiety, restlessness, and unquenchable thirst.',
      imageUrl: 'https://cdn.example.com/images/patient_case_12.png',
      tableData: [
        ['Symptom', 'Intensity', 'Modality'],
        ['Restlessness', 'High', 'Worse past midnight'],
        ['Thirst', 'Frequent small sips', 'Worse cold drinks']
      ],
      options: {
        A: 'Arsenicum Album',
        B: 'Belladonna',
        C: 'Nux Vomica',
        D: 'Pulsatilla'
      },
      correctOption: 'A'
    };

    const valResult = validateAndSanitizeQuestion(sampleInputQ);
    if (!valResult.valid) {
      throw new Error(`Validation failed for valid multi-format question: ${valResult.error}`);
    }
    console.log('✅ Single question validation passed.');
    console.log('   Passage:', valResult.question.passage);
    console.log('   Image URL:', valResult.question.imageUrl);
    console.log('   Table Rows:', valResult.question.tableData.length);

    // Test JSON string tableData parsing
    const jsonStringTableQ = {
      ...sampleInputQ,
      tableData: JSON.stringify([['Header1', 'Header2'], ['Val1', 'Val2']])
    };
    const jsonTableVal = validateAndSanitizeQuestion(jsonStringTableQ);
    if (!jsonTableVal.valid || !Array.isArray(jsonTableVal.question.tableData)) {
      throw new Error('Failed to parse JSON string tableData.');
    }
    console.log('✅ JSON string tableData parsing passed.');

    // Test invalid correctOption
    const invalidOptQ = { ...sampleInputQ, correctOption: 'E' };
    const invalidRes = validateAndSanitizeQuestion(invalidOptQ);
    if (invalidRes.valid) {
      throw new Error('Validation should have failed for invalid correctOption E.');
    }
    console.log('✅ Invalid correctOption rejection passed.');


    // 3. Testing Exam Creation Endpoint Logic with Multi-Format Questions
    console.log('\n--- 2. Testing Grand Mock Exam Creation with Multi-Format Questions ---');
    
    const mockReqCreate = {
      body: {
        title: 'Multi-Format Clinical Case Grand Mock Exam',
        marksPerQuestion: 2,
        negativeMark: 0.5,
        durationMinutes: 60,
        totalQuestions: 2,
        questions: [
          {
            questionText: 'What is the indicated remedy for the passage below?',
            passage: 'Patient exhibits sudden high fever, dry heat, throbbing headache, and dilated pupils.',
            options: {
              A: 'Belladonna',
              B: 'Aconite',
              C: 'Gelsemium',
              D: 'Bryonia'
            },
            correctOption: 'A'
          },
          {
            questionText: 'Analyze the table data and select the primary remedy.',
            tableData: {
              headers: ['Parameter', 'Observation'],
              rows: [
                ['Mind', 'Irritable and sensitive'],
                ['GI', 'Constipation with frequent ineffectual urge']
              ]
            },
            imageUrl: 'https://example.com/nux_vomica_chart.jpg',
            options: {
              A: 'Pulsatilla',
              B: 'Nux Vomica',
              C: 'Lycopodium',
              D: 'Sulphur'
            },
            correctOption: 'B'
          }
        ]
      }
    };

    const resCreate = createMockRes();
    await createGrandMockExam(mockReqCreate, resCreate);

    if (resCreate.statusCode !== 201 || !resCreate.body.success) {
      throw new Error(`Create Exam failed with status ${resCreate.statusCode}: ${JSON.stringify(resCreate.body)}`);
    }

    createdExamId = resCreate.body.exam._id;
    console.log(`✅ Exam created successfully with ID: ${createdExamId}`);
    console.log(`   Q1 Passage: "${resCreate.body.exam.questions[0].passage}"`);
    console.log(`   Q2 ImageUrl: "${resCreate.body.exam.questions[1].imageUrl}"`);
    console.log(`   Q2 TableData object structure verified.`);


    // 4. Testing Fetching Single Exam by ID
    console.log('\n--- 3. Testing Get Exam By ID ---');
    const mockReqGet = { params: { id: createdExamId.toString() } };
    const resGet = createMockRes();
    await getGrandMockById(mockReqGet, resGet);

    if (resGet.statusCode !== 200 || !resGet.body.success) {
      throw new Error(`Get Exam failed: ${JSON.stringify(resGet.body)}`);
    }
    const retrievedQuestions = resGet.body.data.questions;
    if (retrievedQuestions.length !== 2) {
      throw new Error(`Expected 2 questions, found ${retrievedQuestions.length}`);
    }
    console.log('✅ Exam fetched by ID with all multi-format questions intact.');


    // 5. Testing Adding a Standalone Multi-Format Question to Exam
    console.log('\n--- 4. Testing Add Question To Exam (POST /api/exams/:id/questions) ---');
    const newQuestionInput = {
      questionText: 'Identify the tongue appearance from the provided image URL.',
      imageUrl: 'https://example.com/tongue_symptom.png',
      passage: 'Patient complains of metallic taste and thick white coating on tongue.',
      tableData: [['Feature', 'Status'], ['Coat', 'Thick White'], ['Taste', 'Metallic']],
      options: {
        A: 'Antimonium Crudum',
        B: 'Merc Sol',
        C: 'Pulsatilla',
        D: 'Ipecac'
      },
      correctOption: 'A'
    };

    const mockReqAddQ = {
      params: { id: createdExamId.toString() },
      body: newQuestionInput
    };
    const resAddQ = createMockRes();
    await addQuestionToExam(mockReqAddQ, resAddQ);

    if (resAddQ.statusCode !== 201 || !resAddQ.body.success) {
      throw new Error(`Add Question failed: ${JSON.stringify(resAddQ.body)}`);
    }
    const addedQ = resAddQ.body.question;
    const addedQId = addedQ._id;
    console.log(`✅ Question added successfully with ID: ${addedQId}`);
    console.log(`   Total Questions now: ${resAddQ.body.totalQuestions}`);


    // 6. Testing Updating Specific Question (PUT /api/exams/:id/questions/:questionId)
    console.log('\n--- 5. Testing Update Question In Exam (PUT /api/exams/:id/questions/:questionId) ---');
    const updateQInput = {
      questionText: 'UPDATED: Identify the updated tongue appearance.',
      passage: 'UPDATED PASSAGE: Patient shows red tip of tongue.',
      imageUrl: 'https://example.com/updated_tongue.png'
    };

    const mockReqUpdateQ = {
      params: { id: createdExamId.toString(), questionId: addedQId.toString() },
      body: updateQInput
    };
    const resUpdateQ = createMockRes();
    await updateQuestionInExam(mockReqUpdateQ, resUpdateQ);

    if (resUpdateQ.statusCode !== 200 || !resUpdateQ.body.success) {
      throw new Error(`Update Question failed: ${JSON.stringify(resUpdateQ.body)}`);
    }
    console.log('✅ Question updated successfully.');
    console.log(`   Updated Question Text: "${resUpdateQ.body.question.questionText}"`);
    console.log(`   Updated Passage: "${resUpdateQ.body.question.passage}"`);
    console.log(`   Updated Image URL: "${resUpdateQ.body.question.imageUrl}"`);


    // 7. Testing Full Exam Bulk Update
    console.log('\n--- 6. Testing Bulk Exam Update (PUT /api/exams/:id) ---');
    const mockReqUpdateExam = {
      params: { id: createdExamId.toString() },
      body: {
        title: 'Updated Multi-Format Clinical Exam Title',
        questions: [
          {
            questionText: 'Bulk Updated Q1 with Table Data',
            tableData: [['ColA', 'ColB'], ['10', '20']],
            options: { A: 'Opt A', B: 'Opt B', C: 'Opt C', D: 'Opt D' },
            correctOption: 'C'
          }
        ]
      }
    };
    const resUpdateExam = createMockRes();
    await updateGrandMockExam(mockReqUpdateExam, resUpdateExam);

    if (resUpdateExam.statusCode !== 200 || !resUpdateExam.body.success) {
      throw new Error(`Bulk Exam Update failed: ${JSON.stringify(resUpdateExam.body)}`);
    }
    console.log('✅ Bulk exam update succeeded.');


    // 8. Testing Question Deletion (DELETE /api/exams/:id/questions/:questionId)
    console.log('\n--- 7. Testing Delete Question From Exam ---');
    // First fetch exam to get question ID
    const examDoc = await Exam.findById(createdExamId);
    const qToDeleteId = examDoc.questions[0]._id;

    const mockReqDelQ = {
      params: { id: createdExamId.toString(), questionId: qToDeleteId.toString() }
    };
    const resDelQ = createMockRes();
    await deleteQuestionFromExam(mockReqDelQ, resDelQ);

    if (resDelQ.statusCode !== 200 || !resDelQ.body.success) {
      throw new Error(`Delete question failed: ${JSON.stringify(resDelQ.body)}`);
    }
    console.log(`✅ Question deleted successfully. Remaining questions count: ${resDelQ.body.totalQuestions}`);

    console.log('\n🎉 ALL MULTI-FORMAT QUESTION TESTS PASSED SUCCESSFULLY!');

  } catch (err) {
    console.error('\n❌ TEST FAILED WITH ERROR:', err);
    process.exitCode = 1;
  } finally {
    // Cleanup created test exam
    if (createdExamId) {
      console.log('\n🧹 Cleaning up test exam document...');
      await Exam.findByIdAndDelete(createdExamId);
      console.log('✅ Test exam document removed.');
    }
    await mongoose.connection.close();
    console.log('👋 Database connection closed.');
  }
}

runTests();
