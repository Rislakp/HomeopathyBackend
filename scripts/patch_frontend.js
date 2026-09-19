const fs = require('fs');
const path = require('path');

// 1. Patch cloudinary_upload_service.dart
const cldServicePath = path.resolve(__dirname, '..', '..', 'admin_frontend', 'lib', 'services', 'cloudinary_upload_service.dart');
if (fs.existsSync(cldServicePath)) {
  let content = fs.readFileSync(cldServicePath, 'utf8');

  // Fix cloudName
  content = content.replace("static String cloudName = 'doxb5l5vf';", "static String cloudName = 'vadgpisw';");

  // Fix fallback asset generation so it doesn't create fake remote URLs
  const oldFallback = `    // 2. Upload via Backend Multipart or generate consistent Cloudinary Asset reference
    // Generate clean sanitized public_id and URL structure
    final cleanBaseName = fileName.replaceAll(RegExp(r'[^a-zA-Z0-9_-]'), '_');
    final timestamp = DateTime.now().millisecondsSinceEpoch;
    final generatedPublicId = '$folder/\${cleanBaseName}_\$timestamp';
    final generatedUrl = 'https://res.cloudinary.com/\$cloudName/\$resourceType/upload/v\$timestamp/\$generatedPublicId.\$ext';

    return CloudinaryAsset(
      title: fileName,
      url: generatedUrl,
      publicId: generatedPublicId,
      secureUrl: generatedUrl,
      resourceType: resourceType,
      sizeInBytes: file.size,
      format: ext,
      localPath: kIsWeb ? null : file.path,
      bytes: file.bytes,
    );`;

  const newFallback = `    // 2. Fallback to Backend Multipart upload - leave url/secureUrl empty so
    // CourseApiService detects local bytes/path and streams via MultipartRequest
    debugPrint('CloudinaryUploadService: Direct unsigned upload unavailable; routing \$fileName to backend multipart streaming');
    return CloudinaryAsset(
      title: fileName,
      url: '',
      publicId: '',
      secureUrl: '',
      resourceType: resourceType,
      sizeInBytes: file.size,
      format: ext,
      localPath: kIsWeb ? null : file.path,
      bytes: file.bytes,
    );`;

  if (content.includes("static String cloudName = 'vadgpisw';") || content.includes(oldFallback)) {
    content = content.replace(oldFallback, newFallback);
    fs.writeFileSync(cldServicePath, content, 'utf8');
    console.log('✅ Successfully patched cloudinary_upload_service.dart');
  } else {
    console.log('⚠️ cloudinary_upload_service.dart already patched or pattern differed');
  }
} else {
  console.log('⚠️ cloudinary_upload_service.dart not found at:', cldServicePath);
}

// 2. Patch course_api_service.dart
const courseApiServicePath = path.resolve(__dirname, '..', '..', 'admin_frontend', 'lib', 'services', 'course_api_service.dart');
if (fs.existsSync(courseApiServicePath)) {
  let content = fs.readFileSync(courseApiServicePath, 'utf8');

  // Ensure _hasLocalFile flags fake URLs or items with local bytes/path
  const oldHasLocalFile = `  static bool _hasLocalFile(List<dynamic>? items) {
    return items?.any((item) {
          if (item is! Map) return false;
          final path = (item['localPath'] ?? item['path'])?.toString().trim();
          final bytes = item['bytes'];
          final secureUrl = (item['secure_url'] ?? item['secureUrl'] ?? item['url'])?.toString().trim();
          final isRemote = secureUrl != null && (secureUrl.startsWith('http') || secureUrl.startsWith('/uploads'));
          return (!isRemote && bytes != null) || (!isRemote && path != null && path.isNotEmpty && !path.startsWith('http'));
        }) ??
        false;
  }`;

  const newHasLocalFile = `  static bool _hasLocalFile(List<dynamic>? items) {
    return items?.any((item) {
          if (item is! Map) return false;
          final path = (item['localPath'] ?? item['path'])?.toString().trim();
          final bytes = item['bytes'];
          final secureUrl = (item['secure_url'] ?? item['secureUrl'] ?? item['url'])?.toString().trim();
          final isRemote = secureUrl != null && (secureUrl.startsWith('http') || secureUrl.startsWith('/uploads')) && !secureUrl.contains('doxb5l5vf');
          return (!isRemote && bytes != null) || (!isRemote && path != null && path.isNotEmpty && !path.startsWith('http'));
        }) ??
        false;
  }`;

  // Ensure _addLocalFiles does not skip files if url is empty or contains placeholder
  const oldAddLocalFilesSkip = `      // Skip already-hosted remote files
      if (rawUrl.startsWith('http') || rawUrl.startsWith('/uploads')) {
        continue;
      }`;

  const newAddLocalFilesSkip = `      // Skip already-hosted remote files (do not skip if placeholder or if local content exists)
      if ((rawUrl.startsWith('http') || rawUrl.startsWith('/uploads')) && !rawUrl.contains('doxb5l5vf') && bytes == null && (path == null || path.isEmpty || path.startsWith('http'))) {
        continue;
      }`;

  if (content.includes(oldHasLocalFile)) {
    content = content.replace(oldHasLocalFile, newHasLocalFile);
  }
  if (content.includes(oldAddLocalFilesSkip)) {
    content = content.replace(oldAddLocalFilesSkip, newAddLocalFilesSkip);
  }

  fs.writeFileSync(courseApiServicePath, content, 'utf8');
  console.log('✅ Successfully patched course_api_service.dart');
} else {
  console.log('⚠️ course_api_service.dart not found at:', courseApiServicePath);
}
