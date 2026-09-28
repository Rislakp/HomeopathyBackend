import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * k6 Load Testing Script for HomeopathyBackend
 * Target Concurrency: 50 -> 100 -> 250 -> 500 Concurrent Virtual Users (VUs)
 *
 * Usage:
 *   k6 run --env TARGET_URL=http://localhost:5000 scripts/load_test_k6.js
 *   k6 run --env TARGET_URL=https://your-app.onrender.com scripts/load_test_k6.js
 */

export const options = {
  stages: [
    { duration: '30s', target: 50 },  // Ramp-up to 50 concurrent users
    { duration: '1m',  target: 50 },  // Hold 50 users
    { duration: '30s', target: 100 }, // Ramp-up to 100 concurrent users
    { duration: '1m',  target: 100 }, // Hold 100 users
    { duration: '30s', target: 250 }, // Ramp-up to 250 concurrent users
    { duration: '1m',  target: 250 }, // Hold 250 users
    { duration: '30s', target: 500 }, // Ramp-up to 500 concurrent users
    { duration: '1m',  target: 500 }, // Hold 500 users
    { duration: '30s', target: 0 },   // Ramp-down to 0
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],   // Error rate must be less than 1%
    http_req_duration: ['p(95)<500', 'p(99)<1000'], // 95% of requests < 500ms, 99% < 1000ms
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:5000';

export default function () {
  // 1. Health check endpoint (Stateless ping)
  const healthRes = http.get(`${BASE_URL}/health`);
  check(healthRes, {
    'health status is 200': (r) => r.status === 200,
  });

  sleep(1);

  // 2. Public courses listing (Cached endpoint)
  const coursesRes = http.get(`${BASE_URL}/api/courses`);
  check(coursesRes, {
    'courses status is 200': (r) => r.status === 200,
    'courses payload returned': (r) => r.json().success === true,
  });

  sleep(2);

  // 3. Subscription plans listing
  const subsRes = http.get(`${BASE_URL}/api/subscriptions`);
  check(subsRes, {
    'subscriptions status is 200': (r) => r.status === 200,
  });

  sleep(2);
}
