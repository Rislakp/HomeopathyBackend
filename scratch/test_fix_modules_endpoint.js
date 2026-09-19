const express = require('express');
const mongoose = require('mongoose');

// Mock Course and Lesson models logic for test
const getQueryById = (id) => {
  if (!id) return {};
  return mongoose.Types.ObjectId.isValid(id)
    ? { $or: [{ _id: id }, { courseId: id }] }
    : { courseId: id };
};

const formatModulesAndLessons = (rawModules = []) => {
  if (!Array.isArray(rawModules)) return [];

  return rawModules.map((m) => {
    const modObj = m && typeof m.toObject === 'function' ? m.toObject({ virtuals: true }) : { ...(m || {}) };
    const rawLessons = Array.isArray(modObj.lessons) ? modObj.lessons : [];

    const formattedLessons = rawLessons.map((l) => {
      const lessObj = l && typeof l.toObject === 'function' ? l.toObject({ virtuals: true }) : { ...(l || {}) };
      const lessonId = lessObj._id ? lessObj._id.toString() : (lessObj.id ? lessObj.id.toString() : new mongoose.Types.ObjectId().toString());
      const lessonTitle = (lessObj.lessonTitle || lessObj.title || lessObj.lessonName || '').trim();
      const lessonType = lessObj.lessonType || lessObj.type || 'Recorded Video';
      const fileOrLink = (
        lessObj.fileOrLink ||
        lessObj.uploadFileOrLink ||
        lessObj.mediaContent ||
        lessObj.fileUrlOrLink ||
        lessObj.link ||
        ''
      ).trim();

      return {
        _id: lessonId,
        lessonTitle,
        lessonType,
        fileOrLink,
        duration: lessObj.duration || '',
        mediaContent: fileOrLink,
      };
    });

    const moduleId = modObj._id ? modObj._id.toString() : (modObj.id ? modObj.id.toString() : new mongoose.Types.ObjectId().toString());
    const moduleName = (modObj.moduleName || modObj.moduleTitle || '').trim();

    return {
      _id: moduleId,
      moduleName,
      moduleTitle: moduleName,
      duration: modObj.duration || '',
      description: modObj.description || '',
      assignedSubjects: Array.isArray(modObj.assignedSubjects) ? modObj.assignedSubjects : [],
      lessons: formattedLessons,
    };
  });
};

const testCourse = {
  _id: '6a967350635dd1118c1d9f47',
  courseId: 'CRS-000028',
  courseTitle: 'Homeopathy Mastery',
  modules: [
    {
      _id: '6a967350635dd1118c1d9f47',
      moduleName: 'Module 1 — Introduction to Homeopathy',
      lessons: [
        {
          _id: '6a967350635dd1118c1d9f99',
          lessonTitle: 'Lesson 1: History of Homeopathy',
          lessonType: 'Recorded Video',
          uploadFileOrLink: 'https://example.com/video1.mp4'
        }
      ]
    }
  ]
};

const mockGetModules = async (req, res) => {
  try {
    const { id, courseId } = req.params;
    const targetId = courseId || id;
    const query = getQueryById(targetId);

    // Simulated query match
    if (query.courseId !== 'CRS-000028' && (!query.$or || query.$or[0]._id !== '6a967350635dd1118c1d9f47')) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    const course = testCourse;
    let modulesList = formatModulesAndLessons(course.modules || []);

    return res.status(200).json({
      success: true,
      message: 'Modules fetched successfully',
      count: modulesList.length,
      data: modulesList,
      modules: modulesList,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const app = express();
app.get('/api/courses/:courseId/modules', mockGetModules);

const server = app.listen(0, async () => {
  const port = server.address().port;
  console.log(`Test server running on port ${port}`);

  // Test with courseId CRS-000028
  const res1 = await fetch(`http://localhost:${port}/api/courses/CRS-000028/modules`);
  const data1 = await res1.json();
  console.log('Query by CRS-000028 response:', JSON.stringify(data1, null, 2));

  // Test with mongo _id
  const res2 = await fetch(`http://localhost:${port}/api/courses/6a967350635dd1118c1d9f47/modules`);
  const data2 = await res2.json();
  console.log('Query by Mongo _id response:', JSON.stringify(data2, null, 2));

  server.close();
});
