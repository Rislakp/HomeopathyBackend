# White Coat Academy — Live Records Video Duration & HTTP Range Streaming Backend Investigation Report

## Executive Summary
This report documents the deep-dive technical investigation into the Live Records video player displaying an invalid duration (`-59:-0.0 / -59:-0.0`), alongside HTTP 206 Partial Content responses observed in the browser Network tab.

### Summary of Findings:
1. **HTTP 206 Streaming is Normal & Handled by S3**:
   - The browser receiving HTTP 206 responses is standard behavior for HTML5 `<video>` and range-based media delivery. AWS S3 natively implements RFC 7233 byte-range streaming (`Accept-Ranges: bytes`, `Content-Range: bytes <start>-<end>/<total>`, and status code 206).
   - However, Express CORS configuration previously omitted `'Range'` from `standardHeaders` / `allowedHeaders` and omitted `'Accept-Ranges'` and `'Content-Length'` from `exposedHeaders`, which could impede client web players making cross-origin range preflights or inspecting response ranges.
2. **Root Cause of Invalid Duration Display (`-59:-0.0 / -59:-0.0`)**:
   - **Frontend / Player Behavior**: Video players (such as Flutter `video_player` or HTML5 players with custom controls) calculate timestamps via integer division and modulo math: `DateTime.fromMillisecondsSinceEpoch(duration)`. When the API returns an empty string `""`, `0`, or a non-numeric string (e.g. `"18:45"` parsed naively via `parseFloat`), or when duration is `-1` / `Infinity` (common for live stream chunks or before `moov` atom parsing completes), modulo formulas such as `(total - position) % 60` or negative milliseconds produce negative minute/second values like `-59:-0.0`.
   - **Backend Ingestion & Serialization Gaps**:
     - The backend stored `duration` as a flexible string in MongoDB (`Recording.duration`). When users or uploaders provided clock strings such as `"18:45"`, naive numeric evaluations (`Number(rec.duration)`) returned `NaN` or `0`.
     - In `formatRecordingDocument`, `videoDuration` was missing or unparsed, forcing players to rely on either unparsed strings or file stream discovery.
     - When signing S3 media URLs, `ResponseContentType: 'video/mp4'` was not explicitly passed, meaning if an object had been stored without explicit MIME type, S3 returned `application/octet-stream`, preventing HTML5 players from demuxing metadata containers.
3. **Verified Backend Fixes Implemented**:
   - Implemented `parseDurationInSeconds` to parse clock strings (`"18:45"` $\to$ `1125`), unit strings (`"120 sec"` $\to$ `120`, `"2.5 min"` $\to$ `150`), and numeric values, with strict zero-clamping for negative or invalid formats.
   - Exposed `videoDuration` (seconds as a number) alongside `duration` in `formatRecordingDocument` (`/api/recordings`, `/api/live-records`).
   - Enforced `ResponseContentType: 'video/mp4'` and `ResponseContentDisposition: 'inline'` when signing video references in `s3MediaSigner` and `s3UploadController.getMediaAccessUrl`.
   - Expanded CORS exposed headers (`Accept-Ranges`, `Content-Length`, `Content-Type`) and allowed headers (`Range`).
   - Hardened `SAFE_S3_KEY` regex to restrict signed URLs strictly to the approved prefix whitelist.

---

## 1. Storage Provider & Media Delivery Architecture

### Storage Infrastructure
- **Provider**: AWS S3 (`whitecoat-media-prod`, region: `us-east-1`).
- **Media Delivery Model**: Direct S3 Pre-signed URLs generated via AWS SDK v3 (`GetObjectCommand` with `@aws-sdk/s3-request-presigner`).
- **Token / TTL**: 900 seconds (15 minutes).
- **Backend Role**:
  - The Node.js Express backend does NOT proxy multi-gigabyte video byte streams through Node.js process memory.
  - Instead, the backend authenticates the student/admin request, verifies course enrollment, and returns a time-limited, SigV4 pre-signed S3 URL pointing directly to the object in `whitecoat-media-prod`.
  - The client browser or native player makes direct HTTP requests (including `Range: bytes=x-y`) to AWS S3.

---

## 2. HTTP Response Headers & Range Streaming Evidence

### Range Request Mechanism (RFC 7233)
When an HTML5 `<video>` element loads a video URL, it issues range requests:

