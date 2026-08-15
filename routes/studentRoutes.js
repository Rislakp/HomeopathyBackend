const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
  res.json({ message: 'Courses API' });
});

module.exports = router;