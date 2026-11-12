const mongoose = require('mongoose');

const videoConversionSchema = new mongoose.Schema(
  {
    originalS3Key: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    originalContentType: {
      type: String,
      trim: true,
      default: 'video/mp4',
    },
    m4vS3Key: {
      type: String,
      trim: true,
      default: '',
    },
    // Which encode settings produced the iOS rendition (see IOS_ENCODE_PROFILE / IOS_MP4_MEDIACONVERT_PROFILE)
    encodeProfile: {
      type: String,
      trim: true,
      default: '',
    },
    // MediaConvert job that is building the 720p iOS MP4 (separate from the HLS job id)
    iosMp4JobId: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    videoId: {
      type: String,
      trim: true,
      index: true,
    },
    mediaConvertJobId: {
      type: String,
      trim: true,
      index: true,
    },
    originalVideoUrl: {
      type: String,
      trim: true,
      default: '',
    },
    hlsMasterUrl: {
      type: String,
      trim: true,
      default: '',
    },
    hlsOutputPrefix: {
      type: String,
      trim: true,
      default: '',
    },
    hlsConversionStatus: {
      type: String,
      enum: ['none', 'pending', 'processing', 'completed', 'failed', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
      default: 'none',
      index: true,
    },
    hlsConversionError: {
      type: String,
      trim: true,
      default: '',
    },
    hlsConvertedAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ['none', 'pending', 'processing', 'completed', 'failed'],
      default: 'pending',
      index: true,
    },
    error: {
      type: String,
      trim: true,
      default: '',
    },
    duration: {
      type: Number,
      default: 0,
    },
    fileSize: {
      type: Number,
      default: 0,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    lastAttemptAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

videoConversionSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('VideoConversion', videoConversionSchema);