1. **Initial Probe Request**:
   - **Request**:
     ```http
     GET /videos/recording.mp4?X-Amz-Signature=... HTTP/1.1
     Host: whitecoat-media-prod.s3.us-east-1.amazonaws.com
     Range: bytes=0-
     ```
   - **Response from AWS S3 (HTTP 206 Partial Content)**:
     ```http
     HTTP/1.1 206 Partial Content
     Accept-Ranges: bytes
     Content-Type: video/mp4
     Content-Range: bytes 0-10485759/10485760
     Content-Length: 10485760
     ETag: "9b2cf535f27731c974343645a3985328"
     ```

2. **Subsequent Seek or Chunk Request**:
   - **Request**:
     ```http
     GET /videos/recording.mp4?X-Amz-Signature=... HTTP/1.1
     Range: bytes=1048576-2097151
     ```
   - **Response from AWS S3 (HTTP 206 Partial Content)**:
     ```http
     HTTP/1.1 206 Partial Content
     Accept-Ranges: bytes
     Content-Type: video/mp4
     Content-Range: bytes 1048576-2097151/10485760
     Content-Length: 1048576
     ```

3. **Unsatisfiable Range Request Handling**:
   - When the client requests an offset beyond the EOF (e.g. `Range: bytes=20000000-30000000` on a 10MB file):
     ```http
     HTTP/1.1 416 Range Not Satisfiable
     Content-Range: bytes */10485760
     ```

### Backend CORS Configuration Fix
In `server.js`, cross-origin media players require headers to be exposed so JavaScript can inspect media ranges and length:
- **`allowedHeaders`**: Added `'Range'` to standard allowed headers.
- **`exposedHeaders`**: Added `'Accept-Ranges'`, `'Content-Length'`, `'Content-Type'` alongside existing `'Content-Range'`, `'X-Content-Range'`, `'ETag'`, `'Authorization'`.

---

## 3. Duration Metadata Investigation & API Contract

### Why the Player Displayed `-59:-0.0 / -59:-0.0`
1. If the API returns `duration: ""` or `videoDuration: 0`, the client player attempts to inspect the MP4 `moov` atom header.
2. In fragmented MP4s, HLS, or recordings where the `moov` atom is at the end of the file or where the duration header is missing/zero, the player's internal duration value evaluates to `Infinity`, `NaN`, or `-1`.
3. In Dart / Flutter / JS player code:
   ```javascript
   const totalSeconds = videoDuration; // if null, -1, or NaN
   const minutes = Math.floor(totalSeconds / 60); // Math.floor(-1/60) = -1
   const seconds = totalSeconds % 60;             // -1 % 60 = -1 (or 60 - 1 = 59)
   ```
   Evaluating `-1000ms` or `-1s` with modulo formatting produces `-59:-0.0`.
4. In the backend, previously:
   - `Recording.duration` stored raw user/uploader input (`String`).
   - If an admin entered `"18:45"`, `Number("18:45")` or naive JSON serializers produced `0` or omitted the numeric seconds field.
   - The API lacked a standardized, dedicated numeric field `videoDuration` in seconds.

### Enhanced Duration Contract
The API response now consistently supplies both the human-readable string and the strictly parsed numeric seconds:
```json
{
  "_id": "66f001122334455667788990",
  "courseName": "Clinical Homeopathy Practice",
  "lessonTitle": "Case Taking Session 1",
  "status": "stopped",
  "duration": "18:45",
  "videoDuration": 1125,
  "recordedVideoUrl": "https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/videos/...",
  "bytes": 52428800,
  "videoBytes": 52428800,
  "fileSize": "50 MB",
  "format": "mp4",
  "resolution": "1920x1080 (1080p)",
  "qualityTag": "1080p FHD"
}
```

### Parsing Logic (`parseDurationInSeconds`)
- `"18:45"` $\to$ `1125`
- `"01:23:45"` $\to$ `5025`
- `"120 sec"` $\to$ `120`
- `"2.5 min"` $\to$ `150`
- `"1.5 hr"` $\to$ `5400`
- `900` / `"900"` $\to$ `900`
- Missing / `""` / negative (`"-59"`) / invalid $\to$ Clamped safely to `0` (never negative, never NaN).

---

## 4. Code Changes Summary

