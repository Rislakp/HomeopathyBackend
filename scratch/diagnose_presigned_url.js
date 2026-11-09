/**
 * Diagnose S3 presigned URL generation.
 * Checks credential type, session token presence, and URL structure.
 * Does NOT log credentials or full URLs.
 * 
 * Run from project root: node scratch/diagnose_presigned_url.js
 */
const path = require('path');
const projectRoot = path.resolve(__dirname, '..');

// Load .env from project root
require('dotenv').config({ path: path.join(projectRoot, '.env') });

const { s3Client, bucket, region } = require(path.join(projectRoot, 'config', 's3'));
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { encodeSignedUrl } = require(path.join(projectRoot, 'utils', 's3MediaSigner'));

async function diagnose() {
  console.log('=== S3 Presigned URL Diagnostic ===\n');

  // 1. Check credential type (without exposing values)
  const accessKeyId = (
    process.env.AWS_ACCESS_KEY_ID ||
    process.env.S3_ACCESS_KEY ||
    process.env.AWS_KEY ||
    ''
  ).trim().replace(/^["']|["']$/g, '');
  
  const sessionToken = (
    process.env.AWS_SESSION_TOKEN ||
    process.env.AWS_SECURITY_TOKEN ||
    ''
  ).trim().replace(/^["']|["']$/g, '');

  console.log('Credential type:', accessKeyId.startsWith('ASIA') ? 'TEMPORARY (STS)' : accessKeyId.startsWith('AKIA') ? 'PERMANENT (IAM)' : accessKeyId ? 'UNKNOWN prefix: ' + accessKeyId.substring(0, 4) : 'NOT SET in env');
  console.log('Session token present:', sessionToken.length > 0 ? `YES (${sessionToken.length} chars)` : 'NO');
  if (sessionToken.length > 0) {
    console.log('Session token has + chars:', sessionToken.includes('+') ? 'YES' : 'NO');
  }
  console.log('Region:', region);
  console.log('Bucket:', bucket);
  console.log();

  // 2. Resolve credentials from the S3 client
  let resolvedCreds;
  try {
    const credProvider = s3Client.config.credentials;
    resolvedCreds = typeof credProvider === 'function' ? await credProvider() : credProvider;
    console.log('Resolved credential type:', resolvedCreds.accessKeyId?.startsWith('ASIA') ? 'TEMPORARY' : resolvedCreds.accessKeyId?.startsWith('AKIA') ? 'PERMANENT' : 'UNKNOWN');
    console.log('Resolved sessionToken present:', resolvedCreds.sessionToken ? `YES (${resolvedCreds.sessionToken.length} chars)` : 'NO');
    if (resolvedCreds.sessionToken) {
      console.log('Resolved sessionToken has + chars:', resolvedCreds.sessionToken.includes('+') ? 'YES - encoding needed' : 'NO');
      const plusCount = (resolvedCreds.sessionToken.match(/\+/g) || []).length;
      console.log('Number of + chars in session token:', plusCount);
    }
    if (resolvedCreds.expiration) {
      const exp = new Date(resolvedCreds.expiration);
      console.log('Credential expiration:', exp.toISOString(), exp < new Date() ? '*** EXPIRED ***' : '(valid)');
    }
  } catch (err) {
    console.error('Failed to resolve credentials:', err.message);
  }
  console.log();

  // 3. Generate a test presigned URL and analyze its structure
  const testKey = 'pdfs/test-diagnostic-key.pdf';
  try {
    const rawUrl = await getSignedUrl(s3Client, new GetObjectCommand({
      Bucket: bucket,
      Key: testKey,
      ResponseContentType: 'application/pdf',
      ResponseContentDisposition: 'inline',
    }), { expiresIn: 900 });

    const parsed = new URL(rawUrl);
    console.log('=== Raw Presigned URL Analysis ===');
    console.log('Host:', parsed.hostname);
    console.log('Path:', parsed.pathname);
    console.log('Query parameters:');
    for (const [k, v] of parsed.searchParams.entries()) {
      if (k === 'X-Amz-Security-Token') {
        console.log(`  ${k}: [${v.length} chars] has_plus=${v.includes('+')} has_encoded_plus=${v.includes('%2B')}`);
      } else if (k === 'X-Amz-Signature') {
        console.log(`  ${k}: [redacted, ${v.length} chars]`);
      } else if (k === 'X-Amz-Credential') {
        console.log(`  ${k}: ${v.substring(0, 4)}****/...`);
      } else {
        console.log(`  ${k}: ${v}`);
      }
    }
    console.log('Raw URL has literal + chars:', rawUrl.includes('+') ? 'YES' : 'NO');
    
    // 4. Test encodeSignedUrl
    const encodedUrl = encodeSignedUrl(rawUrl);
    console.log('\n=== After encodeSignedUrl() ===');
    console.log('Encoded URL has literal + chars:', encodedUrl.includes('+') ? 'YES' : 'NO');
    console.log('Encoded URL has %2B:', encodedUrl.includes('%2B') ? 'YES' : 'NO');
    
    // 5. Check if encoding changes the URL at all
    console.log('URL changed by encoding:', rawUrl !== encodedUrl ? 'YES' : 'NO (no + chars to encode)');
    
    // 6. Check for double-encoding risk
    const doubleEncoded = encodeSignedUrl(encodedUrl);
    console.log('Double encoding safe:', encodedUrl === doubleEncoded ? 'YES (idempotent)' : 'NO - DOUBLE ENCODING RISK!');
    if (encodedUrl !== doubleEncoded) {
      console.log('  %2B became %252B:', doubleEncoded.includes('%252B') ? 'YES - THIS IS A BUG!' : 'NO');
    }

  } catch (err) {
    console.error('Failed to generate presigned URL:', err.name, err.message);
  }

  console.log('\n=== Diagnostic Complete ===');
}

diagnose().catch(console.error);
