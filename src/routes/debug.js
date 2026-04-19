const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const router = express.Router();

router.get('/me', authenticateToken, async (req, res) => {
    res.json({
        user: req.user,
        role: req.user.role,
        school_id: req.user.school_id,
        is_active: req.user.is_active
    });
});

module.exports = router;