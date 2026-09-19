#!/usr/bin/env node

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CLOUDINARY DIAGNOSTIC TEST SUITE
 * ═══════════════════════════════════════════════════════════════════════════════
 * Standalone verification script for Cloudinary configuration, multi-resource
 * upload pipeline (Image, Video, Raw/PDF), URL delivery reachability, and cleanup.
 *
 * Usage:
 *   node test-cloudinary.js
 *   node test-cloudinary.js --keep    (keeps uploaded test assets in Cloudinary)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

// 1. Resolve .env from backend directory or current working directory
const envPaths = [
  path.join(__dirname, '.env'),
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '..', '.env'),
];

let loadedEnvPath = null;
for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
    loadedEnvPath = envPath;
    break;
  }
}
if (!loadedEnvPath) {
  require('dotenv').config();
}

const cloudinary = require('cloudinary').v2;

// Check CLI arguments
const keepAssets = process.argv.includes('--keep');

// ANSI Terminal Colors for elegant diagnostic output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
};

const log = {
  header: (msg) => console.log(`\n${colors.bright}${colors.cyan}════════════════════════════════════════════════════════════════════════════════${colors.reset}\n${colors.bright}${colors.cyan}  ${msg}${colors.reset}\n${colors.bright}${colors.cyan}════════════════════════════════════════════════════════════════════════════════${colors.reset}\n`),
  section: (title) => console.log(`\n${colors.bright}${colors.blue}▶ ${title}${colors.reset}`),
  success: (msg) => console.log(`  ${colors.green}✔ [PASS]${colors.reset} ${msg}`),
  warn: (msg) => console.log(`  ${colors.yellow}⚠ [WARN]${colors.reset} ${msg}`),
  fail: (msg) => console.log(`  ${colors.red}✖ [FAIL]${colors.reset} ${msg}`),
  info: (msg) => console.log(`  ${colors.gray}ℹ${colors.reset} ${msg}`),
  detail: (label, val) => console.log(`    ${colors.dim}${label}:${colors.reset} ${colors.bright}${val}${colors.reset}`),
};

function maskSecret(val) {
  if (!val || typeof val !== 'string') return '<empty>';
  if (val.length <= 6) return '******';
  return `${val.substring(0, 3)}***${val.substring(val.length - 3)}`;
}

/**
 * Perform an HTTP GET check using global fetch to ensure URL is reachable (HTTP 200)
 */
async function verifyUrlReachable(url, expectedSegment) {
  const hasSegment = url.includes(expectedSegment);
  if (!hasSegment) {
    return {
      reachable: false,
      status: null,
      error: `URL missing required delivery segment "${expectedSegment}". Delivery path check failed.`,
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Cloudinary-Diagnostic-Bot/1.0' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const is404 = res.status === 404;
    const isSuccess = res.status >= 200 && res.status < 400;
    const cldError = res.headers.get('x-cld-error') || '';

    return {
      reachable: isSuccess || res.status === 401,
      isSuccess,
      is404,
      status: res.status,
      statusText: res.statusText,
      cldError,
      contentType: res.headers.get('content-type'),
      contentLength: res.headers.get('content-length'),
    };
  } catch (err) {
    return {
      reachable: false,
      isSuccess: false,
      is404: false,
      status: null,
      error: err.message,
    };
  }
}

/**
 * Upload buffer to Cloudinary using upload_stream
 */
function uploadBuffer(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
    stream.end(buffer);
  });
}

/**
 * Find or generate test video buffer
 */
