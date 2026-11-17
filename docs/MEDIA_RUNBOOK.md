# Media runbook: videos, PDFs and images

What to do when a video, PDF or image doesn't load. Start with the **symptom table**, run the matching check, apply the fix.

## How media works

```
Admin uploads ──► S3 bucket whitecoat-media-prod (private)
                     │
                     ├── videos/<id>-name.mp4          original upload
                     ├── videos/<id>-name_ios.mp4      720p seek-safe copy (MediaConvert)
                     ├── pdfs/ images/ documents/ attachments/ live_records/
                     └── grand_mock_questions/ reviews/ unani_ranks/

Student opens a lesson/exam ──► API signs a CloudFront link ──► https://media.whitecoat.academy/<key>?Expires=…&Signature=…
```

- The bucket is **private**. A browser can only load a file through a **signed CloudFront link** (`media.whitecoat.academy/...?Expires=...`). A plain S3 link (`...s3.amazonaws.com/...`) or an `api.whitecoat.academy/uploads/...` link to an S3 file will fail.
- Stored references keep the **S3 key** (for example `images/1794...png`), not a signed link. Links are signed when the API serves them (`utils/s3MediaSigner.js`).
- Every video gets a **720p `_ios.mp4`** made by AWS MediaConvert: a keyframe every 2 s, 30 fps, H.264, faststart. Students are always given this file. The original can freeze on seek (iPhone) or time out while loading.

### Video lifecycle after an upload
1. Upload completes → MediaConvert job starts (`services/iosMp4MediaConvertService.js`).
2. While it converts (about 5 min), students get `videoProcessing: true` and a message, not the original (`utils/iosPlaybackState.js`).
3. A checker on the API server (`services/iosMp4Sweeper.js`):
   - every minute, records finished jobs;
   - every 10 minutes, starts conversions that are missing and retries failed ones (up to 3 tries).
4. Students get the `_ios.mp4`. If a video is still not ready 3 hours after its last conversion attempt, they get the original so it never disappears.

## Symptom table

| Symptom | Most likely cause | Check | Fix |
|---|---|---|---|
| Video freezes on seek (iPhone) | Student is getting the original, not `_ios.mp4` | Check 1, and the Network tab: is the URL `..._ios.mp4`? | Check 1. If `[none]`/`[failed]`: Fix A |
| "Video being prepared" for a long time | Conversion still running or failed | Check 1 | Wait 5–10 min. If `failed`: Fix A |
| "Unable to stream / initialization timed out" | Original file being played (big, index at the end) | Network tab: URL has no `_ios` | Wait for the conversion, then refresh. Check 1 |
| File loads with **403**, `server: AmazonS3` | CloudFront has no behavior for that folder, so the request went to the default origin (another bucket) | CloudFront → Behaviors | Fix B |
| File loads with **403**, `server: CloudFront` | Signed link missing, expired, or wrong key group | Is there `?Expires=...&Signature=` in the URL? | Refresh. If still failing: Fix B (key group) |
| Image **404** on `...s3.amazonaws.com/...` or `api.whitecoat.academy/uploads/...` | A link was built or saved instead of the S3 key | Request URL in the Network tab | Make sure `master` has PR #16/#21/#22 (the API re-signs these). Frontend: save `key`, show `previewUrl` |
| **502** from `awselb` | API restarting (deploy) or crashed | GitHub Actions deploy time; `pm2 logs` | If during a deploy: wait 30 s. Otherwise Check 3 |
| MediaConvert `Access Denied` writing output | MediaConvert role can't write `videos/*_ios.mp4` | Error text in Check 1 / `pm2 logs` | Fix C |
| Portrait phone video sideways, or a silent video fails | Handled automatically (rotation AUTO, video-only retry) | Check 1 | Fix A if still `failed` |

## Checks (run on EC2)

```bash
cd /home/ec2-user/HomeopathyBackend
```

**Check 1: what students get for recent videos.** Read-only. Shows the S3 files, conversion record, MediaConvert job status, and the exact URLs the student API returns.
```bash
node scripts/diagnose_video_playback.js                 # uploaded in the last 2 days
node scripts/diagnose_video_playback.js --key=KENT-3    # by name
node scripts/diagnose_video_playback.js --days=7
```

