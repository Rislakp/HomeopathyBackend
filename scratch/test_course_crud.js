const Course = require('../models/Course');
const courseController = require('../controllers/courseController');
const courseRoutes = require('../routes/courseRoutes');

console.log('✓ Model Course required successfully');
console.log('✓ courseController handlers loaded:', Object.keys(courseController));
console.log('✓ courseRoutes loaded successfully');
