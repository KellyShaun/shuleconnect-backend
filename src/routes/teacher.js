const express = require('express');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const multer = require('multer');
const {
    getTeacherDashboard,
    getTeacherClasses,
    getClassStudents,
    getClassAttendance,
    postAssignment
} = require('../controllers/teacherController');

const storage = multer.diskStorage({
    destination: './uploads/assignments/',
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});
const upload = multer({ storage });

const router = express.Router();

router.use(authenticateToken);
router.use(authorizeRole('teacher'));

router.get('/dashboard', getTeacherDashboard);
router.get('/classes', getTeacherClasses);
router.get('/classes/:class_id/students', getClassStudents);
router.get('/attendance/class/:class_id', getClassAttendance);
router.post('/assignments', upload.single('attachment'), postAssignment);

module.exports = router;