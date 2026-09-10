const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  // ── FK link to User auth record ─────────────────────────────────────────────
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    sparse: true,   // allows multiple null values without violating unique constraint
  },

  // ── Core profile fields (mirrors the signup form) ───────────────────────────
  name: {
    type: String,
    required: [true, 'Please add a name'],
    trim: true,
  },
  email: {
    type: String,
    required: [true, 'Please add an email'],
    unique: true,
    trim: true,
    lowercase: true,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      'Please add a valid email',
    ],
  },
  phone: {
    type: String,
    trim: true,
    default: '',
  },
  contactNumber: {
    type: String,
    trim: true,
    default: '',
  },
  dateOfBirth: {
    type: String,
    trim: true,
    default: '',
  },
  qualification: {
    type: String,
    trim: true,
    default: '',
  },
  preferredCourse: {
    type: String,
    trim: true,
    default: '',
  },

  // ── Course / Subscription (admin-managed, optional at signup) ───────────────
  course: {
    type: String,
    trim: true,
    default: '',          // was required: true — caused every signup sync to fail silently
  },
  courseRef: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    default: null,
  },
  subscription: {
    type: String,
    trim: true,
    default: 'None',      // was required: true — same issue
  },
  courseId: {
    type: String,
    trim: true,
    default: '',
  },
  subscriptionPlanId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SubscriptionPlan',
    default: null,
  },
  subscriptionStatus: {
    type: String,
    // Must stay independent of the account-level `status` field
    enum: ['Active', 'Inactive', 'Expired', 'None'],
    default: 'None',
  },
  subscriptionExpiresAt: {
    type: Date,
    default: null,
  },

  // ── Exam scores ─────────────────────────────────────────────────────────────
  examScores: [
    {
      examTitle: {
        type: String,
        trim: true,
        default: 'General Assessment',
      },
      score: {
        type: Number,
        default: 0,
      },
      maxScore: {
        type: Number,
        default: 100,
      },
      percentage: {
        type: Number,
        default: function () {
          return this.maxScore > 0
            ? Math.round((this.score / this.maxScore) * 100)
            : 0;
        },
      },
      grade: {
        type: String,
        trim: true,
        default: '',
      },
      date: {
        type: Date,
        default: Date.now,
      },
    },
  ],

  // ── Account status ───────────────────────────────────────────────────────────
  //
  // STATUS ENUM CONTRACT (keep in sync with adminStudentController constants):
  //
  //   `status`        — legacy operational field used by subscription/exam logic
  //                     'Pending'  → awaiting admin approval   (new default)
  //                     'Active'   → approved and operational
  //                     'Inactive' → rejected, suspended, or deactivated
  //                     'Trial'    → limited trial access
  //                     'Expired'  → subscription/access expired
  //
  //   `accountStatus` — admin approval workflow field
  //                     'Pending'  → awaiting review
  //                     'Approved' → admin approved  → status becomes 'Active'
  //                     'Rejected' → admin rejected  → status becomes 'Inactive'
  //                     'Suspended'→ admin suspended → status becomes 'Inactive'
  //
  status: {
    type: String,
    required: true,
    enum: ['Pending', 'Active', 'Inactive', 'Trial', 'Expired'],
    default: 'Pending',   // new students start pending until admin approves
  },
  isActive: {
    type: Boolean,
    default: false,       // false until admin explicitly approves
  },
  isApproved: {
    type: Boolean,
    default: false,       // false until an admin explicitly approves
  },
  accountStatus: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected', 'Suspended'],
    default: 'Pending',   // every new student starts in Pending state
    trim: true,
  },
  approvedAt: {
    type: Date,
    default: null,
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null,
  },

  joinedDate: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
  toJSON: {
    transform: function (doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
  toObject: {
    transform: function (doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
});

module.exports = mongoose.model('Student', studentSchema);
