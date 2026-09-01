const express = require('express');
const courseRoutes = require('../routes/courseRoutes');
const lessonRoutes = require('../routes/lesson.routes');

const app = express();
app.use(express.json());
app.use('/api/courses', courseRoutes);
app.use(lessonRoutes);

// Catch-all 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`
  });
});

const server = app.listen(0, async () => {
  const port = server.address().port;
  console.log(`Test server running on port ${port}`);

  try {
    const response = await fetch(`http://localhost:${port}/api/courses/CRS-000028/modules/6a75c05aa40cac8823559c6b/lessons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lessonTitle: 'Test Lesson Title' })
    });

    const body = await response.json();
    console.log('Response Status:', response.status);
    console.log('Response Body:', body);

    if (response.status !== 404) {
      console.log('✓ Route matched successfully! (Status is NOT 404)');
    } else {
      console.error('❌ Route failed with 404 Not Found');
    }
  } catch (err) {
    console.error('Fetch error:', err);
  } finally {
    server.close();
  }
});
