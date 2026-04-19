const express = require('express');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const {
    createFeeStructure,
    getFeeStructures,
    assignFeesToStudents,
    getStudentFeeBalance,
    processPayment,
    initiateSTKPush,
    mpesaCallback,
    getFeeCollectionReport,
    getDefaulters,
    getFeeDashboardStats,
    recordExpense,
    applyDiscount
} = require('../controllers/feeController');

const router = express.Router();

// Fee Structures
router.post('/structures', authenticateToken, authorizeRole('school_admin', 'accountant'), createFeeStructure);
router.get('/structures', authenticateToken, authorizeRole('school_admin', 'accountant'), getFeeStructures);
router.post('/assign', authenticateToken, authorizeRole('school_admin', 'accountant'), assignFeesToStudents);

// Student Fees
router.get('/student/:student_id/balance', authenticateToken, getStudentFeeBalance);

// Payments
router.post('/payment', authenticateToken, authorizeRole('school_admin', 'accountant'), processPayment);
router.post('/mpesa/stk-push', authenticateToken, initiateSTKPush);
router.post('/mpesa-callback', mpesaCallback);

// Reports
router.get('/reports/collection', authenticateToken, authorizeRole('school_admin', 'accountant'), getFeeCollectionReport);
router.get('/reports/defaulters', authenticateToken, authorizeRole('school_admin', 'accountant'), getDefaulters);
router.get('/dashboard/stats', authenticateToken, authorizeRole('school_admin', 'accountant'), getFeeDashboardStats);

// Expenses
router.post('/expenses', authenticateToken, authorizeRole('school_admin', 'accountant'), recordExpense);

// Discounts
router.post('/apply-discount', authenticateToken, authorizeRole('school_admin', 'accountant'), applyDiscount);

module.exports = router;