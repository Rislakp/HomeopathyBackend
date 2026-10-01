const mongoose = require('mongoose');

const unaniSubscriptionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Subscription name is required'],
      trim: true,
    },
    title: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    price: {
      type: Number,
      required: [true, 'Subscription price is required'],
      min: [0, 'Price must be non-negative'],
    },
    fee: {
      type: Number,
      min: [0, 'Fee must be non-negative'],
    },
    currency: {
      type: String,
      trim: true,
      default: 'INR',
    },
    duration: {
      type: Number,
      required: [true, 'Duration is required'],
      min: [1, 'Duration must be at least 1'],
      default: 12,
    },
    durationUnit: {
      type: String,
      enum: ['days', 'weeks', 'months', 'years'],
      default: 'months',
      trim: true,
    },
    frequency: {
      type: String,
      trim: true,
      default: 'Yearly',
    },
    billingSuffix: {
      type: String,
      trim: true,
      default: '/year',
    },
    features: {
      type: [String],
      default: [],
    },
    courseId: {
      type: String,
      trim: true,
      default: 'unani',
    },
    course: {
      type: String,
      trim: true,
      default: 'unani',
    },
    courseCategory: {
      type: String,
      trim: true,
      default: 'unani',
    },
    image: {
      type: String,
      trim: true,
      default: '',
    },
    banner: {
      type: String,
      trim: true,
      default: '',
    },
    isMostPopular: {
      type: Boolean,
      default: false,
    },
    isPopular: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['Active', 'Inactive'],
      default: 'Active',
      index: true,
    },
    displayOrder: {
      type: Number,
      default: 0,
      index: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'unanisubscriptions',
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        ret.id = ret._id ? ret._id.toString() : ret.id;
        ret._id = ret.id;
        ret.planName = ret.name || ret.title;
        ret.title = ret.name || ret.title;
        ret.name = ret.title || ret.name;
        ret.fee = ret.price;
        ret.isPopular = ret.isMostPopular;
        ret.isMostPopular = ret.isPopular;
        ret.isActive = ret.status === 'Active' || ret.isActive === true;
        ret.status = ret.isActive ? 'Active' : 'Inactive';
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: function (doc, ret) {
        ret.id = ret._id ? ret._id.toString() : ret.id;
        ret._id = ret.id;
        ret.planName = ret.name || ret.title;
        ret.title = ret.name || ret.title;
        ret.name = ret.title || ret.name;
        ret.fee = ret.price;
        ret.isPopular = ret.isMostPopular;
        ret.isMostPopular = ret.isPopular;
        ret.isActive = ret.status === 'Active' || ret.isActive === true;
        ret.status = ret.isActive ? 'Active' : 'Inactive';
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Pre-save synchronization hook
unaniSubscriptionSchema.pre('save', function (next) {
  if (this.name && !this.title) this.title = this.name;
  if (this.title && !this.name) this.name = this.title;
  if (this.price !== undefined) this.fee = this.price;
  if (this.fee !== undefined && this.price === undefined) this.price = this.fee;
  if (this.isMostPopular !== undefined) this.isPopular = this.isMostPopular;
  if (this.isPopular !== undefined && this.isMostPopular === undefined) this.isMostPopular = this.isPopular;
  if (this.isActive !== undefined) {
    this.status = this.isActive ? 'Active' : 'Inactive';
  } else if (this.status !== undefined) {
    this.isActive = this.status === 'Active';
  }
  next();
});

// Indexes for high-performance sorting and retrieval
unaniSubscriptionSchema.index({ courseId: 1, isDeleted: 1, isActive: 1, displayOrder: 1 });
unaniSubscriptionSchema.index({ displayOrder: 1, createdAt: -1 });
unaniSubscriptionSchema.index({ name: 1, isDeleted: 1 });

module.exports =
  mongoose.models.UnaniSubscription ||
  mongoose.model('UnaniSubscription', unaniSubscriptionSchema);
