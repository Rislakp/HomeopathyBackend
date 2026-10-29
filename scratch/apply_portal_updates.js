const fs = require('fs');
const path = require('path');

// 1. Update WCA-Student_portal/lib/models/student_exam_model.dart
const studentModelPath = path.resolve('C:/Users/admin/StudioProjects/WCA-Student_portal/lib/models/student_exam_model.dart');
if (fs.existsSync(studentModelPath)) {
  let content = fs.readFileSync(studentModelPath, 'utf8');

  // Add fields to class definition
  if (!content.includes('final int totalAttempts;')) {
    content = content.replace(
      '  final DateTime? updatedAt;',
      '  final DateTime? updatedAt;\n  final int totalAttempts;\n  final num? latestScore;\n  final num? bestScore;'
    );
    content = content.replace(
      '    this.updatedAt,\n  });',
      '    this.updatedAt,\n    this.totalAttempts = 0,\n    this.latestScore,\n    this.bestScore,\n  });'
    );
  }

  // Add parsing in fromJson
  if (!content.includes('parsedTotalAttempts')) {
    const targetExtract = `    // 4. Extract previousScore`;
    const replacementExtract = `    // 3b. Extract attempt & score metrics
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
    content = content.replace(targetExtract, replacementExtract);

    content = content.replace(
      '      previousScore: parsedPreviousScore,',
      '      previousScore: parsedPreviousScore ?? parsedLatestScore,\n      totalAttempts: parsedTotalAttempts,\n      latestScore: parsedLatestScore,\n      bestScore: parsedBestScore,'
    );

    content = content.replace(
      '    String? moduleName,',
      '    String? moduleName,\n    int? totalAttempts,\n    num? latestScore,\n    num? bestScore,'
    );

    content = content.replace(
      '      moduleName: moduleName ?? this.moduleName,',
      '      moduleName: moduleName ?? this.moduleName,\n      totalAttempts: totalAttempts ?? this.totalAttempts,\n      latestScore: latestScore ?? this.latestScore,\n      bestScore: bestScore ?? this.bestScore,'
    );
  }

  fs.writeFileSync(studentModelPath, content, 'utf8');
  console.log('Successfully updated student_exam_model.dart');
}

// 2. Update WCA-Student_portal/lib/pages/mock_test/student_mock_test_screen.dart
const studentScreenPath = path.resolve('C:/Users/admin/StudioProjects/WCA-Student_portal/lib/pages/mock_test/student_mock_test_screen.dart');
if (fs.existsSync(studentScreenPath)) {
  let content = fs.readFileSync(studentScreenPath, 'utf8');
  const targetGuard = `    // Guard: Prevent re-attempting an already completed exam
    if (exam.isAttempted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text(
            'This exam has already been completed and cannot be attempted again.',
          ),
          backgroundColor: Theme.of(context).colorScheme.error,
          behavior: SnackBarBehavior.floating,
        ),
      );
      return;
    }`;

  if (content.includes(targetGuard)) {
    content = content.replace(targetGuard, `    // Reattempts are supported: proceed to start/resume exam session`);
    fs.writeFileSync(studentScreenPath, content, 'utf8');
    console.log('Successfully updated student_mock_test_screen.dart');
  }
}

// 3. Update WCA-Student_portal/lib/widgets/dashboard/mock_test/mock_test_section.dart
const dashboardPath = path.resolve('C:/Users/admin/StudioProjects/WCA-Student_portal/lib/widgets/dashboard/mock_test/mock_test_section.dart');
if (fs.existsSync(dashboardPath)) {
  let content = fs.readFileSync(dashboardPath, 'utf8');
  const targetGuard = `    if (exam.isAttempted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'This exam has already been completed and cannot be re-attempted.',
          ),
          behavior: SnackBarBehavior.floating,
        ),
      );
      return;
    }`;

  if (content.includes(targetGuard)) {
    content = content.replace(targetGuard, `    // Reattempts are supported: proceed to start/resume exam session`);
    fs.writeFileSync(dashboardPath, content, 'utf8');
    console.log('Successfully updated mock_test_section.dart');
  }
}

