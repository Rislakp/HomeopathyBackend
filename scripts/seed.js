// require('dotenv').config();
// const mongoose = require('mongoose');
// const Student = require('../models/Student');
// const Course = require('../models/Course');

// const students = [
//   {
//     name: 'Dr. Albert Allen',
//     email: 'albert.allen@example.com',
//     phone: '+1 (555) 019-2834',
//     course: 'Homeopathy Foundation',
//     subscription: 'Premium',
//     status: 'Active',
//     joinedDate: new Date('2025-10-12')
//   },
//   {
//     name: 'Dr. Clara Bow',
//     email: 'clara.bow@example.com',
//     phone: '+1 (555) 021-9876',
//     course: 'Advanced Prescribing',
//     subscription: 'VIP',
//     status: 'Active',
//     joinedDate: new Date('2025-11-01')
//   },
//   {
//     name: 'Dr. David Miller',
//     email: 'david.miller@example.com',
//     phone: '+1 (555) 022-3456',
//     course: 'Chronic Cases Study',
//     subscription: 'Basic',
//     status: 'Inactive',
//     joinedDate: new Date('2025-08-15')
//   },
//   {
//     name: 'Dr. Emma Watson',
//     email: 'emma.watson@example.com',
//     phone: '+1 (555) 023-4567',
//     course: 'Organon of Medicine',
//     subscription: 'Trial',
//     status: 'Trial',
//     joinedDate: new Date('2026-01-10')
//   },
//   {
//     name: 'Dr. Frank Sinatra',
//     email: 'frank.sinatra@example.com',
//     phone: '+1 (555) 024-5678',
//     course: 'Materia Medica Masterclass',
//     subscription: 'Basic',
//     status: 'Expired',
//     joinedDate: new Date('2025-05-20')
//   },
//   {
//     name: 'Dr. Grace Hopper',
//     email: 'grace.hopper@example.com',
//     phone: '+1 (555) 025-6789',
//     course: 'Homeopathy Foundation',
//     subscription: 'VIP',
//     status: 'Active',
//     joinedDate: new Date('2025-09-05')
//   },
//   {
//     name: 'Dr. Henry Cavill',
//     email: 'henry.cavill@example.com',
//     phone: '+1 (555) 026-7890',
//     course: 'Advanced Prescribing',
//     subscription: 'Premium',
//     status: 'Active',
//     joinedDate: new Date('2025-12-18')
//   },
//   {
//     name: 'Dr. Irene Adler',
//     email: 'irene.adler@example.com',
//     phone: '+1 (555) 027-8901',
//     course: 'Chronic Cases Study',
//     subscription: 'Trial',
//     status: 'Trial',
//     joinedDate: new Date('2026-01-20')
//   },
//   {
//     name: 'Dr. Jack Ryan',
//     email: 'jack.ryan@example.com',
//     phone: '+1 (555) 028-9012',
//     course: 'Organon of Medicine',
//     subscription: 'Basic',
//     status: 'Inactive',
//     joinedDate: new Date('2025-07-11')
//   },
//   {
//     name: 'Dr. Kate Austen',
//     email: 'kate.austen@example.com',
//     phone: '+1 (555) 029-0123',
//     course: 'Materia Medica Masterclass',
//     subscription: 'Premium',
//     status: 'Active',
//     joinedDate: new Date('2025-10-29')
//   },
//   {
//     name: 'Dr. Leo Fitz',
//     email: 'leo.fitz@example.com',
//     phone: '+1 (555) 030-1234',
//     course: 'Homeopathy Foundation',
//     subscription: 'Basic',
//     status: 'Expired',
//     joinedDate: new Date('2025-04-14')
//   },
//   {
//     name: 'Dr. Melinda May',
//     email: 'melinda.may@example.com',
//     phone: '+1 (555) 031-2345',
//     course: 'Advanced Prescribing',
//     subscription: 'VIP',
//     status: 'Active',
//     joinedDate: new Date('2025-11-15')
//   },
//   {
//     name: 'Dr. Ned Stark',
//     email: 'ned.stark@example.com',
//     phone: '+1 (555) 032-3456',
//     course: 'Chronic Cases Study',
//     subscription: 'Premium',
//     status: 'Inactive',
//     joinedDate: new Date('2025-06-02')
//   },
//   {
//     name: 'Dr. Olivia Dunham',
//     email: 'olivia.dunham@example.com',
//     phone: '+1 (555) 033-4567',
//     course: 'Organon of Medicine',
//     subscription: 'Premium',
//     status: 'Active',
//     joinedDate: new Date('2025-09-22')
//   },
//   {
//     name: 'Dr. Peter Parker',
//     email: 'peter.parker@example.com',
//     phone: '+1 (555) 034-5678',
//     course: 'Materia Medica Masterclass',
//     subscription: 'Trial',
//     status: 'Trial',
//     joinedDate: new Date('2026-02-01')
//   },
//   {
//     name: 'Dr. Quint Vance',
//     email: 'quint.vance@example.com',
//     phone: '+1 (555) 035-6789',
//     course: 'Homeopathy Foundation',
//     subscription: 'Basic',
//     status: 'Active',
//     joinedDate: new Date('2025-08-30')
//   },
//   {
//     name: 'Dr. Rose Tyler',
//     email: 'rose.tyler@example.com',
//     phone: '+1 (555) 036-7890',
//     course: 'Advanced Prescribing',
//     subscription: 'VIP',
//     status: 'Active',
//     joinedDate: new Date('2025-10-05')
//   },
//   {
//     name: 'Dr. Sam Wilson',
//     email: 'sam.wilson@example.com',
//     phone: '+1 (555) 037-8901',
//     course: 'Chronic Cases Study',
//     subscription: 'Basic',
//     status: 'Expired',
//     joinedDate: new Date('2025-03-12')
//   },
//   {
//     name: 'Dr. Tony Stark',
//     email: 'tony.stark@example.com',
//     phone: '+1 (555) 038-9012',
//     course: 'Organon of Medicine',
//     subscription: 'VIP',
//     status: 'Active',
//     joinedDate: new Date('2025-07-04')
//   },
//   {
//     name: 'Dr. Ursula Buffay',
//     email: 'ursula.buffay@example.com',
//     phone: '+1 (555) 039-0123',
//     course: 'Materia Medica Masterclass',
//     subscription: 'Premium',
//     status: 'Inactive',
//     joinedDate: new Date('2025-05-14')
//   }
// ];

