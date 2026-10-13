require('dotenv').config();
const mongoose = require('mongoose');
const Student = require('./models/Student');
const Course = require('./models/Course');

async function testAggregation() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB.");

  const countData = await Student.aggregate([
    {
      $match: {
        accountStatus: 'Approved'
      }
    },
    {
      $project: {
        allCourseIds: {
          $concatArrays: [
            { $cond: [{ $isArray: '$courseIds' }, '$courseIds', []] },
            { $cond: [{ $ifNull: ['$courseId', false] }, ['$courseId'], []] },
            { $cond: [{ $ifNull: ['$courseRef', false] }, [{ $toString: '$courseRef' }], []] },
            { $cond: [{ $ifNull: ['$course', false] }, ['$course'], []] }
          ]
        }
      }
    },
    {
      $unwind: '$allCourseIds'
    },
    {
      $project: {
        cleanCourseId: { $toLower: { $trim: { input: '$allCourseIds' } } }
      }
    },
    {
      $match: {
        cleanCourseId: { $ne: '' }
      }
    },
    {
      $group: {
        _id: '$cleanCourseId',
        studentIds: { $addToSet: '$_id' }
      }
    }
  ]);

  console.log("Aggregated raw counts:");
  console.log(JSON.stringify(countData, null, 2));

  const courses = await Course.find({}).select('_id courseId courseTitle status category price');
  console.log(`Found ${courses.length} courses.`);

  const enrollmentMap = new Map();
  courses.forEach(course => {
    enrollmentMap.set(course._id.toString(), {
      courseId: course.courseId || null,
      courseName: course.courseTitle,
      studentIdsSet: new Set()
    });
  });

  countData.forEach(item => {
    const idKey = item._id;
    let matchedCourseId = null;

    for (const course of courses) {
      if (
        (course._id.toString().toLowerCase() === idKey) ||
        (course.courseId && course.courseId.toLowerCase() === idKey) ||
        (course.courseTitle && course.courseTitle.toLowerCase() === idKey)
      ) {
        matchedCourseId = course._id.toString();
        break;
      }
    }

    if (matchedCourseId) {
      item.studentIds.forEach(studentId => {
        enrollmentMap.get(matchedCourseId).studentIdsSet.add(studentId.toString());
      });
    } else {
      console.log(`Warning: Unmatched course ID/Title from Student records: ${idKey}`);
    }
  });

  console.log("\nFinal Merged Output:");
  const finalData = Array.from(enrollmentMap.values()).map(courseData => {
    return {
      courseId: courseData.courseId,
      courseName: courseData.courseName,
      enrolledStudentCount: courseData.studentIdsSet.size
    };
  });
  console.log(JSON.stringify(finalData.slice(0, 3), null, 2)); // Print first 3
  
  process.exit(0);
}

testAggregation().catch(console.error);
