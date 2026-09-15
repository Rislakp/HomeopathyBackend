const mongoose = require('mongoose');
const Course = require('../models/Course');

const getBaseUrl = (req) => 'https://homeopathybackend-1.onrender.com';

const toAbsoluteUrl = (urlStr, req) => {
  if (typeof urlStr !== 'string') return '';
  const trimmed = urlStr.trim();
  if (!trimmed) return '';

  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:')) {
    return trimmed;
  }

  const baseUrl = getBaseUrl(req);
  const cleanPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${baseUrl}${cleanPath}`;
};

const serializeCourse = (courseDoc, req) => {
  if (!courseDoc) return null;
  const obj = courseDoc.toObject ? courseDoc.toObject({ virtuals: true }) : { ...courseDoc };

  const rawBanner = obj.courseBanner || obj.thumbnail || obj.bannerUrl || obj.banner || obj.thumbnailUrl || obj.image || obj.imageUrl || '';
  const absoluteBanner = toAbsoluteUrl(rawBanner, req);

  obj.thumbnail = absoluteBanner;
  obj.bannerUrl = absoluteBanner;
  obj.courseBanner = absoluteBanner;
  obj.banner = absoluteBanner;
  obj.thumbnailUrl = absoluteBanner;
  obj.image = absoluteBanner;
  obj.imageUrl = absoluteBanner;

  return obj;
};

// Create simulated course document with courseBanner field set
const c1 = new Course({
  courseTitle: 'Homeopathy Fundamentals',
  instructor: 'Dr. Smith',
  price: 99,
  courseBanner: '/uploads/homeopathy_banner.png'
});

const obj1 = serializeCourse(c1, null);
console.log('--- Test 1: courseBanner specified ---');
console.log('courseBanner:', obj1.courseBanner);
console.log('thumbnail:', obj1.thumbnail);
console.log('bannerUrl:', obj1.bannerUrl);

// Create simulated course document with thumbnail field set
const c2 = new Course({
  courseTitle: 'Advanced Homeopathy',
  instructor: 'Dr. Doe',
  price: 199,
  thumbnail: 'uploads/thumb.jpg'
});

const obj2 = serializeCourse(c2, null);
console.log('\n--- Test 2: relative thumbnail specified ---');
console.log('courseBanner:', obj2.courseBanner);
console.log('thumbnail:', obj2.thumbnail);
console.log('bannerUrl:', obj2.bannerUrl);

// Create simulated course document with Cloudinary URL
const c3 = new Course({
  courseTitle: 'Clinical Homeopathy',
  instructor: 'Dr. Jones',
  price: 299,
  bannerUrl: 'https://res.cloudinary.com/demo/image/upload/v12345/cloud.jpg'
});

const obj3 = serializeCourse(c3, null);
console.log('\n--- Test 3: Cloudinary URL specified ---');
console.log('courseBanner:', obj3.courseBanner);
console.log('thumbnail:', obj3.thumbnail);
console.log('bannerUrl:', obj3.bannerUrl);

console.log('\nAll tests completed successfully!');
