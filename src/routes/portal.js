const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const router = express.Router();

// Parent endpoints
router.get('/parent/children', authenticateToken, async (req, res) => {
    // Only parents can access
    if (req.user.role !== 'parent') {
        return res.status(403).json({ error: 'Access denied' });
    }
    
    try {
        const result = await req.db.query(`
            SELECT s.id, s.admission_number, u.first_name, u.last_name, c.name as class_name
            FROM student_parents sp
            JOIN students s ON sp.student_id = s.id
            JOIN users u ON s.user_id = u.id
            JOIN classes c ON s.class_id = c.id
            WHERE sp.parent_id = $1
        `, [req.user.id]);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/parent/child/:studentId/dashboard', authenticateToken, async (req, res) => {
    const { studentId } = req.params;
    
    try {
        // Verify parent has access to this child
        const access = await req.db.query(`
            SELECT 1 FROM student_parents 
            WHERE student_id = $1 AND parent_id = $2
        `, [studentId, req.user.id]);
        
        if (access.rows.length === 0 && req.user.role !== 'school_admin') {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        // Get attendance rate
        const attendance = await req.db.query(`
            SELECT 
                COUNT(CASE WHEN status = 'present' THEN 1 END) as present,
                COUNT(*) as total
            FROM attendance
            WHERE student_id = $1 AND date >= CURRENT_DATE - INTERVAL '30 days'
        `, [studentId]);
        
        const attendanceRate = attendance.rows[0].total > 0 
            ? (attendance.rows[0].present / attendance.rows[0].total) * 100 
            : 0;
        
        // Get fee balance
        const fees = await req.db.query(`
            SELECT 
                COALESCE(SUM(discounted_amount), 0) as expected,
                COALESCE(SUM(paid_amount), 0) as paid
            FROM student_fees
            WHERE student_id = $1
        `, [studentId]);
        
        const feeBalance = {
            expected: parseFloat(fees.rows[0].expected),
            paid: parseFloat(fees.rows[0].paid),
            balance: parseFloat(fees.rows[0].expected) - parseFloat(fees.rows[0].paid)
        };
        
        // Get performance
        const performance = await req.db.query(`
            SELECT average_score, mean_grade, class_position
            FROM term_performance
            WHERE student_id = $1
            ORDER BY id DESC
            LIMIT 1
        `, [studentId]);
        
        // Get borrowed books
        const books = await req.db.query(`
            SELECT bk.title, bk.author, b.due_date
            FROM borrowings b
            JOIN book_copies bc ON b.copy_id = bc.id
            JOIN books bk ON bc.book_id = bk.id
            WHERE b.user_id = (SELECT user_id FROM students WHERE id = $1)
                AND b.status = 'borrowed'
        `, [studentId]);
        
        res.json({
            attendance_rate: Math.round(attendanceRate),
            fee_balance: feeBalance,
            mean_score: performance.rows[0]?.average_score || 0,
            position: performance.rows[0]?.class_position || 'N/A',
            borrowed_books: books.rows,
            due_soon: books.rows.filter(b => {
                const dueDate = new Date(b.due_date);
                const today = new Date();
                const diffDays = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
                return diffDays <= 3 && diffDays >= 0;
            }).length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Student endpoints
router.get('/student/dashboard', authenticateToken, async (req, res) => {
    if (req.user.role !== 'student') {
        return res.status(403).json({ error: 'Access denied' });
    }
    
    try {
        const student = await req.db.query(`
            SELECT s.id, s.admission_number, u.first_name, u.last_name, c.name as class_name
            FROM students s
            JOIN users u ON s.user_id = u.id
            JOIN classes c ON s.class_id = c.id
            WHERE u.id = $1
        `, [req.user.id]);
        
        const studentId = student.rows[0]?.id;
        
        // Get timetable
        const timetable = await req.db.query(`
            SELECT te.*, s.name as subject_name, p.period_number, p.start_time, p.end_time
            FROM timetable_entries te
            JOIN subjects s ON te.subject_id = s.id
            JOIN periods p ON te.period_id = p.id
            WHERE te.class_id = (SELECT class_id FROM students WHERE id = $1)
                AND te.day_of_week = EXTRACT(DOW FROM CURRENT_DATE)
            ORDER BY p.period_number
        `, [studentId]);
        
        // Get performance trend
        const performance = await req.db.query(`
            SELECT tp.average_score, t.term_name
            FROM term_performance tp
            JOIN academic_terms t ON tp.term_id = t.id
            WHERE tp.student_id = $1
            ORDER BY t.id
        `, [studentId]);
        
        res.json({
            first_name: student.rows[0]?.first_name,
            class_name: student.rows[0]?.class_name,
            admission_number: student.rows[0]?.admission_number,
            timetable: timetable.rows,
            performance_trend: performance.rows.map(p => ({
                exam: p.term_name,
                score: p.average_score
            }))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Notifications
router.get('/parent/notifications', authenticateToken, async (req, res) => {
    try {
        const result = await req.db.query(`
            SELECT * FROM notifications
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT 50
        `, [req.user.id]);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/notifications/:id/mark-read', authenticateToken, async (req, res) => {
    try {
        await req.db.query(`
            UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2
        `, [req.params.id, req.user.id]);
        res.json({ message: 'Marked as read' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;