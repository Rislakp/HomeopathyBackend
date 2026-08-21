function validateLesson(req, res, next) {
  const { lessonTitle } = req.body;
  if (!lessonTitle || typeof lessonTitle !== 'string' || !lessonTitle.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Lesson title is required'
    });
  }
  next();
}

module.exports = {
  validateLesson
};
