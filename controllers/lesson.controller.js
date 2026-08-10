const Course = require('../models/Course');
const Lesson = require('../models/Lesson.model');

async function addModuleToCourse(req, res) {
  try {
    const { courseId } = req.params;
    const { lessonTitle, uploadFileOrLink, lessonType } = req.body;

    // 1. Check course exists
    const course = await Course.findOne({ courseId });
    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found for the given courseId"
      });
    }

    // 2. Create lesson
    const lesson = await Lesson.create({
      courseId,
      lessonTitle,
      uploadFileOrLink,
      lessonType
    });

    // 3. Success response
    return res.status(201).json({
      success: true,
      message: "Lesson added successfully",
      data: {
        courseId: lesson.courseId,
        lessonId: lesson._id,
        lessonTitle: lesson.lessonTitle,
        uploadFileOrLink: lesson.uploadFileOrLink,
        lessonType: lesson.lessonType,
        createdAt: lesson.createdAt,
        updatedAt: lesson.updatedAt
      }
    });

  } catch (error) {
    console.error("addModuleToCourse error:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while creating the lesson"
    });
  }
}

module.exports = { addModuleToCourse };
