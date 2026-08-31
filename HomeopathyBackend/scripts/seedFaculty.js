require('dotenv').config();
const mongoose = require('mongoose');
const Faculty = require('../models/Faculty');

const facultyData = [
  {
    fullName: 'Dr. John Smith',
    email: 'dr.smith@whitecoat.academy',
    department: 'Classical Homeopathy',
    role: 'Department Head',
    qualification: 'MD (Hom), Ph.D.',
    status: 'Active',
    phone: '+1 (555) 234-5678',
    bio: 'Pioneer in classical homeopathic posology with over 22 years of clinical research experience.',
    experience: '22 Years',
    avatarUrl: 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=400&auto=format&fit=crop&q=80',
  },
  {
    fullName: 'Dr. Clara Bow',
    email: 'dr.clara.bow@whitecoat.academy',
    department: 'Materia Medica',
    role: 'Senior Professor',
    qualification: 'MD (Hom), BHMS',
    status: 'Active',
    phone: '+1 (555) 345-6789',
    bio: 'Specialist in constitutional remedies, pediatric materia medica, and comparative provings.',
    experience: '18 Years',
    avatarUrl: 'https://images.unsplash.com/photo-1594824813598-6a56bca7f91a?w=400&auto=format&fit=crop&q=80',
  },
  {
    fullName: 'Dr. Albert Allen',
    email: 'dr.allen@whitecoat.academy',
    department: 'Organon & Philosophy',
    role: 'Associate Professor',
    qualification: 'MD (Hom)',
    status: 'Active',
    phone: '+1 (555) 456-7890',
    bio: 'Author and lecturer specializing in Hahnemannian philosophy and chronic disease miasm analysis.',
    experience: '14 Years',
    avatarUrl: 'https://images.unsplash.com/photo-1537368910025-700350fe46c7?w=400&auto=format&fit=crop&q=80',
  },
  {
    fullName: 'Dr. Emma Watson',
    email: 'dr.emma.watson@whitecoat.academy',
    department: 'Repertory',
    role: 'Assistant Professor',
    qualification: 'BHMS, M.Sc (Clinical Research)',
    status: 'Active',
    phone: '+1 (555) 567-8901',
    bio: 'Expert in modern repertorization methodologies, synthesis repertory, and computerized analysis.',
    experience: '10 Years',
    avatarUrl: 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=400&auto=format&fit=crop&q=80',
  },
  {
    fullName: 'Dr. Henry Cavill',
    email: 'dr.henry@whitecoat.academy',
    department: 'Pharmacy & Practice',
    role: 'Clinical Instructor',
    qualification: 'BHMS, PGDHM',
    status: 'Active',
    phone: '+1 (555) 678-9012',
    bio: 'Specialized in homeopathic pharmacopoeia, preparation standards, and clinical case taking.',
    experience: '8 Years',
    avatarUrl: 'https://images.unsplash.com/photo-1582750433449-648ed127bb54?w=400&auto=format&fit=crop&q=80',
  },
  {
    fullName: 'Dr. Irene Adler',
    email: 'dr.adler@whitecoat.academy',
    department: 'Materia Medica',
    role: 'Adjunct Lecturer',
    qualification: 'MD (Hom)',
    status: 'Active',
    phone: '+1 (555) 789-0123',
    bio: 'Leading researcher in rare nosodes, sarcodes, and plant family classification systems.',
    experience: '12 Years',
    avatarUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=400&auto=format&fit=crop&q=80',
  },
  {
    fullName: 'Dr. David Miller',
    email: 'dr.miller@whitecoat.academy',
    department: 'Classical Homeopathy',
    role: 'Visiting Faculty',
    qualification: 'MD (Hom)',
    status: 'Inactive', // Inactive to test status filtering
    phone: '+1 (555) 890-1234',
    bio: 'Former clinical consultant on sabbatical.',
    experience: '15 Years',
    avatarUrl: '',
  },
];

const seedFaculty = async () => {
  const dbUri = process.env.USE_LOCAL_DB === 'true'
    ? process.env.MONGODB_LOCAL_URI
    : (process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/homeopathy_db');

  try {
    await mongoose.connect(dbUri);
    console.log('✅ MongoDB connected for Faculty seeding...');

    await Faculty.deleteMany({});
    console.log('🗑️ Cleared existing faculty members.');

    const created = await Faculty.insertMany(facultyData);
    console.log(`🎉 Successfully seeded ${created.length} faculty members!`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Faculty seeding failed:', error.message);
    process.exit(1);
  }
};

seedFaculty();
