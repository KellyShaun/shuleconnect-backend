const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const router = express.Router();

// Get dashboard stats
router.get('/stats', authenticateToken, async (req, res) => {
    try {
        // Get total students
        const students = await req.db.query(`
            SELECT COUNT(*) as total FROM students s
            JOIN users u ON s.user_id = u.id
            WHERE u.school_id = $1 AND s.enrollment_status = 'active'
        `, [req.user.school_id]);
        
        // Get total teachers
        const teachers = await req.db.query(`
            SELECT COUNT(*) as total FROM users 
            WHERE school_id = $1 AND role = 'teacher' AND is_active = true
        `, [req.user.school_id]);
        
        // Get total classes
        const classes = await req.db.query(`
            SELECT COUNT(*) as total FROM classes 
            WHERE school_id = $1 AND is_active = true
        `, [req.user.school_id]);
        
        // Get fee collection rate
        const fees = await req.db.query(`
            SELECT 
                COALESCE(SUM(sf.discounted_amount), 0) as expected,
                COALESCE(SUM(sf.paid_amount), 0) as collected
            FROM student_fees sf
            JOIN students s ON sf.student_id = s.id
            JOIN users u ON s.user_id = u.id
            WHERE u.school_id = $1
        `, [req.user.school_id]);
        
        const collectionRate = fees.rows[0].expected > 0 
            ? (fees.rows[0].collected / fees.rows[0].expected) * 100 
            : 0;
        
        res.json({
            totalStudents: parseInt(students.rows[0].total),
            totalTeachers: parseInt(teachers.rows[0].total),
            totalClasses: parseInt(classes.rows[0].total),
            feeCollectionRate: Math.round(collectionRate)
        });
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        res.status(500).json({ error: 'Error fetching dashboard stats' });
    }
});

// Get attendance trend
router.get('/attendance-trend', authenticateToken, async (req, res) => {
    try {
        const result = await req.db.query(`
            SELECT 
                TO_CHAR(date, 'Mon DD') as date,
                COUNT(CASE WHEN status = 'present' THEN 1 END) as present,
                COUNT(CASE WHEN status = 'absent' THEN 1 END) as absent,
                COUNT(CASE WHEN status = 'late' THEN 1 END) as late
            FROM attendance a
            JOIN students s ON a.student_id = s.id
            JOIN users u ON s.user_id = u.id
            WHERE u.school_id = $1 
                AND a.date >= CURRENT_DATE - INTERVAL '30 days'
            GROUP BY date
            ORDER BY date DESC
            LIMIT 7
        `, [req.user.school_id]);
        
        res.json(result.rows.reverse());
    } catch (error) {
        console.error('Error fetching attendance trend:', error);
        res.json([]);
    }
});

// Get fee collection data for chart
router.get('/fee-collection', authenticateToken, async (req, res) => {
    try {
        const result = await req.db.query(`
            SELECT 
                'Paid' as name,
                COALESCE(SUM(sf.paid_amount), 0) as value
            FROM student_fees sf
            JOIN students s ON sf.student_id = s.id
            JOIN users u ON s.user_id = u.id
            WHERE u.school_id = $1
            UNION ALL
            SELECT 
                'Pending' as name,
                COALESCE(SUM(sf.balance), 0) as value
            FROM student_fees sf
            JOIN students s ON sf.student_id = s.id
            JOIN users u ON s.user_id = u.id
            WHERE u.school_id = $1 AND sf.balance > 0
        `, [req.user.school_id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching fee collection:', error);
        res.json([{ name: 'Paid', value: 0 }, { name: 'Pending', value: 0 }]);
    }
});

module.exports = router;