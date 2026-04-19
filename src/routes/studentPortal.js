const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const {
    getStudentProfile,
    getStudentDashboard,
    changePassword
} = require('../controllers/studentPortalController');

const router = express.Router();

router.get('/profile', authenticateToken, getStudentProfile);
router.get('/dashboard', authenticateToken, getStudentDashboard);
router.post('/change-password', authenticateToken, changePassword);

module.exports = router;