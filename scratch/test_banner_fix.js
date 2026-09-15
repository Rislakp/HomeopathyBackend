const path = require('path');

const getBaseUrl = (req) => {
  if (process.env.BASE_URL) {
    return process.env.BASE_URL.replace(/\/+$/, '');
  }
  if (process.env.SERVER_URL) {
    return process.env.SERVER_URL.replace(/\/+$/, '');
  }
  if (req && req.get && typeof req.get === 'function' && req.get('host')) {
    const protocol = req.headers && req.headers['x-forwarded-proto']
      ? req.headers['x-forwarded-proto']
      : (req.protocol || 'https');
    return `${protocol}://${req.get('host')}`;
  }
  return 'https://homeopathybackend-1.onrender.com';
};

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

// Test cases
console.log('Test 1 (Relative path with req):', toAbsoluteUrl('/uploads/sample.pdf', { protocol: 'http', get: () => 'localhost:5000' }));
console.log('Test 2 (Relative path without req):', toAbsoluteUrl('/uploads/course_banner.jpg'));
console.log('Test 3 (Relative path without leading slash):', toAbsoluteUrl('uploads/banner.png'));
console.log('Test 4 (Cloudinary URL):', toAbsoluteUrl('https://res.cloudinary.com/demo/image/upload/v12345/sample.jpg'));
