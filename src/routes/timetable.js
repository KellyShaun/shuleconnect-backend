const express = require('express');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const {
    getClasses,
    getSubjects,
    getTeachers,
    getRooms,
    getPeriods,
    getTerms,
    getClassTimetable,
    getTeacherTimetable,
    createTimetableEntry,
    updateTimetableEntry,
    deleteTimetableEntry
} = require('../controllers/timetableController');

const router = express.Router();

// Get all data
router.get('/classes', authenticateToken, getClasses);
router.get('/subjects', authenticateToken, getSubjects);
router.get('/teachers', authenticateToken, getTeachers);
router.get('/rooms', authenticateToken, getRooms);
router.get('/periods', authenticateToken, getPeriods);
router.get('/terms', authenticateToken, getTerms);

// Timetable views
router.get('/class', authenticateToken, getClassTimetable);
router.get('/teacher', authenticateToken, getTeacherTimetable);

// Timetable management
router.post('/entries', authenticateToken, authorizeRole('school_admin', 'teacher'), createTimetableEntry);
router.put('/entries/:id', authenticateToken, authorizeRole('school_admin', 'teacher'), updateTimetableEntry);
router.delete('/entries/:id', authenticateToken, authorizeRole('school_admin', 'teacher'), deleteTimetableEntry);

module.exports = router;