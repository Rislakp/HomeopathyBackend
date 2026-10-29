const fs = require('fs');
const path = require('path');

const studentModelPath = path.resolve('C:/Users/admin/StudioProjects/WCA-Student_portal/lib/models/student_exam_model.dart');
let content = fs.readFileSync(studentModelPath, 'utf8');

// Fix constructor: add this.totalAttempts = 0, this.latestScore, this.bestScore,
const oldConstructorEnd = `    this.moduleId,
    this.moduleName,
    this.createdAt,
    this.updatedAt,
  });`;

const newConstructorEnd = `    this.moduleId,
    this.moduleName,
    this.createdAt,
    this.updatedAt,
    this.totalAttempts = 0,
    this.latestScore,
    this.bestScore,
  });`;

if (content.includes(oldConstructorEnd)) {
  content = content.replace(oldConstructorEnd, newConstructorEnd);
}

// Remove the wrongly placed 3b block before 4
const badBlock = `    // 3b. Extract attempt & score metrics
    final int parsedTotalAttempts = _asInt(
      json['totalAttempts'] ?? json['attempts'] ?? json['total_attempts'],
      fallback: (hasAttempted || completedFlag || submittedFlag || parsedResultId != null || parsedPreviousScore != null) ? 1 : 0,
    );
    final num? parsedLatestScore = _asNullableNum(
      json['latestScore'] ?? json['latest_score'] ?? parsedPreviousScore,
    );
    final num? parsedBestScore = _asNullableNum(
      json['bestScore'] ?? json['best_score'] ?? parsedPreviousScore,
    );

    // 4. Extract previousScore`;

if (content.includes(badBlock)) {
  content = content.replace(badBlock, `    // 4. Extract previousScore`);
}

// Now place 4b cleanly right after 4. Extract previousScore
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
}

fs.writeFileSync(studentModelPath, content, 'utf8');
console.log('Fixed student_exam_model.dart');
