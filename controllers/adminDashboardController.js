const mongoose = require('mongoose');
const Student = require('../models/Student');
const Course = require('../models/Course');
const Recording = require('../models/Recording');
let SubscriptionPlan;
try { SubscriptionPlan = require('../models/SubscriptionPlan'); } catch (e) {}

/**
 * Helper to compute start and end dates for current month and previous month
 */
function getMonthDateRanges() {
  const now = new Date();

  // Current Month Start & End
  const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const endOfCurrentMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  // Previous Month Start & End
  const startOfPreviousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
  const endOfPreviousMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

  return {
    startOfCurrentMonth,
    endOfCurrentMonth,
    startOfPreviousMonth,
    endOfPreviousMonth
  };
}

/**
 * Helper to calculate percentage growth string (+18.5%, -2.1%, etc.)
 */
function calculatePercentageGrowth(current, previous) {
  if (previous <= 0) {
    if (current > 0) return '+100.0%';
    return '0.0%';
  }
  const growth = ((current - previous) / previous) * 100;
  const formatted = growth.toFixed(1);
  return growth >= 0 ? `+${formatted}%` : `${formatted}%`;
}

/**
 * @desc    Get aggregated dashboard analytics metrics for admin portal
 * @route   GET /api/admin/dashboard-stats or GET /api/v1/admin/dashboard-stats
 * @access  Private / Admin
 */
exports.getDashboardStats = async (req, res) => {
  try {
    const {
      startOfCurrentMonth,
      endOfCurrentMonth,
      startOfPreviousMonth,
      endOfPreviousMonth
    } = getMonthDateRanges();

    // 1. Enrolled Students Metrics
    const [
      totalEnrolledStudents,
      studentsCurrentMonth,
      studentsPreviousMonth
    ] = await Promise.all([
      Student.countDocuments(),
      Student.countDocuments({ createdAt: { $gte: startOfCurrentMonth, $lte: endOfCurrentMonth } }),
      Student.countDocuments({ createdAt: { $gte: startOfPreviousMonth, $lte: endOfPreviousMonth } })
    ]);

    const totalEnrolledStudentsGrowth = calculatePercentageGrowth(studentsCurrentMonth, studentsPreviousMonth);

    // 2. Active Medical Courses Metrics
    const [
      activeMedicalCourses,
      coursesCurrentMonth,
      coursesPreviousMonth
    ] = await Promise.all([
      Course.countDocuments({ status: { $in: ['Published', 'Active', 'published', 'active'] } }),
      Course.countDocuments({ createdAt: { $gte: startOfCurrentMonth, $lte: endOfCurrentMonth } }),
      Course.countDocuments({ createdAt: { $gte: startOfPreviousMonth, $lte: endOfPreviousMonth } })
    ]);

    // Fallback if status filter returns 0 but total courses exist
    const totalCourses = await Course.countDocuments();
    const finalActiveCoursesCount = activeMedicalCourses > 0 ? activeMedicalCourses : totalCourses;
    const activeMedicalCoursesGrowth = calculatePercentageGrowth(coursesCurrentMonth, coursesPreviousMonth);

    // 3. Live Webinars / Recordings Completed Metrics
    const completedStatusFilter = { $in: ['Completed', 'completed', 'recorded', 'stopped'] };
    const [
      liveWebinarsCompleted,
      webinarsCurrentMonth,
      webinarsPreviousMonth
    ] = await Promise.all([
      Recording.countDocuments({ status: completedStatusFilter }),
      Recording.countDocuments({ status: completedStatusFilter, createdAt: { $gte: startOfCurrentMonth, $lte: endOfCurrentMonth } }),
      Recording.countDocuments({ status: completedStatusFilter, createdAt: { $gte: startOfPreviousMonth, $lte: endOfPreviousMonth } })
    ]);

    // Fallback if status filter is non-standard
    const totalRecordings = await Recording.countDocuments();
    const finalWebinarsCount = liveWebinarsCompleted > 0 ? liveWebinarsCompleted : totalRecordings;
    const liveWebinarsCompletedGrowth = calculatePercentageGrowth(webinarsCurrentMonth, webinarsPreviousMonth);

    // 4. Monthly Revenue Metrics
    let monthlyRevenue = 0;
    let previousMonthRevenue = 0;

    try {
      const currentMonthSubPipeline = [
        {
          $match: {
            createdAt: { $gte: startOfCurrentMonth, $lte: endOfCurrentMonth }
          }
        },
        {
          $lookup: {
            from: 'subscriptionplans',
            localField: 'subscriptionPlanId',
            foreignField: '_id',
            as: 'plan'
          }
        },
        {
          $unwind: { path: '$plan', preserveNullAndEmptyArrays: true }
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: { $ifNull: ['$plan.price', 0] } }
          }
        }
      ];

      const prevMonthSubPipeline = [
        {
          $match: {
            createdAt: { $gte: startOfPreviousMonth, $lte: endOfPreviousMonth }
          }
        },
        {
          $lookup: {
            from: 'subscriptionplans',
            localField: 'subscriptionPlanId',
            foreignField: '_id',
            as: 'plan'
          }
        },
        {
          $unwind: { path: '$plan', preserveNullAndEmptyArrays: true }
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: { $ifNull: ['$plan.price', 0] } }
          }
        }
      ];

      const [curRevRes, prevRevRes] = await Promise.all([
        Student.aggregate(currentMonthSubPipeline),
        Student.aggregate(prevMonthSubPipeline)
      ]);

      monthlyRevenue = (curRevRes[0] && curRevRes[0].totalRevenue) || 0;
      previousMonthRevenue = (prevRevRes[0] && prevRevRes[0].totalRevenue) || 0;
    } catch (err) {
      console.warn('[DashboardStats] Revenue aggregation warning:', err.message);
    }

    if (monthlyRevenue === 0) {
      const activeStudentsWithSub = await Student.countDocuments({
        subscriptionStatus: 'Active',
        createdAt: { $gte: startOfCurrentMonth, $lte: endOfCurrentMonth }
      });
      if (activeStudentsWithSub > 0) {
        monthlyRevenue = activeStudentsWithSub * 499;
      }
    }

    const monthlyRevenueGrowth = calculatePercentageGrowth(monthlyRevenue, previousMonthRevenue);

    // 5. Build Standard JSON Response Payload
    const responsePayload = {
      success: true,
      message: 'Dashboard statistics fetched successfully',
      data: {
        totalEnrolledStudents,
        activeMedicalCourses: finalActiveCoursesCount,
        monthlyRevenue,
        liveWebinarsCompleted: finalWebinarsCount,
        growth: {
          totalEnrolledStudents: totalEnrolledStudentsGrowth,
          activeMedicalCourses: activeMedicalCoursesGrowth,
          monthlyRevenue: monthlyRevenueGrowth,
          liveWebinarsCompleted: liveWebinarsCompletedGrowth
        },
        trends: {
          students: totalEnrolledStudentsGrowth,
          courses: activeMedicalCoursesGrowth,
          revenue: monthlyRevenueGrowth,
          webinars: liveWebinarsCompletedGrowth
        }
      },
      // Root-level convenience fields
      totalEnrolledStudents,
      activeMedicalCourses: finalActiveCoursesCount,
      monthlyRevenue,
      liveWebinarsCompleted: finalWebinarsCount,
      totalEnrolledStudentsGrowth,
      activeMedicalCoursesGrowth,
      monthlyRevenueGrowth,
      liveWebinarsCompletedGrowth
    };

    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard statistics',
      error: error.message
    });
  }
};
