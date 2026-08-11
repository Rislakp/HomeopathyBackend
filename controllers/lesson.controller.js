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

async function addLessonToModule(req, res) {
  try {
    const { courseId, moduleId } = req.params;
    const { lessonTitle, lessonType, mediaContent } = req.body;

    // 1. Find the Course by courseId
    const course = await Course.findOne({ courseId });
    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found for the given courseId"
      });
    }

    // 2. Find the specific Module inside that course using the moduleId
    const courseModule = course.modules.find(
      (m) => m.moduleId === moduleId || m._id.toString() === moduleId
    );
    if (!courseModule) {
      return res.status(404).json({
        success: false,
        message: "Module not found for the given moduleId"
      });
    }

    // 3. Push the new lesson object into that module's lessons array
    courseModule.lessons.push({
      lessonTitle,
      lessonType,
      mediaContent
    });

    // 4. Save the course document
    await course.save();

    // 5. Success response with exact requested fields
    return res.status(201).json({
      message: "Lesson added successfully",
      courseId: course.courseId,
      moduleId: courseModule.moduleId,
      moduleTitle: courseModule.moduleTitle,
      lessonTitle,
      lessonType,
      mediaContent
    });

  } catch (error) {
    console.error("addLessonToModule error:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while adding the lesson to the module"
    });
  }
}

async function getLesson(req, res) {
  try {
    const { courseId, moduleId, lessonId } = req.params;

    // 1. Find Course by courseId
    const course = await Course.findOne({ courseId });
    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found"
      });
    }

    // 2. Find Module by moduleId
    const courseModule = course.modules.find(
      (m) => m.moduleId === moduleId || m._id.toString() === moduleId
    );
    if (!courseModule) {
      return res.status(404).json({
        success: false,
        message: "Module not found"
      });
    }

    // 3. Find specific Lesson by lessonId
    const lesson = courseModule.lessons.id(lessonId);
    if (!lesson) {
      return res.status(404).json({
        success: false,
        message: "Lesson not found"
      });
    }

    // 4. Return success response: courseId, moduleId, and the full lesson object
    return res.status(200).json({
      courseId: course.courseId,
      moduleId: courseModule.moduleId,
      lesson
    });

  } catch (error) {
    console.error("getLesson error:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching the lesson",
      error: error.message
    });
  }
}

async function updateLesson(req, res) {
  try {
    const { courseId, moduleId, lessonId } = req.params;
    const { lessonTitle, lessonType, mediaContent, uploadFileOrLink } = req.body;

    // 1. Find Course by courseId
    const course = await Course.findOne({ courseId });
    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found"
      });
    }

    // 2. Find Module by moduleId
    const courseModule = course.modules.find(
      (m) => m.moduleId === moduleId || m._id.toString() === moduleId
    );
    if (!courseModule) {
      return res.status(404).json({
        success: false,
        message: "Module not found"
      });
    }

    // 3. Find specific Lesson by lessonId
    const lesson = courseModule.lessons.id(lessonId);
    if (!lesson) {
      return res.status(404).json({
        success: false,
        message: "Lesson not found"
      });
    }

    // 4. Update the lesson fields if provided
    if (lessonTitle !== undefined) {
      lesson.lessonTitle = lessonTitle;
    }
    if (lessonType !== undefined) {
      lesson.lessonType = lessonType;
    }
    
    // Support both mediaContent and uploadFileOrLink
    const actualMediaContent = mediaContent !== undefined ? mediaContent : uploadFileOrLink;
    if (actualMediaContent !== undefined) {
      lesson.mediaContent = actualMediaContent;
    }

    // 5. Save the parent Course document
    await course.save();

    // 6. Return response: success message and the updated lesson object
    return res.status(200).json({
      message: "Lesson updated successfully",
      lesson
    });

  } catch (error) {
    console.error("updateLesson error:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while updating the lesson",
      error: error.message
    });
  }
}

async function deleteLesson(req, res) {
  try {
    const { courseId, moduleId, lessonId } = req.params;

    // 1. Find Course by courseId
    const course = await Course.findOne({ courseId });
    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found"
      });
    }

    // 2. Find Module by moduleId
    const courseModule = course.modules.find(
      (m) => m.moduleId === moduleId || m._id.toString() === moduleId
    );
    if (!courseModule) {
      return res.status(404).json({
        success: false,
        message: "Module not found"
      });
    }

    // 3. Find specific Lesson by lessonId
    const lesson = courseModule.lessons.id(lessonId);
    if (!lesson) {
      return res.status(404).json({
        success: false,
        message: "Lesson not found"
      });
    }

    // 4. Remove the lesson from the module's lessons array using Mongoose's .pull()
    courseModule.lessons.pull(lessonId);

    // 5. Save the parent Course document
    await course.save();

    // 6. Return response: "message": "Lesson deleted successfully" and the deleted lessonId
    return res.status(200).json({
      message: "Lesson deleted successfully",
      lessonId
    });

  } catch (error) {
    console.error("deleteLesson error:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while deleting the lesson",
      error: error.message
    });
  }
}

module.exports = {
  addModuleToCourse,
  addLessonToModule,
  getLesson,
  updateLesson,
  deleteLesson
};
