const courseController = require('./courseController');

module.exports = {
  addModule: courseController.addModule,
  addLesson: courseController.addLesson,
  updateLesson: courseController.updateLesson,
  deleteLesson: courseController.deleteLesson,
  // Alias for backward compatibility
  addModuleToCourse: courseController.addLesson,
};
