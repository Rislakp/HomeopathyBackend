# Video Size and Duration Metadata Verification & Root Cause Fix Report

**White Coat Academy — Backend Service**  
**Date**: October 12, 2026  
**Status**: Verified & Fixed  

---

## 1. Executive Summary

In the deployed Admin Portal, uploaded video entries were reported displaying `0` for file size and omitting duration. Meanwhile, video media playback requests in the browser Network tab returned `HTTP 206 (Partial Content)` due to range-header streaming, which masked whether metadata was properly stored or transmitted by the backend.

A comprehensive investigation into the White Coat Academy backend was conducted to trace how video uploads, recordings, lessons, and course curriculum data are ingested, persisted in MongoDB, and serialized for API consumption.

Evidence-based fixes were implemented across upload completion, lesson creation/updating, resource normalization, recording controllers, and response serializers. All tests pass with exit code 0.

---

## 2. Investigation & Tracing

### 2.1 Trace of Upload Initiation and Multipart Completion
1. **Multipart Upload Flow**:
   - `POST /api/upload/s3/multipart/initiate`: Allocates an S3 key prefix `videos/<timestamp>-<uuid>-<filename>` and returns `uploadId`.
   - `POST /api/upload/s3/multipart/presign-part`: Issues signed `UploadPartCommand` URLs for each chunk.
   - `POST /api/upload/s3/multipart/complete`: Receives part ETags, invokes `CompleteMultipartUploadCommand`, and fetches `HeadObjectCommand` from S3.
2. **Recorded Video Flow**:
   - `POST /api/recordings/:id/upload`: Accepts multipart FormData or direct URLs, uploads to AWS S3 via `s3Service.uploadFile` or Cloudinary, updates `Recording` model, and synchronizes with any attached course lesson.

### 2.2 System Storage Comparison

| Metadata Field | Database Schema Property | S3 Object Metadata Source | Previous Behavior | Corrected Behavior |
| :--- | :--- | :--- | :--- | :--- |
| **Original Filename** | `resourceSchema.fileName`, `resourceSchema.originalFileName`, `Recording.lessonTitle` | S3 Key / request body | Preserved | Preserved and normalized |
| **File Size (Bytes)** | `lessonSchema.videoBytes`, `resourceSchema.bytes`, `resourceSchema.fileSize`, `resourceSchema.size`, `Recording.bytes` | S3 `HeadObject.ContentLength` or `buffer.length` | **Broken**: Multipart completion only set `fileSize` and `size` (omitted `bytes`); `addLesson` only checked top-level `req.body.videoBytes` (ignored `videoParts`); `toResourceObj` did not cross-fallback. Resulted in `0` bytes in MongoDB and API responses. | **Fixed**: Stored actual bytes across `videoBytes`, `bytes`, `fileSize`, `size`; cross-synced between lesson and parts. |
| **Duration (Seconds)** | `lessonSchema.videoDuration`, `resourceSchema.duration`, `Recording.duration` | Client-provided metadata (HTML5 DOM / encoder) | **Broken**: S3 does not return media duration in headers. `completeMultipartUpload` dropped client duration; `addLesson` ignored duration in `videoParts`; `serializeLesson` returned `0` if top-level lesson was `0`. | **Fixed**: Captured in `completeMultipartUpload`, persisted in `addLesson` and `updateLesson`, synchronized across `videoDuration`, `duration`, and auto-formatted `durationOrPages`. |
| **Storage Key & MIME** | `s3Key`, `contentType`, `mimetype` | S3 Key / `HeadObject.ContentType` | Preserved | Preserved and validated |
| **Resolution Specs** | `Recording.width`, `Recording.height`, `Recording.resolution`, `Recording.qualityTag` | Ingest parameters | Defaulted to 1080p; `formattedSize` defaulted to hardcoded dummy `'12.5 MB'` when bytes was 0. | **Fixed**: Real dimensions formatted; removed dummy `'12.5 MB'` fallback (returns `''` when unknown). |

---

## 3. Root Cause Analysis

### Root Cause 1: Desynchronization Between Top-Level Lesson Fields and Nested `videoParts`
When the Admin Portal creates or updates a lesson with an uploaded video, modern frontend clients submit an array of video items:
```json
{
  "lessonTitle": "Lecture 1",
  "lessonType": "Recorded Video",
  "videoParts": [
    {
      "s3Key": "videos/1791...mp4",
      "fileName": "lecture1.mp4",
      "contentType": "video/mp4",
      "fileSize": 154200000,
      "duration": 3600
    }
  ]
}
```
In `controllers/courseController.js`:
- `videoBytes` was extracted only from top-level `req.body.videoBytes || req.body.bytes || req.body.size`.
- `videoDuration` was extracted only from top-level `req.body.videoDuration || req.body.duration`.
Because the frontend submitted them inside `videoParts`, `videoBytes` was saved as `0` and `videoDuration` was saved as `0` on the Lesson document.