// const courses = [
//   {
//     title: 'Classical Homeopathy Foundations',
//     instructor: 'Dr. Samuel Hahnemann',
//     category: 'Materia Medica',
//     price: 4999,
//     students: 120,
//     status: 'Published',
//     description: 'Explore the primary principles of homeotherapy, including similia similibus curentur, single remedy, and minimum dose.',
//     image: 'menu_book'
//   },
//   {
//     title: 'Advanced Materia Medica',
//     instructor: 'Dr. J. T. Kent',
//     category: 'Materia Medica',
//     price: 6499,
//     students: 85,
//     status: 'Published',
//     description: 'Deep dive into Kentian constitutional profiles, drug provings, and comparative study of polychrests.',
//     image: 'auto_stories'
//   },
//   {
//     title: 'Repertory Mastery Program',
//     instructor: 'Dr. Boenninghausen',
//     category: 'Repertory',
//     price: 5299,
//     students: 95,
//     status: 'Published',
//     description: 'Learn case analysis, rubric selection, and comparative study of Kent, Boenninghausen, and Boger repertories.',
//     image: 'troubleshoot'
//   },
//   {
//     title: 'Organon Essentials',
//     instructor: 'Dr. Samuel Hahnemann',
//     category: 'Organon',
//     price: 3999,
//     students: 110,
//     status: 'Published',
//     description: "Chronological analysis of Samuel Hahnemann's Organon of Medicine (Aphorisms 1 to 291) covering logic and philosophy.",
//     image: 'history_edu'
//   },
//   {
//     title: 'Anatomy Complete',
//     instructor: 'Dr. Henry Gray',
//     category: 'Anatomy',
//     price: 4599,
//     students: 150,
//     status: 'Published',
//     description: 'Comprehensive gross anatomy module covering osteology, myology, neurology, and clinical correlation.',
//     image: 'accessibility'
//   },
//   {
//     title: 'Physiology Masterclass',
//     instructor: 'Dr. Arthur Guyton',
//     category: 'Physiology',
//     price: 4799,
//     students: 140,
//     status: 'Draft',
//     description: 'Understand molecular, cellular, systemic human organ actions, and homeostatic regulation loops.',
//     image: 'favorite'
//   },
//   {
//     title: 'Pathology Basics',
//     instructor: 'Dr. William Boyd',
//     category: 'Pathology',
//     price: 4299,
//     students: 60,
//     status: 'Published',
//     description: 'Introduction to general pathognomonic processes, cell injury, inflammation, hemodynamic disorders, and neoplasia.',
//     image: 'biotech'
//   },
//   {
//     title: 'Community Medicine',
//     instructor: 'Dr. K. Park',
//     category: 'Physiology',
//     price: 3499,
//     students: 45,
//     status: 'Published',
//     description: 'Epidemiological studies, preventive medicine protocols, health policies, environmental sanitation, and demography.',
//     image: 'groups'
//   },
//   {
//     title: 'Pharmacology',
//     instructor: 'Dr. Burt Kent',
//     category: 'Materia Medica',
//     price: 3899,
//     students: 75,
//     status: 'Published',
//     description: 'Understanding pharmacodynamics, pharmacokinetics, adverse effects, and comparative dosing guidelines.',
//     image: 'vaccines'
//   },
//   {
//     title: 'Practice of Medicine',
//     instructor: 'Dr. T. Harrison',
//     category: 'Repertory',
//     price: 5999,
//     students: 130,
//     status: 'Published',
//     description: 'Diagnostic criteria, systemic clinical symptoms, physical examinations, and holistic case formulations.',
//     image: 'local_hospital'
//   },
//   {
//     title: 'Surgery',
//     instructor: 'Dr. Hamilton Bailey',
//     category: 'Anatomy',
//     price: 6999,
//     students: 50,
//     status: 'Archived',
//     description: 'Surgical pathology, pre/post-operative patient monitoring guidelines, suturing basics, and emergency setups.',
//     image: 'content_cut'
//   },
//   {
//     title: 'Forensic Medicine',
//     instructor: 'Dr. K. S. Reddy',
//     category: 'Pathology',
//     price: 3299,
//     students: 40,
//     status: 'Published',
//     description: 'Medical jurisprudence, postmortem investigations, toxicology assays, legal evidence documentation rules.',
//     image: 'gavel'
//   }
// ];

