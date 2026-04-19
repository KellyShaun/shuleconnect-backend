const express = require('express');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
    destination: './uploads/documents/',
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});
const upload = multer({ storage });

const {
    getStaff,
    getStaffById,
    createStaff,
    createContract,
    getExpiringContracts,
    getLeaveTypes,
    getLeaveBalances,
    submitLeaveRequest,
    approveLeaveRequest,
    processPayroll,
    getPayrollHistory,
    generatePayslip,
    createAppraisal,
    uploadStaffDocument,
    getExpiringDocuments,
    getHRDashboard
} = require('../controllers/hrController');

const router = express.Router();

// Staff Management
router.get('/staff', authenticateToken, getStaff);
router.get('/staff/:id', authenticateToken, getStaffById);
router.post('/staff', authenticateToken, authorizeRole('school_admin'), createStaff);

// Contracts
router.post('/contracts', authenticateToken, authorizeRole('school_admin'), createContract);
router.get('/contracts/expiring', authenticateToken, authorizeRole('school_admin'), getExpiringContracts);

// Leave Management
router.get('/leave/types', authenticateToken, getLeaveTypes);
router.get('/leave/balances/:staff_id', authenticateToken, getLeaveBalances);
router.post('/leave/requests', authenticateToken, submitLeaveRequest);
router.put('/leave/requests/:id/approve', authenticateToken, authorizeRole('school_admin'), approveLeaveRequest);

// Payroll
router.post('/payroll/process', authenticateToken, authorizeRole('school_admin'), processPayroll);
router.get('/payroll/history', authenticateToken, authorizeRole('school_admin'), getPayrollHistory);
router.get('/payroll/payslip/:payroll_item_id', authenticateToken, generatePayslip);

// Appraisals
router.post('/appraisals', authenticateToken, authorizeRole('school_admin'), createAppraisal);

// Documents
router.post('/documents', authenticateToken, upload.single('file'), uploadStaffDocument);
router.get('/documents/expiring', authenticateToken, authorizeRole('school_admin'), getExpiringDocuments);

// Dashboard
router.get('/dashboard', authenticateToken, authorizeRole('school_admin'), getHRDashboard);

module.exports = router;