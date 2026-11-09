const mongoose = require('mongoose');
const { syncHlsDatabaseRecords, handleJobStateChange, getHlsConversionStatus } = require('../services/mediaConvertService');
const VideoConversion = require('../models/VideoConversion');

async function testLifecycle() {
  const testKey = 'videos/lifecycle-test.mp4';
  const testVid = 'lifecycle-test';
  let memoryDb = {};

  // Mock VideoConversion model
  VideoConversion.findOneAndUpdate = async (query, update, opts) => {
    const key = query.originalS3Key;
    memoryDb[key] = { ...(memoryDb[key] || {}), ...query, ...update.$set };
    return memoryDb[key];
  };

  VideoConversion.findOne = (query) => {
    let targetKey = query.originalS3Key;
    if (query.$or) {
      const orKey = query.$or.find(c => c.originalS3Key)?.originalS3Key;
      if (orKey) targetKey = orKey;
    }
    let rec = targetKey ? memoryDb[targetKey] : null;
    if (!rec && query.mediaConvertJobId) {
      rec = Object.values(memoryDb).find(r => r.mediaConvertJobId === query.mediaConvertJobId);
    }
    const p = Promise.resolve(rec || null);
    p.lean = async () => rec || null;
    return p;
  };

  // 1. Initial enqueue -> PENDING
  await syncHlsDatabaseRecords({
    s3Key: testKey,
    videoId: testVid,
    status: 'PENDING',
    outputPrefix: 'hls/' + testVid + '/',
  });
  let s1 = await getHlsConversionStatus(testKey);
  console.log('Step 1 (Enqueue):', s1.hlsConversionStatus === 'PENDING' ? 'PASS (PENDING)' : 'FAIL');

  // 2. Job submitted -> PROCESSING
  await syncHlsDatabaseRecords({
    s3Key: testKey,
    videoId: testVid,
    status: 'PROCESSING',
    jobId: 'job-life-101',
    outputPrefix: 'hls/' + testVid + '/',
  });
  let s2 = await getHlsConversionStatus(testKey);
  console.log('Step 2 (Submitted):', s2.hlsConversionStatus === 'PROCESSING' && s2.mediaConvertJobId === 'job-life-101' ? 'PASS (PROCESSING)' : 'FAIL');

  // 3. EventBridge COMPLETE -> COMPLETED
  await handleJobStateChange({
    detail: {
      jobId: 'job-life-101',
      status: 'COMPLETE',
      userMetadata: { s3Key: testKey, videoId: testVid },
    }
  });
  let s3 = await getHlsConversionStatus(testKey);
  console.log('Step 3 (Complete):', s3.hlsConversionStatus === 'COMPLETED' && s3.hlsMasterUrl.includes(testVid + '.m3u8') ? 'PASS (COMPLETED)' : 'FAIL');

  // 4. Reset & test ERROR -> FAILED
  await handleJobStateChange({
    detail: {
      jobId: 'job-life-101',
      status: 'ERROR',
      errorMessage: 'Audio codec unsupported',
      userMetadata: { s3Key: testKey, videoId: testVid },
    }
  });
  let s4 = await getHlsConversionStatus(testKey);
  console.log('Step 4 (Error):', s4.hlsConversionStatus === 'FAILED' && s4.error === 'Audio codec unsupported' ? 'PASS (FAILED)' : 'FAIL');
}

testLifecycle().catch(console.error);