**Check 2: conversion status of every video.**
```bash
node scripts/bulk_ios_mp4_mediaconvert.js --dry-run | grep -v "done (mediaconvert"
```
Lines printed here are not converted yet: `[none]`, `[processing]`, `[failed]`.

**Check 3: server logs.**
```bash
pm2 list
pm2 logs ptblync-backend --lines 300 --nostream | grep -iE "error|ios mp4|mediaconvert"
```
`[iOS MP4 sweep] Started` means the checker is running.

**Check 4: does a file exist in S3?**
```bash
aws s3 ls s3://whitecoat-media-prod/videos/<start-of-file-name>
```

## Fixes

**Fix A: convert missing or failed videos now.** Safe to run any time: finished videos are skipped.
```bash
nohup node scripts/bulk_ios_mp4_mediaconvert.js > /home/ec2-user/ios_mp4_bulk.log 2>&1 &
tail -f /home/ec2-user/ios_mp4_bulk.log
```
For one video: `node scripts/bulk_ios_mp4_mediaconvert.js --key=<part-of-name>`. To redo one that is already done, add `--force`. If a video fails 3 times, the file itself is probably broken: ask the admin to upload it again.

**Fix B: CloudFront behavior missing.** AWS Console → CloudFront → distribution `E2E9EGIGND5NDS` → Behaviors. There must be a behavior for every folder: `/videos/*`, `/hls/*`, `/pdfs/*`, `/images/*`, `/documents/*`, `/attachments/*`, `/live_records/*`, `/grand_mock_questions/*`, `/reviews/*`, `/unani_ranks/*`.
Settings, the same as `/pdfs/*`:
- Origin `whitecoat-media-prod.s3.us-east-1.amazonaws.com`
- Redirect HTTP to HTTPS
- GET, HEAD, OPTIONS
- **Restrict viewer access = Yes**, with the existing trusted key group
- CachingOptimized, CORS-S3Origin, CORS-With-Preflight

Don't change `Default (*)`. Changes take 3–5 minutes to deploy. A new upload folder in code (`SAFE_S3_KEY` in `utils/s3MediaSigner.js`) needs a new behavior here.

**Fix C: MediaConvert can't write output.** IAM → Roles → `MediaConvert_Default_Role` must allow `s3:PutObject`, `s3:AbortMultipartUpload` and `s3:ListMultipartUploadParts` on `arn:aws:s3:::whitecoat-media-prod/videos/*_ios.mp4`.

**S3 bucket policy:** it must keep `"Resource": "arn:aws:s3:::whitecoat-media-prod/*"` for the CloudFront service principal. Don't narrow it to some folders, or images and thumbnails break.

## Settings (EC2 `.env`, then `pm2 restart ptblync-backend --update-env`)

| Variable | Default | Effect |
|---|---|---|
| `HIDE_UNCONVERTED_VIDEOS` | on | `false` = give students the original while converting |
| `IOS_SWEEPER_DISABLED` | off | `true` = stop the background checker |
| `IOS_RENDITION_ENGINE` | `mediaconvert` | `ffmpeg` = convert on the EC2 server instead (slow, CPU heavy) |
| `HLS_AUTO_CONVERT` | off | `true` = also build HLS for new uploads (not used by students when `_ios.mp4` exists) |
| `S3_LEGACY_BUCKET_ALIASES` | `white-coat-academy-media` | Old wrong bucket names in saved links, read back as our bucket |
| `API_PUBLIC_HOSTS` | `api.whitecoat.academy` | Hosts whose `/uploads/<s3 key>` links are read back as S3 keys |

## Deploying safely

Every merge to `master` deploys and runs `pm2 restart`. For about 30 seconds the API returns **502** to everyone. Don't merge during exams or live classes.

## Rules for new code

- Store the **S3 key** (or the `media` object from the upload response), never a signed or built link.
- To display a file right after upload, use `previewUrl` from the upload response.
- Sign links only when serving them: `signS3Reference` / `resolveProfileImageUrl` in `utils/s3MediaSigner.js`.
- Don't hard-code bucket names. Use `bucket` / `region` from `config/s3.js`.
- Run the media tests before merging: `node --test tests/ios-*.test.js tests/question-image-bucket.test.js tests/prefer-ios-mp4.test.js tests/m4v-video-conversion.test.js`
