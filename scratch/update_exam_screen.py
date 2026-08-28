import os

def update_file(filepath):
    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        return

    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Add _flaggedQuestions to state
    if "final Set<int> _flaggedQuestions = {};" not in content:
        content = content.replace(
            "final Set<int> _skippedQuestions = {};",
            "final Set<int> _skippedQuestions = {};\n  final Set<int> _flaggedQuestions = {};"
        )

    # 2. Add _toggleFlag method
    if "void _toggleFlag(int index)" not in content:
        toggle_method = """  void _toggleFlag(int index) {
    setState(() {
      if (_flaggedQuestions.contains(index)) {
        _flaggedQuestions.remove(index);
      } else {
        _flaggedQuestions.add(index);
      }
    });
  }
"""
        content = content.replace(
            "  void _clearSelection(int questionIndex) {",
            f"{toggle_method}\n  void _clearSelection(int questionIndex) {",
            1
        )

    # 3. Update dialog text for flagged questions
    if "Flagged for Review:" not in content:
        content = content.replace(
            "Text('• Answered: $answered / $total'),",
            "Text('• Answered: $answered / $total'),\n              Text('• Flagged for Review: ${_flaggedQuestions.length}'),"
        )

    # 4. Update Progress Banner stat badges to include Flagged badge
    if "label: 'Flagged:" not in content:
        content = content.replace(
            "_buildStatBadge(\n                    context,\n                    label: 'Answered: $answeredCount',\n                    color: colorScheme.primary,\n                  ),",
            "_buildStatBadge(\n                    context,\n                    label: 'Answered: $answeredCount',\n                    color: colorScheme.primary,\n                  ),\n                  _buildStatBadge(\n                    context,\n                    label: 'Flagged: ${_flaggedQuestions.length}',\n                    color: Colors.purple.shade700,\n                  ),"
        )

    # 5. Update Question Section to include Flag for Review Icon/Button
    if "Tooltip('Remove Flag')" not in content and "IconButton.filledTonal" not in content:
        old_q_header = """          Text(
            'Q${_currentIndex + 1}. ${question.questionText}',
            style: theme.textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w700,
              color: colorScheme.onSurface,
              height: 1.4,
            ),
          ),"""
        new_q_header = """          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  'Q${_currentIndex + 1}. ${question.questionText}',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: colorScheme.onSurface,
                    height: 1.4,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              IconButton.filledTonal(
                onPressed: () => _toggleFlag(_currentIndex),
                icon: Icon(
                  _flaggedQuestions.contains(_currentIndex)
                      ? Icons.flag_rounded
                      : Icons.flag_outlined,
                  color: _flaggedQuestions.contains(_currentIndex)
                      ? Colors.purple.shade700
                      : colorScheme.onSurfaceVariant,
                ),
                tooltip: _flaggedQuestions.contains(_currentIndex)
                    ? 'Remove Flag'
                    : 'Flag for Review',
                style: IconButton.styleFrom(
                  backgroundColor: _flaggedQuestions.contains(_currentIndex)
                      ? Colors.purple.shade100.withValues(alpha: 0.5)
                      : null,
                ),
              ),
            ],
          ),"""
        content = content.replace(old_q_header, new_q_header)

    # 6. Update Question Section Action Row to include Flag for Review button
    if "Flagged for Review" not in content:
        old_action_row = """          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              OutlinedButton.icon(
                onPressed:
                    _currentIndex > 0 ? _handlePreviousQuestion : null,
                icon: const Icon(Icons.arrow_back_rounded, size: 18),
                label: const Text('Previous'),
              ),
              if (selectedOption != null)
                TextButton(
                  onPressed: () => _clearSelection(_currentIndex),
                  child: Text(
                    'Clear Selection',
                    style: TextStyle(color: colorScheme.error),
                  ),
                ),
              FilledButton.icon(
                onPressed: _currentIndex < totalQuestions - 1
                    ? _handleNextQuestion
                    : _showSubmissionConfirmationDialog,
                icon: Icon(
                  _currentIndex < totalQuestions - 1
                      ? Icons.arrow_forward_rounded
                      : Icons.check_circle_rounded,
                  size: 18,
                ),
                label: Text(
                  _currentIndex < totalQuestions - 1 ? 'Next' : 'Submit Exam',
                ),
              ),
            ],
          ),"""
        new_action_row = """          Wrap(
            alignment: WrapAlignment.spaceBetween,
            crossAlignment: WrapCrossAlignment.center,
            spacing: 8,
            runSpacing: 8,
            children: [
              OutlinedButton.icon(
                onPressed:
                    _currentIndex > 0 ? _handlePreviousQuestion : null,
                icon: const Icon(Icons.arrow_back_rounded, size: 18),
                label: const Text('Previous'),
              ),
              OutlinedButton.icon(
                onPressed: () => _toggleFlag(_currentIndex),
                icon: Icon(
                  _flaggedQuestions.contains(_currentIndex)
                      ? Icons.flag_rounded
                      : Icons.flag_outlined,
                  size: 18,
                  color: _flaggedQuestions.contains(_currentIndex)
                      ? Colors.purple.shade700
                      : colorScheme.onSurfaceVariant,
                ),
                label: Text(
                  _flaggedQuestions.contains(_currentIndex)
                      ? 'Flagged for Review'
                      : 'Flag for Review',
                  style: TextStyle(
                    color: _flaggedQuestions.contains(_currentIndex)
                        ? Colors.purple.shade700
                        : colorScheme.onSurfaceVariant,
                    fontWeight: _flaggedQuestions.contains(_currentIndex)
                        ? FontWeight.bold
                        : FontWeight.normal,
                  ),
                ),
                style: OutlinedButton.styleFrom(
                  side: BorderSide(
                    color: _flaggedQuestions.contains(_currentIndex)
                        ? Colors.purple.shade400
                        : colorScheme.outlineVariant,
                  ),
                  backgroundColor: _flaggedQuestions.contains(_currentIndex)
                      ? Colors.purple.shade50
                      : null,
                ),
              ),
              if (selectedOption != null)
                TextButton(
                  onPressed: () => _clearSelection(_currentIndex),
                  child: Text(
                    'Clear Selection',
                    style: TextStyle(color: colorScheme.error),
                  ),
                ),
              FilledButton.icon(
                onPressed: _currentIndex < totalQuestions - 1
                    ? _handleNextQuestion
                    : _showSubmissionConfirmationDialog,
                icon: Icon(
                  _currentIndex < totalQuestions - 1
                      ? Icons.arrow_forward_rounded
                      : Icons.check_circle_rounded,
                  size: 18,
                ),
                label: Text(
                  _currentIndex < totalQuestions - 1 ? 'Next' : 'Submit Exam',
                ),
              ),
            ],
          ),"""
        content = content.replace(old_action_row, new_action_row)

    # 7. Update Navigator Palette Legend to include Flagged Legend Item
    if "label: 'Flagged'" not in content and "_buildLegendItem(context, color: Colors.purple.shade700" not in content:
        old_legend = """          Wrap(
            spacing: 10,
            runSpacing: 6,
            children: [
              _buildLegendItem(context, color: colorScheme.primary, label: 'Answered'),
              _buildLegendItem(context, color: Colors.orange.shade800, label: 'Skipped'),
              _buildLegendItem(context, color: colorScheme.surfaceContainerHighest, label: 'Not Visited'),
            ],
          ),"""
        new_legend = """          Wrap(
            spacing: 10,
            runSpacing: 6,
            children: [
              _buildLegendItem(context, color: colorScheme.primary, label: 'Answered'),
              _buildLegendItem(context, color: Colors.purple.shade700, label: 'Flagged'),
              _buildLegendItem(context, color: Colors.orange.shade800, label: 'Skipped'),
              _buildLegendItem(context, color: colorScheme.surfaceContainerHighest, label: 'Not Visited'),
            ],
          ),"""
        content = content.replace(old_legend, new_legend)

    # 8. Update GridView item builder logic for Distinct States & Badges
    old_grid_builder = """            itemBuilder: (context, index) {
              final bool isAnswered =
                  _selectedAnswers.containsKey(index) && _selectedAnswers[index] != null;
              final bool isSkipped = _skippedQuestions.contains(index);
              final bool isActive = index == _currentIndex;

              Color bgColor = colorScheme.surfaceContainerHighest;
              Color textColor = colorScheme.onSurfaceVariant;

              if (isAnswered) {
                bgColor = colorScheme.primary;
                textColor = colorScheme.onPrimary;
              } else if (isSkipped) {
                bgColor = Colors.orange.shade100;
                textColor = Colors.orange.shade900;
              }

              return InkWell(
                onTap: () => _navigateToQuestion(index),
                borderRadius: BorderRadius.circular(8),
                child: Container(
                  decoration: BoxDecoration(
                    color: bgColor,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                      color: isActive
                          ? colorScheme.primary
                          : (isAnswered
                              ? colorScheme.primary
                              : colorScheme.outlineVariant),
                      width: isActive ? 2.5 : 1.0,
                    ),
                  ),
                  child: Center(
                    child: Text(
                      '${index + 1}',
                      style: TextStyle(
                        fontWeight:
                            isActive || isAnswered ? FontWeight.bold : FontWeight.normal,
                        color: textColor,
                      ),
                    ),
                  ),
                ),
              );
            },"""

    new_grid_builder = """            itemBuilder: (context, index) {
              final bool isAnswered =
                  _selectedAnswers.containsKey(index) && _selectedAnswers[index] != null;
              final bool isSkipped = _skippedQuestions.contains(index);
              final bool isFlagged = _flaggedQuestions.contains(index);
              final bool isActive = index == _currentIndex;

              Color bgColor = colorScheme.surfaceContainerHighest;
              Color textColor = colorScheme.onSurfaceVariant;
              IconData? badgeIcon;

              if (isFlagged) {
                bgColor = Colors.purple.shade100;
                textColor = Colors.purple.shade900;
                badgeIcon = Icons.flag_rounded;
              } else if (isAnswered) {
                bgColor = colorScheme.primary;
                textColor = colorScheme.onPrimary;
                badgeIcon = Icons.check_circle_rounded;
              } else if (isSkipped) {
                bgColor = Colors.orange.shade100;
                textColor = Colors.orange.shade900;
                badgeIcon = Icons.priority_high_rounded;
              }

              return InkWell(
                onTap: () => _navigateToQuestion(index),
                borderRadius: BorderRadius.circular(8),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 150),
                  decoration: BoxDecoration(
                    color: bgColor,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                      color: isActive
                          ? (isFlagged ? Colors.purple.shade700 : colorScheme.primary)
                          : (isFlagged
                              ? Colors.purple.shade400
                              : (isAnswered
                                  ? colorScheme.primary
                                  : colorScheme.outlineVariant)),
                      width: isActive ? 2.5 : 1.0,
                    ),
                    boxShadow: isActive
                        ? [
                            BoxShadow(
                              color: (isFlagged ? Colors.purple : colorScheme.primary)
                                  .withValues(alpha: 0.3),
                              blurRadius: 4,
                              offset: const Offset(0, 2),
                            )
                          ]
                        : null,
                  ),
                  child: Stack(
                    children: [
                      Center(
                        child: Text(
                          '${index + 1}',
                          style: TextStyle(
                            fontWeight: isActive || isAnswered || isFlagged
                                ? FontWeight.bold
                                : FontWeight.normal,
                            color: textColor,
                            fontSize: 13,
                          ),
                        ),
                      ),
                      if (badgeIcon != null)
                        Positioned(
                          top: 2,
                          right: 2,
                          child: Icon(
                            badgeIcon,
                            size: 10,
                            color: isAnswered
                                ? colorScheme.onPrimary
                                : (isFlagged
                                    ? Colors.purple.shade900
                                    : Colors.orange.shade900),
                          ),
                        ),
                    ],
                  ),
                ),
              );
            },"""

    content = content.replace(old_grid_builder, new_grid_builder)

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

    print(f"Successfully updated: {filepath}")

files_to_update = [
    r"c:\Users\Admin\OneDrive\hoemopathy\Homeopathy\lib\student_portal\pages\mock_test\active_exam_screen.dart",
    r"c:\Users\Admin\OneDrive\hoemopathy\Homeopathy\student_frontend\lib\student_portal\pages\mock_test\active_exam_screen.dart",
    r"c:\Users\Admin\OneDrive\hoemopathy\Homeopathy\admin_frontend\lib\student_portal\pages\mock_test\active_exam_screen.dart"
]

for fp in files_to_update:
    update_file(fp)