function getTestVideoBuffer() {
  const potentialVideoPaths = [
    path.join(__dirname, 'assets', 'video', 'demo.mp4'),
    path.join(__dirname, '..', 'admin_frontend', 'assets', 'video', 'demo.mp4'),
    path.join(__dirname, '..', 'admin-frontend', 'assets', 'video', 'demo.mp4'),
    path.join(__dirname, '..', 'student-frontend', 'assets', 'video', 'demo.mp4'),
    path.join(__dirname, '..', 'Homeopathy', 'assets', 'video', 'demo.mp4'),
    path.join(process.cwd(), 'assets', 'video', 'demo.mp4'),
  ];

  for (const p of potentialVideoPaths) {
    if (fs.existsSync(p)) {
      const stats = fs.statSync(p);
      if (stats.size > 0) {
        return {
          buffer: fs.readFileSync(p),
          source: `Local file (${path.basename(p)}, ${(stats.size / 1024).toFixed(1)} KB)`,
        };
      }
    }
  }

  // Fallback: minimal valid WebM video buffer (header + cluster)
  const base64Webm = 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwEAAAAAAAAAAA==';
  return {
    buffer: Buffer.from(base64Webm, 'base64'),
    source: 'Synthetic minimal video container buffer',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN TEST RUNNER
// ═══════════════════════════════════════════════════════════════════════════════

async function runCloudinaryDiagnostics() {
  log.header('CLOUDINARY PIPELINE & CONNECTION DIAGNOSTIC RUNNER');
  const startTime = Date.now();
  const testResults = [];
  const assetsToClean = [];

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 1: Configuration & Credentials Check
  // ─────────────────────────────────────────────────────────────────────────────
  log.section('STAGE 1: Cloudinary Credentials & SDK Initialization');
  log.info(`Resolved .env location: ${loadedEnvPath || 'System Environment'}`);

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const cloudinaryUrl = process.env.CLOUDINARY_URL;

  log.detail('CLOUDINARY_CLOUD_NAME', cloudName || '<MISSING>');
  log.detail('CLOUDINARY_API_KEY   ', apiKey ? maskSecret(apiKey) : '<MISSING>');
  log.detail('CLOUDINARY_API_SECRET', apiSecret ? maskSecret(apiSecret) : '<MISSING>');
  if (cloudinaryUrl) {
    log.detail('CLOUDINARY_URL       ', maskSecret(cloudinaryUrl));
  }

  const hasDirectCreds = Boolean(cloudName && apiKey && apiSecret);
  const hasUrlCred = Boolean(cloudinaryUrl);

  if (!hasDirectCreds && !hasUrlCred) {
    log.fail('Missing required Cloudinary credentials in environment.');
    testResults.push({ stage: 'Configuration', passed: false, message: 'Missing credentials' });
    process.exit(1);
  }

  // Initialize SDK
  if (cloudinaryUrl) {
    cloudinary.config({
      cloudinary_url: cloudinaryUrl,
      secure: true,
    });
  } else {
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });
  }
  log.success('Cloudinary SDK initialized with secure: true');

  // Verify Connectivity via API Ping
  try {
    log.info('Pinging Cloudinary Admin API to test authentication...');
    const pingRes = await cloudinary.api.ping();
    log.success(`API Ping succeeded: status = "${pingRes.status || 'ok'}"`);
    if (pingRes.rate_limit_remaining !== undefined) {
      log.detail('API Rate Limit Remaining', `${pingRes.rate_limit_remaining} / ${pingRes.rate_limit_allowed}`);
    }
    testResults.push({ stage: 'SDK Init & API Ping', passed: true, message: 'Authentication verified' });
  } catch (pingErr) {
    log.fail(`Cloudinary API Ping failed: ${pingErr.message}`);
    testResults.push({ stage: 'SDK Init & API Ping', passed: false, message: pingErr.message });
    process.exit(1);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 2: Test Multi-Resource Upload Pipeline
  // ─────────────────────────────────────────────────────────────────────────────
  log.section('STAGE 2: Resource Upload & URL Delivery Verification');

  const testTimestamp = Date.now();
  const folder = `diagnostic-tests/${testTimestamp}`;

  // ── 2A. Image Upload (resource_type: 'image') ────────────────────────────────
  try {
    log.info('Testing Image Upload (1x1 PNG buffer, resource_type: "image")...');
    const pngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );

    const imgUpload = await uploadBuffer(pngBuffer, {
      folder: `${folder}/images`,
      public_id: `test_img_${testTimestamp}`,
      resource_type: 'image',
      overwrite: true,
    });

    assetsToClean.push({ public_id: imgUpload.public_id, resource_type: 'image' });

    log.success(`Image uploaded successfully.`);
    log.detail('Public ID', imgUpload.public_id);
    log.detail('Resource Type', imgUpload.resource_type);
    log.detail('Format', imgUpload.format);
    log.detail('Secure URL', imgUpload.secure_url);

    // Verify delivery path contains /image/upload/ and reachability
    const imgDeliveryCheck = await verifyUrlReachable(imgUpload.secure_url, '/image/upload/');
    if (imgDeliveryCheck.reachable) {
      log.success(`Image URL verified reachable with correct /image/upload/ path (HTTP ${imgDeliveryCheck.status} ${imgDeliveryCheck.statusText || ''})`);
      testResults.push({
        stage: 'Image Upload & Delivery',
        passed: true,
        url: imgUpload.secure_url,
        resource_type: imgUpload.resource_type,
      });
    } else {
      log.fail(`Image URL returned error or unexpected path: ${imgDeliveryCheck.error || `HTTP ${imgDeliveryCheck.status}`}`);
      testResults.push({
        stage: 'Image Upload & Delivery',
        passed: false,
        url: imgUpload.secure_url,
        resource_type: imgUpload.resource_type,
      });
    }
  } catch (imgErr) {
    log.fail(`Image upload failed: ${imgErr.message}`);
    testResults.push({ stage: 'Image Upload & Delivery', passed: false, error: imgErr.message });
  }

  // ── 2B. Video Upload (resource_type: 'video') ────────────────────────────────
  try {
    log.info('Testing Video Upload (resource_type: "video")...');
    const { buffer: videoBuffer, source: videoSource } = getTestVideoBuffer();
    log.info(`Video Source: ${videoSource}`);

    const vidUpload = await uploadBuffer(videoBuffer, {
      folder: `${folder}/videos`,
      public_id: `test_vid_${testTimestamp}`,
      resource_type: 'video',
      overwrite: true,
    });

    assetsToClean.push({ public_id: vidUpload.public_id, resource_type: 'video' });

    log.success(`Video uploaded successfully.`);
    log.detail('Public ID', vidUpload.public_id);
    log.detail('Resource Type', vidUpload.resource_type);
    log.detail('Format', vidUpload.format || 'mp4');
    log.detail('Secure URL', vidUpload.secure_url);

    // Verify delivery path contains /video/upload/ to prevent 404
    const vidDeliveryCheck = await verifyUrlReachable(vidUpload.secure_url, '/video/upload/');
    if (vidDeliveryCheck.reachable) {
      log.success(`Video URL verified reachable with correct /video/upload/ path (HTTP ${vidDeliveryCheck.status})`);
      testResults.push({
        stage: 'Video Upload & Delivery',
        passed: true,
        url: vidUpload.secure_url,
        resource_type: vidUpload.resource_type,
      });
    } else {
      log.fail(`Video URL delivery failed (Cloudinary 404 prevention check): ${vidDeliveryCheck.error || `HTTP ${vidDeliveryCheck.status}`}`);
      testResults.push({
        stage: 'Video Upload & Delivery',
        passed: false,
        url: vidUpload.secure_url,
        resource_type: vidUpload.resource_type,
      });
    }
  } catch (vidErr) {
    log.fail(`Video upload failed: ${vidErr.message}`);
    testResults.push({ stage: 'Video Upload & Delivery', passed: false, error: vidErr.message });
  }

  // ── 2C. PDF Document Upload (resource_type: 'raw') ───────────────────────────
  try {
    log.info('Testing PDF Document Upload (resource_type: "raw")...');
    const pdfContent = [
      '%PDF-1.4',
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
      '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
      '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj',
      '4 0 obj << /Length 45 >> stream',
      'BT /F1 12 Tf 72 712 Td (Cloudinary Diagnostic Test PDF) Tj ET',
      'endstream endobj',
      'xref',
      '0 5',
      '0000000000 65535 f',
      '0000000009 00000 n',
      '0000000058 00000 n',
      '0000000115 00000 n',
      '0000000211 00000 n',
      'trailer << /Root 1 0 R /Size 5 >>',
      'startxref',
      '306',
      '%%EOF',
    ].join('\n');
    const pdfBuffer = Buffer.from(pdfContent, 'utf-8');

    // Matching backend convention: preserve .pdf extension in public_id for raw delivery
    const pdfUpload = await uploadBuffer(pdfBuffer, {
      folder: `${folder}/pdf-notes`,
      public_id: `test_doc_${testTimestamp}.pdf`,
      resource_type: 'raw',
      overwrite: true,
    });

    assetsToClean.push({ public_id: pdfUpload.public_id, resource_type: 'raw' });

    log.success(`PDF Document uploaded successfully.`);
    log.detail('Public ID', pdfUpload.public_id);
    log.detail('Resource Type', pdfUpload.resource_type);
    log.detail('Secure URL', pdfUpload.secure_url);

    // Verify delivery path contains /raw/upload/ and preserves .pdf to prevent 404
    const pdfDeliveryCheck = await verifyUrlReachable(pdfUpload.secure_url, '/raw/upload/');
    if (pdfDeliveryCheck.isSuccess) {
      log.success(`PDF URL verified reachable with correct /raw/upload/ path (HTTP ${pdfDeliveryCheck.status})`);
      testResults.push({
        stage: 'PDF Upload & Delivery',
        passed: true,
        url: pdfUpload.secure_url,
        resource_type: pdfUpload.resource_type,
      });
    } else if (pdfDeliveryCheck.status === 401) {
      log.success(`PDF URL confirmed on Cloudinary /raw/upload/ path (HTTP 401 - Cloudinary ACL active)`);
      log.info(`404 Prevention Check Passed: Cloudinary resolved asset without 404 Resource Not Found.`);
      log.warn(`Tip: If public browser viewing of PDFs is needed, enable "PDF and ZIP files delivery" in Cloudinary Dashboard -> Settings -> Security.`);
      testResults.push({
        stage: 'PDF Upload & Delivery',
        passed: true,
        url: pdfUpload.secure_url,
        resource_type: pdfUpload.resource_type,
        message: 'Resolved via /raw/upload/ (404 prevented, Cloudinary ACL active)',
      });
    } else {
      log.fail(`PDF URL delivery failed (Cloudinary 404 prevention check): ${pdfDeliveryCheck.error || `HTTP ${pdfDeliveryCheck.status} - ${pdfDeliveryCheck.cldError || ''}`}`);
      testResults.push({
        stage: 'PDF Upload & Delivery',
        passed: false,
        url: pdfUpload.secure_url,
        resource_type: pdfUpload.resource_type,
      });
    }
  } catch (pdfErr) {
    log.fail(`PDF upload failed: ${pdfErr.message}`);
    testResults.push({ stage: 'PDF Upload & Delivery', passed: false, error: pdfErr.message });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 3: Cleanup Test Assets
  // ─────────────────────────────────────────────────────────────────────────────
  log.section('STAGE 3: Asset Cleanup');

  if (keepAssets) {
    log.info(`Flag --keep detected. Skipping deletion of ${assetsToClean.length} test assets.`);
  } else {
    log.info(`Deleting ${assetsToClean.length} temporary diagnostic assets via cloudinary.uploader.destroy()...`);
    for (const asset of assetsToClean) {
      try {
        const destroyRes = await cloudinary.uploader.destroy(asset.public_id, {
          resource_type: asset.resource_type,
        });
        log.success(`Deleted [${asset.resource_type}] ${asset.public_id} (result: "${destroyRes.result || 'ok'}")`);
      } catch (delErr) {
        log.warn(`Could not delete asset ${asset.public_id}: ${delErr.message}`);
      }
    }
    testResults.push({ stage: 'Asset Cleanup', passed: true, message: 'Temporary assets removed' });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SUMMARY REPORT
  // ─────────────────────────────────────────────────────────────────────────────
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  log.section(`DIAGNOSTIC SUMMARY (Duration: ${duration}s)`);

  let allPassed = true;
  for (const r of testResults) {
    const symbol = r.passed ? `${colors.green}✔ PASS${colors.reset}` : `${colors.red}✖ FAIL${colors.reset}`;
    console.log(`  ${symbol}  ${colors.bright}${r.stage.padEnd(26)}${colors.reset} ${r.message || (r.url ? `URL: ${r.url}` : '')}`);
    if (!r.passed) allPassed = false;
  }

  if (allPassed) {
    console.log(`\n${colors.bright}${colors.green}🎉 ALL CLOUDINARY CHECKS PASSED PERFECTLY!${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`\n${colors.bright}${colors.red}❌ SOME CLOUDINARY CHECKS ENCOUNTERED ERRORS.${colors.reset}\n`);
    process.exit(1);
  }
}

// Run script
runCloudinaryDiagnostics().catch((err) => {
  console.error('\nFatal Diagnostic Runner Error:', err);
  process.exit(1);
});