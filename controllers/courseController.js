const Course = require('../models/Course');

// Mock course data as placeholders (compatible with Flutter CourseModel)
const mockCourses = [
  {
    id: "1",
    title: "Introduction to Homeopathy",
    description: "Learn the foundational principles and history of homeopathy.",
    instructor: "Dr. Jane Smith",
    category: "Materia Medica",
    price: 49.99,
    students: 120,
    status: "Published",
    image: "menu_book",
    duration: "4 weeks"
  },
  {
    id: "2",
    title: "Advanced Materia Medica",
    description: "In-depth study of homeopathic remedies and their applications.",
    instructor: "Dr. John Doe",
    category: "Materia Medica",
    price: 99.99,
    students: 85,
    status: "Published",
    image: "auto_stories",
    duration: "8 weeks"
  },
  {
    id: "3",
    title: "Homeopathic Case Taking & Analysis",
    description: "Master the art of interviewing patients and selecting the correct remedy.",
    instructor: "Dr. Sarah Lee",
    category: "Repertory",
    price: 79.99,
    students: 95,
    status: "Published",
    image: "troubleshoot",
    duration: "6 weeks"
  }
];

exports.getCourses = async (req, res) => {
  try {
    const courses = await Course.find().select('courseId courseTitle instructor price -_id');
    return res.status(200).json({
      success: true,
      data: courses
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching courses'
    });
  }
};

/**
 * @desc    Create a new course
 * @route   POST /api/courses
 * @access  Public
 */
exports.createCourse = async (req, res) => {
  try {
    const { courseTitle, instructor, category, price } = req.body;

    // Validate inputs are provided (manual pre-validation check to return clean 400 messages if needed)
    // and to align with mongoose schema
    const newCourse = new Course({
      courseTitle,
      instructor,
      category,
      price
    });

    await newCourse.save();

    return res.status(201).json({
      success: true,
      message: 'Course created successfully',
      data: {
        _id: newCourse._id,
        courseId: newCourse.courseId,
        courseTitle: newCourse.courseTitle,
        instructor: newCourse.instructor,
        category: newCourse.category,
        price: newCourse.price,
        createdAt: newCourse.createdAt,
        updatedAt: newCourse.updatedAt
      }
    });

  } catch (error) {
    // Check if error is a Mongoose Validation Error
    if (error.name === 'ValidationError') {
      const errors = {};
      Object.keys(error.errors).forEach((key) => {
        errors[key] = error.errors[key].message;
      });

      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors
      });
    }

    console.error('Create Course Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

