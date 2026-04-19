const express = require('express');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const {
    getTodayAttendance,
    markAttendance,
    getTeacherClasses
} = require('../controllers/attendanceController');

const router = express.Router();

// Get teacher's classes
router.get('/my-classes', authenticateToken, getTeacherClasses);

// Get today's attendance
router.get('/today', authenticateToken, getTodayAttendance);

// Mark attendance
router.post('/mark', authenticateToken, markAttendance);

module.exports = router;