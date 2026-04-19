const express = require('express');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const {
    getDormitories,
    createDormitory,
    getRooms,
    createRoom,
    getAvailableBeds,
    allocateBed,
    getStudentAllocation,
    checkInStudent,
    checkOutStudent,
    getMealMenus,
    createMealMenu,
    markMealAttendance,
    requestVisitorAccess,
    approveVisitor,
    addDisciplineRecord,
    addMedicalLog,
    getHostelDashboard
} = require('../controllers/hostelController');

const router = express.Router();

// Dashboard
router.get('/dashboard', authenticateToken, getHostelDashboard);

// Dormitories & Rooms
router.get('/dormitories', authenticateToken, getDormitories);
router.post('/dormitories', authenticateToken, authorizeRole('school_admin'), createDormitory);
router.get('/rooms', authenticateToken, getRooms);
router.post('/rooms', authenticateToken, authorizeRole('school_admin'), createRoom);
router.get('/available-beds', authenticateToken, getAvailableBeds);
router.post('/allocate-bed', authenticateToken, authorizeRole('school_admin'), allocateBed);
router.get('/student-allocation/:student_id', authenticateToken, getStudentAllocation);

// Check-in/out
router.post('/check-in', authenticateToken, authorizeRole('school_admin', 'house_parent'), checkInStudent);
router.post('/check-out', authenticateToken, authorizeRole('school_admin', 'house_parent'), checkOutStudent);

// Meal Management
router.get('/meal-menus', authenticateToken, getMealMenus);
router.post('/meal-menus', authenticateToken, authorizeRole('school_admin'), createMealMenu);
router.post('/meal-attendance', authenticateToken, authorizeRole('school_admin', 'house_parent'), markMealAttendance);

// Visitor Management
router.post('/visitor-request', authenticateToken, requestVisitorAccess);
router.put('/visitor-approve', authenticateToken, authorizeRole('school_admin', 'house_parent'), approveVisitor);

// Discipline & Medical
router.post('/discipline', authenticateToken, authorizeRole('school_admin', 'house_parent'), addDisciplineRecord);
router.post('/medical', authenticateToken, authorizeRole('school_admin', 'house_parent'), addMedicalLog);

module.exports = router;