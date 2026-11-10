const mongoose = require('mongoose');
const { handleJobStateChange } = require('../services/mediaConvertService');
const Course = require('../models/Course');
const Recording = require('../models/Recording');
const DemoVideo = require('../models/DemoVideo');
const VideoConversion = require('../models/VideoConversion');

async function testSync() {
  const targetKey = 'videos/eventbridge-test.mp4';
  const targetVid = 'eventbridge-test';
  const jobId = 'job-eb-888';

  let updatedCourse = false;
  let updatedRecording = false;
  let updatedDemo = false;
  let updatedVC = false;

  VideoConversion.findOne = () => ({
    lean: async () => ({
      originalS3Key: targetKey,
      videoId: targetVid,
      mediaConvertJobId: jobId,
    }),
  });

  VideoConversion.findOneAndUpdate = async (q, u) => {
    if (q.originalS3Key === targetKey && u.$set.hlsConversionStatus === 'COMPLETED') {
      updatedVC = true;
    }
    return {};
  };

  Course.updateMany = async (q, u, opts) => {
    if (u.$set['modules.$[].lessons.$[les].hlsConversionStatus'] === 'COMPLETED') {
      updatedCourse = true;
    }
    return { modifiedCount: 1 };
  };

  Recording.updateMany = async (q, u) => {
    if (q.s3Key === targetKey && u.$set.hlsConversionStatus === 'COMPLETED') {
      updatedRecording = true;
    }
    return { modifiedCount: 1 };
  };

  DemoVideo.updateMany = async (q, u) => {
    if (q.s3Key === targetKey && u.$set.hlsConversionStatus === 'COMPLETED') {
      updatedDemo = true;
    }
    return { modifiedCount: 1 };
  };

  // Dispatch EventBridge COMPLETE
  const result = await handleJobStateChange({
    detail: {
      jobId,
      status: 'COMPLETE',
      userMetadata: { s3Key: targetKey, videoId: targetVid },
    },
  });

  console.log('Result Success:', result.success);
  console.log('Result Status:', result.status);
  console.log('Updated VideoConversion:', updatedVC);
  console.log('Updated Course:', updatedCourse);
  console.log('Updated Recording:', updatedRecording);
  console.log('Updated DemoVideo:', updatedDemo);

  if (result.success && updatedVC && updatedCourse && updatedRecording && updatedDemo) {
    console.log('ALL MODELS SYNCED SUCCESSFULLY!');
  } else {
    console.error('SYNC VERIFICATION FAILED');
    process.exit(1);
  }
}

testSync().catch(console.error);

