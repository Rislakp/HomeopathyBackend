import os

path = 'lib/admin/screens/courses/update_class_content_screen.dart'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update initialMeeting extraction in initState
target_init_meeting = '''    String initialMeeting = widget.initialMeetingUrl ?? '';
    String? mediaUrl = widget.initialMediaUrl;

    if (widget.lesson != null && widget.lesson is Map) {
      final map = widget.lesson as Map<String, dynamic>;
      if (map['meetingUrl'] != null &&
          map['meetingUrl'].toString().isNotEmpty) {
        initialMeeting = map['meetingUrl'].toString();
      }
      if (mediaUrl == null || mediaUrl.isEmpty) {
        mediaUrl =
            map['mediaUrlOrPath']?.toString() ?? map['fileOrLink']?.toString();
      }'''

replacement_init_meeting = '''    String rawMeeting = widget.initialMeetingUrl ?? '';
    String? mediaUrl = widget.initialMediaUrl;

    if (widget.lesson != null && widget.lesson is Map) {
      final map = widget.lesson as Map<String, dynamic>;
      if (map['meetingUrl'] != null &&
          map['meetingUrl'].toString().trim().isNotEmpty) {
        rawMeeting = map['meetingUrl'].toString().trim();
      } else if (map['liveLink'] != null &&
          map['liveLink'].toString().trim().isNotEmpty) {
        rawMeeting = map['liveLink'].toString().trim();
      } else if (map['meetingLink'] != null &&
          map['meetingLink'].toString().trim().isNotEmpty) {
        rawMeeting = map['meetingLink'].toString().trim();
      }
      if (mediaUrl == null || mediaUrl.isEmpty) {
        mediaUrl =
            map['mediaUrlOrPath']?.toString() ?? map['fileOrLink']?.toString();
      }'''

content = content.replace('\r\n', '\n')
target_init_meeting = target_init_meeting.replace('\r\n', '\n')
assert target_init_meeting in content, 'target_init_meeting not found'
content = content.replace(target_init_meeting, replacement_init_meeting, 1)

# 2. Update controller initialization and mediaUrl inspection
target_controller = '''    _meetingUrlController = TextEditingController(text: initialMeeting);

    if (mediaUrl != null && mediaUrl.isNotEmpty) {
      if (mediaUrl.endsWith('.pdf') ||
          mediaUrl.endsWith('.doc') ||
          mediaUrl.endsWith('.docx') ||
          mediaUrl.endsWith('.txt')) {
        _existingNotesPath = mediaUrl;
      } else if (mediaUrl.endsWith('.mp4') ||
          mediaUrl.endsWith('.mov') ||
          mediaUrl.endsWith('.avi') ||
          mediaUrl.endsWith('.mkv') ||
          mediaUrl.endsWith('.webm')) {
        _existingVideoPath = mediaUrl;
      } else if (mediaUrl.startsWith('http') && initialMeeting.isEmpty) {
        _meetingUrlController.text = mediaUrl;
      } else {
        _existingVideoPath = mediaUrl;
      }
    }'''

replacement_controller = '''    final String initialMeeting = (DocumentViewerUtils.isMeetingUrl(rawMeeting) &&
            !DocumentViewerUtils.isMediaOrRecordingUrl(rawMeeting))
        ? rawMeeting
        : '';
    _meetingUrlController = TextEditingController(text: initialMeeting);

    if (mediaUrl != null && mediaUrl.isNotEmpty) {
      final cleanMediaLower = mediaUrl.toLowerCase().split('?').first;
      if (cleanMediaLower.endsWith('.pdf') ||
          cleanMediaLower.endsWith('.doc') ||
          cleanMediaLower.endsWith('.docx') ||
          cleanMediaLower.endsWith('.txt')) {
        _existingNotesPath = mediaUrl;
      } else if (cleanMediaLower.endsWith('.mp4') ||
          cleanMediaLower.endsWith('.mov') ||
          cleanMediaLower.endsWith('.avi') ||
          cleanMediaLower.endsWith('.mkv') ||
          cleanMediaLower.endsWith('.webm')) {
        _existingVideoPath = mediaUrl;
      } else if (DocumentViewerUtils.isMeetingUrl(mediaUrl) &&
          !DocumentViewerUtils.isMediaOrRecordingUrl(mediaUrl) &&
          initialMeeting.isEmpty) {
        _meetingUrlController.text = mediaUrl;
      } else {
        _existingVideoPath = mediaUrl;
      }
    }'''

target_controller = target_controller.replace('\r\n', '\n')
assert target_controller in content, 'target_controller not found'
content = content.replace(target_controller, replacement_controller, 1)

# 3. In _saveClassContent: meetingUrl sanitization
target_save_meeting = '''      final status = isPublishing ? 'Published' : 'Draft';
      final meetingUrl = _meetingUrlController.text.trim();'''

replacement_save_meeting = '''      final status = isPublishing ? 'Published' : 'Draft';
      final rawMeeting = _meetingUrlController.text.trim();
      final meetingUrl = (DocumentViewerUtils.isMeetingUrl(rawMeeting) &&
              !DocumentViewerUtils.isMediaOrRecordingUrl(rawMeeting))
          ? rawMeeting
          : '';'''

target_save_meeting = target_save_meeting.replace('\r\n', '\n')
assert target_save_meeting in content, 'target_save_meeting not found'
content = content.replace(target_save_meeting, replacement_save_meeting, 1)

# 4. In _saveClassContent: primaryMedia must not fall back to meetingUrl
target_primary_media = ''': (pdfNotesList.isNotEmpty
                ? (pdfNotesList.first['secure_url'] ??
                      pdfNotesList.first['url'] ??
                      '')
                : meetingUrl);'''

replacement_primary_media = ''': (pdfNotesList.isNotEmpty
                ? (pdfNotesList.first['secure_url'] ??
                      pdfNotesList.first['url'] ??
                      '')
                : '');'''

target_primary_media = target_primary_media.replace('\r\n', '\n')
assert target_primary_media in content, 'target_primary_media not found'
content = content.replace(target_primary_media, replacement_primary_media, 1)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print('Updated update_class_content_screen.dart successfully!')

