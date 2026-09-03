const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a name'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Please add an email'],
    unique: true,
    trim: true,
    lowercase: true,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      'Please add a valid email'
    ]
  },
  phone: {
    type: String,
    required: [true, 'Please add a phone number'],
    unique: true,
    trim: true
  },
  course: {
    type: String,
    required: [true, 'Please specify a course'],
    trim: true
  },
  subscription: {
    type: String,
    required: [true, 'Please specify a subscription level'],
    trim: true
  },
  courseId: {
    type: String,
    trim: true,
    default: ''
  },
  examScores: [
    {
      examTitle: {
        type: String,
        trim: true,
        default: 'General Assessment'
      },
      score: {
        type: Number,
        default: 0
      },
      maxScore: {
        type: Number,
        default: 100
      },
      percentage: {
        type: Number,
        default: function() {
          return this.maxScore > 0 ? Math.round((this.score / this.maxScore) * 100) : 0;
        }
      },
      grade: {
        type: String,
        trim: true,
        default: ''
      },
      date: {
        type: Date,
        default: Date.now
      }
    }
  ],
  status: {
    type: String,
    required: true,
    enum: ['Active', 'Inactive', 'Trial', 'Expired'],
    default: 'Active'
  },
  subscriptionPlanId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SubscriptionPlan',
    default: null,
  },
  subscriptionStatus: {
    type: String,
    enum: ['Active', 'Inactive', 'Expired', 'None'],
    default: 'None',
  },
  subscriptionExpiresAt: {
    type: Date,
    default: null,
  },
  joinedDate: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      return ret;
    }
  },
  toObject: {
    transform: function(doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      return ret;
    }
  }
});

module.exports = mongoose.model('Student', studentSchema);