// 4. Update WCA-Student_portal/lib/widgets/mock_test/student_exam_card.dart
const studentCardPath = path.resolve('C:/Users/admin/StudioProjects/WCA-Student_portal/lib/widgets/mock_test/student_exam_card.dart');
if (fs.existsSync(studentCardPath)) {
  let content = fs.readFileSync(studentCardPath, 'utf8');

  // Add onReattempt callback if missing
  if (!content.includes('final VoidCallback? onReattempt;')) {
    content = content.replace(
      '  final VoidCallback? onViewResult;',
      '  final VoidCallback? onViewResult;\n  final VoidCallback? onReattempt;'
    );
    content = content.replace(
      '    this.onViewResult,',
      '    this.onViewResult,\n    this.onReattempt,'
    );
  }

  // Update _buildActionButton when exam.isCompleted to show both View Result and Reattempt
  const oldCompletedButton = `    if (exam.isCompleted) {
      return OutlinedButton.icon(
        onPressed: onViewResult ?? onActionPressed,
        icon: const Icon(Icons.analytics_outlined, size: 15),
        label: const Text('View Result >'),
        style: OutlinedButton.styleFrom(
          side: BorderSide(
            color: colorScheme.primary,
            width: 1.5,
          ),
          foregroundColor: colorScheme.primary,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
          padding: const EdgeInsets.symmetric(
            horizontal: 14,
            vertical: 10,
          ),
          textStyle: theme.textTheme.labelMedium?.copyWith(
            fontWeight: FontWeight.w700,
            fontSize: 14,
          ),
        ),
      );
    }`;

  const newCompletedButton = `    if (exam.isCompleted) {
      return Wrap(
        spacing: 8,
        runSpacing: 8,
        alignment: WrapAlignment.end,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          OutlinedButton.icon(
            onPressed: onViewResult ?? onActionPressed,
            icon: const Icon(Icons.analytics_outlined, size: 15),
            label: const Text('View Result >'),
            style: OutlinedButton.styleFrom(
              side: BorderSide(
                color: colorScheme.primary,
                width: 1.5,
              ),
              foregroundColor: colorScheme.primary,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(10),
              ),
              padding: const EdgeInsets.symmetric(
                horizontal: 14,
                vertical: 10,
              ),
              textStyle: theme.textTheme.labelMedium?.copyWith(
                fontWeight: FontWeight.w700,
                fontSize: 14,
              ),
            ),
          ),
          ElevatedButton.icon(
            onPressed: onReattempt ?? onStartTest ?? onActionPressed,
            icon: const Icon(Icons.replay_rounded, size: 15),
            label: const Text('Reattempt'),
            style: ElevatedButton.styleFrom(
              elevation: 0,
              backgroundColor: colorScheme.primary,
              foregroundColor: colorScheme.onPrimary,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(10),
              ),
              padding: const EdgeInsets.symmetric(
                horizontal: 14,
                vertical: 10,
              ),
              textStyle: theme.textTheme.labelMedium?.copyWith(
                fontWeight: FontWeight.w700,
                fontSize: 14,
              ),
            ),
          ),
        ],
      );
    }`;

  if (content.includes(oldCompletedButton)) {
    content = content.replace(oldCompletedButton, newCompletedButton);
  }

  // Update previous score container to show latest score, best score and total attempts
  const oldScoreContainer = `  Widget _buildPreviousScoreContainer(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: colorScheme.primaryContainer.withValues(alpha: 0.35),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: colorScheme.primary.withValues(alpha: 0.18),
          width: 1,
        ),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              Icon(
                Icons.analytics_outlined,
                size: 16,
                color: colorScheme.primary,
              ),
              const SizedBox(width: 6),
              Text(
                'Previous Score',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: colorScheme.onSurfaceVariant,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          Text(
            '\${exam.previousScore} / \${exam.totalMarks}',
            style: theme.textTheme.bodyMedium?.copyWith(
              color: colorScheme.primary,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }`;

  const newScoreContainer = `  Widget _buildPreviousScoreContainer(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    final latest = exam.latestScore ?? exam.previousScore;
    final best = exam.bestScore ?? exam.previousScore;
    final attempts = exam.totalAttempts > 0 ? exam.totalAttempts : 1;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: colorScheme.primaryContainer.withValues(alpha: 0.35),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: colorScheme.primary.withValues(alpha: 0.18),
          width: 1,
        ),
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Icon(
                    Icons.analytics_outlined,
                    size: 16,
                    color: colorScheme.primary,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    'Latest Score',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: colorScheme.onSurfaceVariant,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
              Text(
                '\$latest / \${exam.totalMarks}',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: colorScheme.primary,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
          if (best != null && best != latest) ...[
            const SizedBox(height: 4),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Best Score',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: colorScheme.onSurfaceVariant,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                Text(
                  '\$best / \${exam.totalMarks}',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: colorScheme.primary,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ],
          if (attempts > 1) ...[
            const SizedBox(height: 4),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Total Attempts',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: colorScheme.onSurfaceVariant,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                Text(
                  '\$attempts',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: colorScheme.onSurfaceVariant,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }`;

  if (content.includes(oldScoreContainer)) {
    content = content.replace(oldScoreContainer, newScoreContainer);
  }

  fs.writeFileSync(studentCardPath, content, 'utf8');
  console.log('Successfully updated student_exam_card.dart');
}

