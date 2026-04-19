// backend/src/routes/communication.js
const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const router = express.Router();

router.get('/', authenticateToken, async (req, res) => {
  res.json({ message: 'Communication route - to be implemented' });
});

module.exports = router;