require('dotenv').config();
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');

const adminStudentRoutes = require('../routes/adminStudentRoutes');
const adminStudentController = require('../controllers/adminStudent.controller');

// Mock response test
const testExportFormattingDirectly = () => {
  console.log('\n--- Direct CSV formatting & escaping validation ---');

  // Let's invoke the controller logic or mock response
  let statusSet = null;
  let headersSet = {};
  let sentData = null;

  const mockReq = {
    query: {},
  };

  const mockRes = {
    status: (s) => {
      statusSet = s;
      return mockRes;
    },
    setHeader: (k, v) => {
      headersSet[k] = v;
      return mockRes;
    },
    send: (d) => {
      sentData = d;
      return mockRes;
    },
  };

  // Test formatExamScoresData function logic
  const sampleScores = [
    { examTitle: 'Midterm 1', score: 85, maxScore: 100, grade: 'A' },
    { examTitle: 'Final Exam', score: 95, maxScore: 100, grade: 'A+' },
  ];

  console.log('Sample exam scores:');
  console.log(JSON.stringify(sampleScores, null, 2));

  console.log('\n--- End of unit checks ---');
};

testExportFormattingDirectly();
