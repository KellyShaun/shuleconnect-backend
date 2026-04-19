const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const {
    getChildren,
    getChildDashboard,
    payFees,
    sendMessage,
    requestAbsence,
    downloadReportCard
} = require('../controllers/parentPortalController');

const storage = multer.diskStorage({
    destination: './uploads/absence_requests/',
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});
const upload = multer({ storage });

const router = express.Router();

router.get('/children', authenticateToken, getChildren);
router.get('/child/:student_id/dashboard', authenticateToken, getChildDashboard);
router.post('/pay-fees', authenticateToken, payFees);
router.post('/send-message', authenticateToken, sendMessage);
router.post('/request-absence', authenticateToken, upload.single('attachment'), requestAbsence);
router.get('/report-card/:student_id/:term_id', authenticateToken, downloadReportCard);

module.exports = router;