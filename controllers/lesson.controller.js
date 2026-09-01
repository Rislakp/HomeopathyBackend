const Course = require('../models/Course');
const Lesson = require('../models/Lesson.model');

async function addModuleToCourse(req, res) {
  try {
    const { courseId, id } = req.params;
    const targetCourseId = courseId || id;
    const {
      moduleName,
      moduleTitle,
      duration,
      description,
      assignedSubjects,
      lessons,
    } = req.body;

    const actualModuleName = moduleName || moduleTitle;
    const missingFields = [];

    // Validate module-level required fields
    if (!actualModuleName || typeof actualModuleName !== 'string' || !actualModuleName.trim()) {
      missingFields.push('moduleName');
    }

    // Validate nested lessons array if present
    if (lessons !== undefined && lessons !== null) {
      if (!Array.isArray(lessons)) {
        missingFields.push('lessons (must be an array)');
      } else {
        lessons.forEach((lesson, index) => {
          if (!lesson || typeof lesson !== 'object') {
            missingFields.push(`lessons[${index}] (must be an object)`);
          } else {
            const title = lesson.lessonTitle || lesson.title || lesson.lessonName;
            if (!title || typeof title !== 'string' || !title.trim()) {
              missingFields.push(`lessons[${index}].lessonTitle`);
            }
          }
        });
      }
    }

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Validation failed: Missing or invalid required fields (${missingFields.join(', ')})`,
        missingFields,
      });
    }

    const query = require('mongoose').Types.ObjectId.isValid(targetCourseId)
      ? { _id: targetCourseId }
      : { courseId: targetCourseId };

    const course = await Course.findOne(query);
    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found for the given courseId',
      });
    }

    // Parse and format nested lessons array
    const formattedLessons = Array.isArray(lessons)
      ? lessons.map((l) => ({
          lessonTitle: (l.lessonTitle || l.title || l.lessonName || '').trim(),
          lessonType: l.lessonType || 'Recorded Video',
          duration: l.duration || '',
          fileOrLink: l.fileOrLink || l.uploadFileOrLink || l.mediaContent || '',
        }))
      : [];

    const newModule = {
      moduleName: actualModuleName.trim(),
      duration: duration || '',
      description: description || '',
      assignedSubjects: Array.isArray(assignedSubjects) ? assignedSubjects : [],
      lessons: formattedLessons,
    };

    course.modules.push(newModule);
    await course.save();

    const createdModule = course.modules[course.modules.length - 1];

    return res.status(201).json({
      success: true,
      message: 'Module added successfully',
      data: createdModule,
      course,
    });

  } catch (error) {
    console.error("addModuleToCourse error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Something went wrong while creating the module",
    });
  }
}

async function addLessonToModule(req, res) {
  try {
    const { courseId } = req.params;
    const { moduleTitle, lessonTitle, lessonType, mediaContent } = req.body;

    // 1. Find the Course by courseId
    const course = await Course.findOne({ courseId });
    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found for the given courseId"
      });
    }

    // 2. Find the specific module inside the course's modules array where the title exactly matches the provided moduleTitle
    const courseModule = course.modules.find(
      (m) => m.moduleTitle === moduleTitle
    );
    if (!courseModule) {
      return res.status(404).json({
        success: false,
        message: "Module not found in this course"
      });
    }

    // 3. Push the new lesson object into that module's lessons array
    courseModule.lessons.push({
      lessonTitle,
      lessonType,
      mediaContent
    });

    // 4. Save the parent Course document
    await course.save();

    // 5. Success response (201) with exact requested fields
    return res.status(201).json({
      message: "Lesson added successfully",
      courseId: course.courseId,
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
