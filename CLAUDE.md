# HomeopathyBackend

Express + MongoDB (Mongoose) API for the White Coat Academy student and admin apps. Entry point: `server.js`. Deployed to one EC2 instance behind an AWS load balancer by `.github/workflows/deploy-backend.yml` on every push to `master` (`pm2 restart ptblync-backend`, so about 30 s of 502).

## Media (videos, PDFs, images)
Read `docs/MEDIA_RUNBOOK.md` before touching media code or debugging a media issue.

- Files live in the private S3 bucket `whitecoat-media-prod` (`config/s3.js`) and are served only through signed CloudFront links on `media.whitecoat.academy`.
- Store S3 keys, never signed or built links. Sign when serving: `utils/s3MediaSigner.js` (`signS3Reference`, `resolveProfileImageUrl`, `normalizeS3Reference`).
- Every video gets a 720p seek-safe `<original>_ios.mp4` from MediaConvert (`services/iosMp4MediaConvertService.js`). The background checker is `services/iosMp4Sweeper.js`. What students get (ready / processing / original) is decided in `utils/iosPlaybackState.js`.
- Diagnose on EC2 with `node scripts/diagnose_video_playback.js`; convert missing videos with `node scripts/bulk_ios_mp4_mediaconvert.js`.

## Tests
`node --test tests/<file>.test.js`. `npm test` has 4 long-standing failures in S3 signer fallback/TTL/plus-encoding tests, so compare against them rather than expecting all green. Several other files in `tests/` also have long-standing failures. When changing code, run each test file before and after and compare.