### Root Cause 2: Asymmetric Field Names in `toResourceObj` and `serializeLesson`
In `courseController.js`:
- In `toResourceObj`:
  ```javascript
  size: typeof item.size === 'number' ? item.size : (Number(item.size) || 0),
  bytes: typeof item.bytes === 'number' ? item.bytes : (Number(item.bytes || item.size) || 0),
  fileSize: typeof item.fileSize === 'number' ? item.fileSize : (Number(item.fileSize || item.size) || 0),
  ```
  If incoming data had `fileSize` (as returned by S3 multipart completion), but `bytes` was undefined, `bytes` became `0`. If frontend components checked `part.bytes`, they received `0`.
- In `serializeLesson`:
  ```javascript
  videoBytes: lesson.videoBytes || 0,
  videoDuration: lesson.videoDuration || 0,
  ```
  Even if `videoParts[0]` contained valid `fileSize` and `duration`, `serializeLesson` ignored them if `lesson.videoBytes` or `lesson.videoDuration` was `0`.

### Root Cause 3: S3 Multipart Completion Dropped Duration and Omitted `bytes`
In `controllers/s3UploadController.js`:
- `makeReference` only returned `fileSize` and `size`, completely omitting `bytes`.
- Client-provided `duration` was omitted from `makeReference` and was not saved on linked `Recording` models.

### Root Cause 4: Hardcoded `'12.5 MB'` Dummy Size in `recordingController.js`
In `recordingController.js` (`calculateResolutionMetrics`):
```javascript
if (formattedBytes > 0) {
  // format size...
} else {
  formattedSize = '12.5 MB'; // Dummy placeholder
}
```
When recording bytes were unknown, the system reported a fabricated `12.5 MB`, violating accurate metadata reporting principles.

---

## 4. Implemented Fixes

### 4.1 S3 Upload Controller (`controllers/s3UploadController.js`)
- **`makeReference`**:
  - Sets `fileSize`, `size`, and `bytes` to `resolvedSize` (from S3 `HeadObjectCommand.ContentLength`).
  - Accepts `duration` (in seconds) and populates `duration` and `videoDuration` when provided.
- **`completeMultipartUpload`**:
  - Captures `req.body.duration` / `req.body.videoDuration`.
  - Saves `recording.bytes = objectMetadata.ContentLength` and `recording.duration = duration` on any linked `Recording` document.
  - Passes duration to `makeReference`.

### 4.2 Course Curriculum Controller (`controllers/courseController.js`)
- **`toResourceObj`**:
  - Cross-fallbacks `bytes`, `fileSize`, and `size`: resolves to non-zero byte count across any available property.
  - Cross-fallbacks `duration` and `videoDuration`: resolves to non-zero duration in seconds.
- **`addLesson` & `updateLesson`**:
  - Automatically syncs `videoBytes` and `videoDuration` from `finalVideoParts[0]` if top-level fields are 0/falsy.
  - Reciprocally populates `bytes`, `fileSize`, `size`, `duration`, and `videoDuration` onto each video part if parts had 0 but lesson-level metadata was known.
  - Auto-populates `durationOrPages` with `${Math.round(duration)} sec` if empty.
- **`serializeLesson`**:
  - Cross-fallbacks `videoBytes` and `videoDuration` from `firstVideo` if `lesson.videoBytes` or `lesson.videoDuration` is 0.
  - In `sanitizeResource`, guarantees that every video part retains `bytes`, `fileSize`, `size`, `duration`, and `videoDuration`.
  - Exposes `videoBytes`, `bytes`, `fileSize`, `size`, `videoDuration`, `duration`, and `durationOrPages`.

### 4.3 Recording Controller (`controllers/recordingController.js`)
- **`calculateResolutionMetrics`**:
  - Removed dummy `'12.5 MB'` fallback. Returns `''` when unknown.
- **`formatRecordingDocument`**:
  - Exposes `bytes`, `videoBytes`, `size`, `duration`, `videoDuration`, and formatted `fileSize`.
- **`uploadRecordingVideo`**:
  - Extracts byte size from `uploaded.bytes`, `uploaded.fileSize`, `req.body.fileSize`, `req.body.bytes`, or `buffer.length`.
  - Extracts duration from `req.body.duration` or `req.body.videoDuration`.
  - Synchronizes URL, bytes, and duration into any attached Course lesson's `videoParts`, `videoBytes`, and `videoDuration`.

