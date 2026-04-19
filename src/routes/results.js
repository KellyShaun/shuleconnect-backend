const express = require('express');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const {
    getGradingScales,
    saveGradingScale,
    getExams,
    createExam,
    getExamDetails,
    getStudentsForMarks,
    saveMarks,
    bulkUploadMarks,
    calculateTermPerformance,
    getClassPerformance,
    generateReportCard,
    generateBulkReportCards,
    getPerformanceTrends,
    getSubjectPerformance,
    getResultsDashboardStats,
    getAIInsights
} = require('../controllers/resultsController');

const router = express.Router();

// Grading Scales
router.get('/grading-scales', authenticateToken, getGradingScales);
router.post('/grading-scales', authenticateToken, authorizeRole('school_admin'), saveGradingScale);

// Exams
router.get('/exams', authenticateToken, getExams);
router.get('/exams/:id', authenticateToken, getExamDetails);
router.post('/exams', authenticateToken, authorizeRole('teacher', 'school_admin'), createExam);

// Marks Entry
router.get('/marks/students', authenticateToken, getStudentsForMarks);
router.post('/marks/save', authenticateToken, authorizeRole('teacher', 'school_admin'), saveMarks);
router.post('/marks/bulk-upload', authenticateToken, authorizeRole('teacher', 'school_admin'), bulkUploadMarks);

// Performance
router.get('/performance/term/:student_id/:term_id', authenticateToken, calculateTermPerformance);
router.get('/performance/class', authenticateToken, getClassPerformance);
router.get('/performance/trends/:student_id', authenticateToken, getPerformanceTrends);
router.get('/performance/subject', authenticateToken, getSubjectPerformance);

// Report Cards
router.get('/report-card/:student_id/:term_id', authenticateToken, generateReportCard);
router.get('/report-cards/bulk', authenticateToken, authorizeRole('teacher', 'school_admin'), generateBulkReportCards);

// Dashboard & Analytics
router.get('/dashboard/stats', authenticateToken, getResultsDashboardStats);
router.get('/insights', authenticateToken, getAIInsights);

module.exports = router;