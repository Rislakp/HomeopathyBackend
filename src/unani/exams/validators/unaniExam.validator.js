/**
 * Validation rules for Unani Exam Module
 */

function validateUnaniExamCreateOrUpdate(data, isUpdate = false) {
  const errors = [];

  // Strictly enforce courseId = "unani"
  if (data.courseId !== undefined && data.courseId !== null) {
    const cid = String(data.courseId).trim().toLowerCase();
    if (cid !== 'unani') {
      errors.push(`Invalid courseId '${data.courseId}'. Unani exam module only permits courseId = 'unani'.`);
    }
  }

  // Strictly enforce examType = "grand_mock_test"
  if (data.examType !== undefined && data.examType !== null) {
    const et = String(data.examType).trim().toLowerCase();
    if (et !== 'grand_mock_test') {
      errors.push(`Invalid examType '${data.examType}'. Unani exam module only permits examType = 'grand_mock_test'.`);
    }
  }

  if (!isUpdate) {
    if (!data.title || !String(data.title).trim()) {
      errors.push('Exam title is required.');
    }
    if (
      data.marksPerQuestion === undefined ||
      data.marksPerQuestion === null ||
      isNaN(Number(data.marksPerQuestion)) ||
      Number(data.marksPerQuestion) < 0
    ) {
      errors.push('marksPerQuestion is required and must be a non-negative number.');
    }
    if (
      data.durationMinutes === undefined ||
      data.durationMinutes === null ||
      isNaN(Number(data.durationMinutes)) ||
      Number(data.durationMinutes) <= 0
    ) {
      errors.push('durationMinutes is required and must be a positive number.');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

function validateUnaniQuestion(data) {
  const errors = [];

  if (!data.questionText || !String(data.questionText).trim()) {
    errors.push('Question text is required.');
  }

  if (!data.options || typeof data.options !== 'object') {
    errors.push('Options (A, B, C, D) are required.');
  } else {
    ['A', 'B', 'C', 'D'].forEach((opt) => {
      if (data.options[opt] === undefined || data.options[opt] === null || !String(data.options[opt]).trim()) {
        errors.push(`Option ${opt} is required.`);
      }
    });
  }

  if (
    !data.correctOption ||
    !['A', 'B', 'C', 'D'].includes(String(data.correctOption).toUpperCase().trim())
  ) {
    errors.push('correctOption must be one of: A, B, C, D.');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

module.exports = {
  validateUnaniExamCreateOrUpdate,
  validateUnaniQuestion,
};