---

## 5. API Response Contract Specification

### 5.1 Lesson Response Contract (`/api/admin/courses/:id/...`)

```typescript
interface SerializedLesson {
  _id: string;
  id: string;
  lessonTitle: string;
  lessonType: "Recorded Video" | "Live Class" | "PDF Notes" | string;
  videoUrl: string; // Absolute or signed playback URL
  videoPublicId: string;
  videoResourceType: string;
  
  // File size in bytes (all synchronized for backward and forward compatibility)
  videoBytes: number; // e.g. 152000000
  bytes: number;      // e.g. 152000000
  fileSize: number;   // e.g. 152000000
  size: number;       // e.g. 152000000

  // Duration in seconds
  videoDuration: number; // e.g. 2400 (seconds)
  duration: number;      // e.g. 2400 (seconds)
  durationOrPages: string; // e.g. "2400 sec" (or "" if unknown)

  videoParts: Array<{
    title: string;
    fileName: string;
    originalFileName: string;
    url: string;
    secure_url: string;
    storageProvider: "s3" | "cloudinary";
    s3Key: string;
    contentType: string;
    mimetype: string;
    bytes: number;         // File size in bytes
    fileSize: number;      // File size in bytes
    size: number;          // File size in bytes
    duration: number;      // Duration in seconds
    videoDuration: number; // Duration in seconds
  }>;
}
```

### 5.2 Recording Response Contract (`/api/recordings`)

```typescript
interface SerializedRecording {
  _id: string;
  courseName: string;
  lessonTitle: string;
  recordedVideoUrl: string;
  s3Key: string;
  storageProvider: "s3" | "cloudinary";
  status: "stopped" | "recording" | "pending";

  // File size metadata
  bytes: number;       // Exact file size in bytes (e.g. 52428800)
  videoBytes: number;  // Exact file size in bytes
  size: number;        // Exact file size in bytes
  fileSize: string;    // Human-readable formatted string (e.g. "50 MB", or "" if unknown)

  // Duration metadata
  duration: string;      // Formatted duration string (e.g. "18:45" or "1125 sec")
  videoDuration: number; // Numeric seconds (e.g. 1125, or 0 if unknown)
}
```

---

## 6. Verification and Test Results

### 6.1 Automated Test Execution

| Test Suite | Command | Exit Code | Result | Key Checks |
| :--- | :--- | :--- | :--- | :--- |
| **Video Metadata Suite** | `node tests/video-metadata.test.js` | `0` | **PASS (6/6)** | Multipart completion fileSize/bytes/duration, `addLesson` extraction from `videoParts`, `updateLesson` sync, `serializeLesson` fallback, legacy recording graceful empty metadata, `uploadRecordingVideo` persistence. |
| **S3 Media Access Suite** | `node tests/s3-media.test.js` | `0` | **PASS (19/19)** | Presigned uploads, multipart lifecycle, key-only persistence, private signed URL access. |
| **Live Class Meeting URL** | `node tests/live-class-meeting-url.test.js` | `0` | **PASS (5/5)** | Lesson creation and video retention without meeting URL regression. |
| **Live Recording S3 Upload** | `node scripts/test_recording_s3_upload.js` | `0` | **PASS (6/6)** | End-to-end recording upload, S3 key resolution, and multipart link. |

All relevant test suites completed with exit code `0`.

---

## 7. Migration and Deployment Recommendations

1. **Existing Production Records**:
   - For existing lessons created before this fix where `lesson.videoBytes` is `0`, the new serializer automatically falls back to `videoParts[0].bytes` or `videoParts[0].fileSize`.
   - If older records have `0` in both `lesson.videoBytes` and `videoParts`, a maintenance script (`scripts/repair_video_metadata.js`) can perform a non-destructive one-off scan of lessons with S3 keys and update `videoBytes` using S3 `HeadObjectCommand` `ContentLength`.
2. **Video Duration Extraction on Upload**:
   - Because AWS S3 does not extract video duration from MP4 bitstreams during object upload, the Admin Portal and mobile clients should submit the duration (extracted via HTML5 Video element `video.duration` prior to or during upload) in the multipart completion and lesson creation payloads. The backend now captures and persists this metadata reliably.
3. **HTTP 206 Streaming Compatibility**:
   - The HTTP 206 responses observed in the browser Network tab are normal S3 byte-range responses required for HTML5 video seeking. They are fully compatible with the persisted `videoBytes` and `videoDuration` fields.
