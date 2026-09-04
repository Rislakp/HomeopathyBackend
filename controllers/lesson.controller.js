const courseController = require('./courseController');

module.exports = {
  addModule: courseController.addModule,
  addLesson: courseController.addLesson,
  updateLesson: courseController.updateLesson,
  deleteLesson: courseController.deleteLesson,
  getLessonsByModule: courseController.getLessonsByModule,
  // Aliases for backward compatibility
  addModuleToCourse: courseController.addLesson,
};