// 5. Update WCA-admin_portal/lib/admin/models/academic_exam_result_model.dart
const adminModelPath = path.resolve('C:/Users/admin/StudioProjects/WCA-admin_portal/lib/admin/models/academic_exam_result_model.dart');
if (fs.existsSync(adminModelPath)) {
  let content = fs.readFileSync(adminModelPath, 'utf8');

  if (!content.includes('Object? get attempts')) {
    content = content.replace(
      '  String? get attemptStatus => _stringValue([\'attemptStatus\', \'status\']);',
      '  Object? get attempts =>\n      _firstValue([\'attempts\', \'attemptNumber\', \'attempt_number\', \'totalAttempts\']);\n  String? get attemptStatus => _stringValue([\'attemptStatus\', \'status\']);'
    );

    content = content.replace(
      '    if (attemptStatus != null) (label: \'Attempt Status\', value: attemptStatus!),',
      '    if (attempts != null) (label: \'Attempts\', value: attempts!),\n    if (attemptStatus != null) (label: \'Attempt Status\', value: attemptStatus!),'
    );

    fs.writeFileSync(adminModelPath, content, 'utf8');
    console.log('Successfully updated academic_exam_result_model.dart');
  }
}

// 6. Update WCA-admin_portal/lib/admin/screens/test_history/academic_exam_results_screen.dart
const adminScreenPath = path.resolve('C:/Users/admin/StudioProjects/WCA-admin_portal/lib/admin/screens/test_history/academic_exam_results_screen.dart');
if (fs.existsSync(adminScreenPath)) {
  let content = fs.readFileSync(adminScreenPath, 'utf8');

  // Add Attempts column to availableColumns
  if (!content.includes("_ResultColumn('Attempts', (result) => result.attempts)")) {
    content = content.replace(
      '      if (any((result) => result.unanswered != null))\n        _ResultColumn(\'Unanswered\', (result) => result.unanswered),',
      '      if (any((result) => result.unanswered != null))\n        _ResultColumn(\'Unanswered\', (result) => result.unanswered),\n      if (any((result) => result.attempts != null))\n        _ResultColumn(\'Attempts\', (result) => result.attempts),'
    );
  }

  // Add Attempts to Excel export
  if (!content.includes("'Attempts', 'Status', 'Submitted Date'")) {
    content = content.replace(
      "'Correct', 'Wrong', 'Unanswered', 'Status',",
      "'Correct', 'Wrong', 'Unanswered', 'Attempts', 'Status', 'Submitted Date',"
    );

    content = content.replace(
      "          xlsx.TextCellValue(result.unanswered?.toString() ?? '—'),\n          xlsx.TextCellValue(result.attemptStatus ?? '—'),\n        ]);",
      "          xlsx.TextCellValue(result.unanswered?.toString() ?? '—'),\n          xlsx.TextCellValue(result.attempts?.toString() ?? '1'),\n          xlsx.TextCellValue(result.attemptStatus ?? '—'),\n          xlsx.TextCellValue(result.submittedAt ?? '—'),\n        ]);"
    );
  }

  fs.writeFileSync(adminScreenPath, content, 'utf8');
  console.log('Successfully updated academic_exam_results_screen.dart');
}