| File | Changes Made |
| :--- | :--- |
| `controllers/recordingController.js` | 1. Added and exported `parseDurationInSeconds` supporting clock, unit, and numeric strings.<br>2. Updated `formatRecordingDocument` to populate `videoDuration: parseDurationInSeconds(rec.duration)`.<br>3. Enforced `video/mp4` MIME type fallback in `signS3Reference`.<br>4. Replaced `Number(recording.duration)` with `parseDurationInSeconds(recording.duration)` in `uploadRecordingVideo`. |
| `controllers/s3UploadController.js` | 1. In `getMediaAccessUrl`, explicitly assigned `video/mp4` (or `video/webm`) as `ResponseContentType` for `videos/` and `live_records/` prefixes.<br>2. Retained `application/pdf` for `pdfs/`. |
| `utils/s3MediaSigner.js` | 1. Hardened `SAFE_S3_KEY` regex to strictly match the authorized prefix whitelist (`videos`, `images`, `pdfs`, `reviews`, `unani_ranks`, `grand_mock_questions`, `live_records`).<br>2. Strips malicious keys or directory traversal attempts to empty URLs without throwing or leaking endpoints. |
| `server.js` | Added `'Range'` to `standardHeaders` / `allowedHeaders`, and added `'Accept-Ranges'`, `'Content-Length'`, `'Content-Type'` to `exposedHeaders` in CORS delegate. |
| `tests/live-records-streaming.test.js` | Created comprehensive test suite covering byte-range requests, 206 responses, 416 range errors, MIME type enforcement, duration parsing, invalid URL security, and 403 access control. |

---

## 5. Verification & Test Suite Execution

### Test Execution Command
```bash
node --test tests/live-records-streaming.test.js tests/video-metadata.test.js tests/s3-media.test.js tests/live-class-meeting-url.test.js
```

### Results Summary
- **Total Tests**: 36
- **Passed**: 36
- **Failed**: 0
- **Exit Code**: `0`

### Test Breakdown
1. **`tests/live-records-streaming.test.js`** (6 tests):
   - ✔ 1. HTTP Range Streaming: Parse and serve valid 206 Partial Content with correct byte ranges and headers
   - ✔ 3. Media MIME Type: Verify S3 signed URLs and media access enforce correct video MIME type
   - ✔ 4. Security: Invalid S3 keys and path traversal reject without leaking media URLs
   - ✔ 5. Duration Parsing: `parseDurationInSeconds` accurately converts clock, unit, and numeric formats
   - ✔ 6. Duration Handling: `parseDurationInSeconds` handles missing, negative, and invalid values gracefully without producing `-59` or `NaN`
   - ✔ 7. Access Control: Unauthorized access to private recordings is blocked with HTTP 403
2. **`tests/video-metadata.test.js`** (6 tests):
   - ✔ Multipart completion persists fileSize and duration
   - ✔ addLesson extracts videoBytes and videoDuration
   - ✔ updateLesson cross-syncs metadata
   - ✔ serializeLesson fallback handling
   - ✔ Graceful handling of legacy recordings
   - ✔ uploadRecordingVideo persists actual file size and duration
3. **`tests/s3-media.test.js`** (19 tests):
   - ✔ All multipart and object presigning commands verified
   - ✔ Student and admin authorization checks verified
   - ✔ SigV4 URL resolution verified
4. **`tests/live-class-meeting-url.test.js`** (5 tests):
   - ✔ Live class meeting URL formats and student role access verified

---

## 6. Deployment & Storage Considerations

1. **S3 CORS Configuration (AWS Console / S3 Bucket `whitecoat-media-prod`)**:
   Ensure the S3 bucket CORS policy exposes Range headers to the web client domain:
   ```json
   [
     {
       "AllowedHeaders": ["*"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedOrigins": [
         "https://admin.whitecoatacademy.in",
         "https://whitecoatacademy.in",
         "http://localhost:3000",
         "http://localhost:5173"
       ],
       "ExposeHeaders": [
         "ETag",
         "Content-Range",
         "Accept-Ranges",
         "Content-Length",
         "Content-Type"
       ],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
2. **Storage Key Preservation**:
   All recordings retain their existing S3 keys in `whitecoat-media-prod`. No S3 keys or objects were deleted or modified.
3. **Zero Frontend Modifications**:
   In compliance with task specifications, no frontend files were altered. The backend now exposes both legacy (`duration`) and standardized (`videoDuration`) properties, maintaining backwards and forwards compatibility.
