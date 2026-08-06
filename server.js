require('dotenv').config();

const express = require('express');
const connectDB = require('./config/db');

const app = express();

app.use(express.json());

// Routes
app.use('/api/courses', require('./routes/courseRoutes'));

// MongoDB connection
connectDB();

app.get('/', (req, res) => {
  res.json({
    message: 'Backend is working'
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});