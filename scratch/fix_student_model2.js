const fs = require('fs');
const path = require('path');

const studentModelPath = path.resolve('C:/Users/admin/StudioProjects/WCA-Student_portal/lib/models/student_exam_model.dart');
let content = fs.readFileSync(studentModelPath, 'utf8');

// Normalize CRLF to LF
content = content.replace(/\r\n/g, '\n');

// 1. Constructor fields
const oldConstructor = `  const StudentExamModel({
    required this.id,
    required this.title,
    required this.marksPerQuestion,
    this.negativeMark = 0.0,
    required this.durationMinutes,
    required this.totalQuestions,
    required this.status,
    this.previousScore,
    required this.totalMarks,
    this.lastAttemptedAt,
    this.resultId,
    this.testType,
    this.examType,
    this.category,
    this.stream,
    this.slug,
    this.isUnani = false,
    this.courseId,
    this.courseName,
    this.courseIds = const [],
    this.courseNames = const [],
    this.moduleId,
    this.moduleName,
    this.createdAt,
    this.updatedAt,
  });`;

const newConstructor = `  const StudentExamModel({
    required this.id,
    required this.title,
    required this.marksPerQuestion,
    this.negativeMark = 0.0,
    required this.durationMinutes,
    required this.totalQuestions,
    required this.status,
    this.previousScore,
    required this.totalMarks,
    this.lastAttemptedAt,
    this.resultId,
    this.testType,
    this.examType,
    this.category,
    this.stream,
    this.slug,
    this.isUnani = false,
    this.courseId,
    this.courseName,
    this.courseIds = const [],
    this.courseNames = const [],
    this.moduleId,
    this.moduleName,
    this.createdAt,
    this.updatedAt,
    this.totalAttempts = 0,
    this.latestScore,
    this.bestScore,
  });`;

if (content.includes(oldConstructor)) {
  content = content.replace(oldConstructor, newConstructor);
  console.log('Constructor replaced successfully');
} else {
  console.log('Old constructor not found');
}

// 2. Locate fromJson and ensure parsedPreviousScore and 4b are properly declared
const oldExtract4 = `    // 4. Extract previousScore
    final num? parsedPreviousScore = _asNullableNum(
      json['previousScore'] ??
          json['score'] ??
          json['userScore'] ??
          json['obtainedMarks'] ??
          resultMap?['score'] ??
          resultMap?['obtainedMarks'] ??
          attemptMap?['score'] ??
          attemptMap?['obtainedMarks'],
    );`;

const newExtract4 = `    // 4. Extract previousScore
    final num? parsedPreviousScore = _asNullableNum(
      json['previousScore'] ??
          json['score'] ??
          json['userScore'] ??
          json['obtainedMarks'] ??
          resultMap?['score'] ??
          resultMap?['obtainedMarks'] ??
          attemptMap?['score'] ??
          attemptMap?['obtainedMarks'],
    );

    // 4b. Extract attempt & score metrics
    final num? parsedLatestScore = _asNullableNum(
      json['latestScore'] ?? json['latest_score'] ?? parsedPreviousScore,
    );
    final num? parsedBestScore = _asNullableNum(
      json['bestScore'] ?? json['best_score'] ?? parsedPreviousScore,
    );
    final int parsedTotalAttempts = _asInt(
      json['totalAttempts'] ?? json['attempts'] ?? json['total_attempts'],
      fallback: (hasAttempted || completedFlag || submittedFlag || parsedResultId != null || parsedPreviousScore != null) ? 1 : 0,
    );`;

if (content.includes(oldExtract4)) {
  content = content.replace(oldExtract4, newExtract4);
  console.log('Extract 4 replaced successfully');
} else {
  console.log('Extract 4 not found');
}

fs.writeFileSync(studentModelPath, content, 'utf8');
