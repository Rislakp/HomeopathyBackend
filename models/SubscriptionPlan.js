const mongoose = require('mongoose');

const subscriptionPlanSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    frequency: {
      type: String,
      required: true,
      enum: ['Monthly', 'Quarterly', 'Yearly', 'Lifetime'],
    },
    billingSuffix: {
      type: String,
      required: true,
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    isMostPopular: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ['Active', 'Inactive'],
      default: 'Active',
    },
    features: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('SubscriptionPlan', subscriptionPlanSchema);