// const seedData = async () => {
//   const useLocal = process.env.USE_LOCAL_DB === 'true';
//   const dbUri = useLocal ? process.env.MONGODB_LOCAL_URI : process.env.MONGODB_URI;

//   try {
//     // Connect to database
//     await mongoose.connect(dbUri, {
//       dbName: 'homeopathy_db'
//     });
//     console.log(`MongoDB connected for seeding (${useLocal ? 'Local' : 'Atlas'})...`);

//     // Clear existing data
//     await Student.deleteMany();
//     console.log('Cleared existing students.');
//     await Course.deleteMany();
//     console.log('Cleared existing courses.');

//     // Seed students
//     await Student.insertMany(students);
//     console.log(`Seeded ${students.length} students.`);

//     // Seed courses
//     await Course.insertMany(courses);
//     console.log(`Seeded ${courses.length} courses.`);

//     console.log('Database seeding completed successfully.');
//     process.exit(0);
//   } catch (error) {
//     console.error(`Database seeding failed: ${error.message}`);
//     if (!useLocal) {
//       console.error('\nIMPORTANT: If you are connecting to MongoDB Atlas, please check if your IP address is whitelisted in Atlas Network Access: https://www.mongodb.com/docs/atlas/security-whitelist/');
//       console.error('Alternatively, since you have a local MongoDB server running, you can set USE_LOCAL_DB=true in your .env file to run locally.\n');
//     }
//     process.exit(1);
//   }
// };

// seedData();
