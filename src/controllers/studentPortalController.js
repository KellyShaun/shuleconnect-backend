const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

// Get student profile
async function getStudentProfile(req, res) {
    try {
        const result = await pool.query(`
            SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.date_of_birth,
                   s.admission_number, s.student_type, c.name as class_name
            FROM users u
            JOIN students s ON u.id = s.user_id
            LEFT JOIN classes c ON s.class_id = c.id
            WHERE u.id = $1
        `, [req.user.id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Student not found' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error fetching student profile:', error);
        res.status(500).json({ error: 'Error fetching student profile' });
    }
}

// Get student dashboard data
async function getStudentDashboard(req, res) {
    try {
        // Get student ID
        const student = await pool.query(`
            SELECT id, class_id FROM students WHERE user_id = $1
        `, [req.user.id]);
        
        const studentId = student.rows[0]?.id;
        const classId = student.rows[0]?.class_id;
        
        // Get attendance rate
        const attendance = await pool.query(`
            SELECT 
                COUNT(CASE WHEN status = 'present' THEN 1 END) as present,
                COUNT(*) as total
            FROM attendance
            WHERE student_id = $1 AND date >= CURRENT_DATE - INTERVAL '30 days'
        `, [studentId]);
        
        const attendanceRate = attendance.rows[0].total > 0 
            ? (attendance.rows[0].present / attendance.rows[0].total) * 100 
            : 0;
        
        // Get average score
        const averageScore = await pool.query(`
            SELECT AVG(score) as avg_score
            FROM results r
            JOIN exams e ON r.exam_id = e.id
            WHERE r.student_id = $1
            ORDER BY e.exam_date DESC
            LIMIT 5
        `, [studentId]);
        
        // Get pending assignments
        const assignments = await pool.query(`
            SELECT COUNT(*) as count
            FROM assignments a
            WHERE a.class_id = $1 AND a.due_date > CURRENT_DATE
            AND NOT EXISTS (
                SELECT 1 FROM assignment_submissions 
                WHERE assignment_id = a.id AND student_id = $2
            )
        `, [classId, studentId]);
        
        // Get borrowed books
        const books = await pool.query(`
            SELECT COUNT(*) as count
            FROM borrowings b
            WHERE b.user_id = $1 AND b.status = 'borrowed'
        `, [req.user.id]);
        
        // Get today's schedule
        const todaySchedule = await pool.query(`
            SELECT te.*, s.name as subject_name, u.first_name as teacher_first, u.last_name as teacher_last,
                   p.start_time, p.end_time, r.room_name
            FROM timetable_entries te
            JOIN subjects s ON te.subject_id = s.id
            JOIN users u ON te.teacher_id = u.id
            JOIN periods p ON te.period_id = p.id
            LEFT JOIN rooms r ON te.room_id = r.id
            WHERE te.class_id = $1 AND te.day_of_week = EXTRACT(DOW FROM CURRENT_DATE)
            ORDER BY p.start_time
        `, [classId]);
        
        // Get announcements
        const announcements = await pool.query(`
            SELECT title, message, created_at as date
            FROM announcements
            WHERE school_id = (SELECT school_id FROM users WHERE id = $1)
                AND status = 'published'
            ORDER BY created_at DESC
            LIMIT 5
        `, [req.user.id]);
        
        // Get recent results
        const results = await pool.query(`
            SELECT s.name as subject_name, r.score, r.grade,
                   AVG(r.score) OVER (PARTITION BY e.subject_id) as class_average,
                   e.term_id
            FROM results r
            JOIN exams e ON r.exam_id = e.id
            JOIN subjects s ON e.subject_id = s.id
            WHERE r.student_id = $1
            ORDER BY e.exam_date DESC
            LIMIT 5
        `, [studentId]);
        
        // Get fee balance
        const fees = await pool.query(`
            SELECT 
                COALESCE(SUM(discounted_amount), 0) as expected,
                COALESCE(SUM(paid_amount), 0) as paid
            FROM student_fees
            WHERE student_id = $1
        `, [studentId]);
        
        const feeBalance = fees.rows[0].expected - fees.rows[0].paid;
        
        res.json({
            attendance_rate: Math.round(attendanceRate),
            average_score: Math.round(averageScore.rows[0]?.avg_score || 0),
            pending_assignments: parseInt(assignments.rows[0].count),
            borrowed_books: parseInt(books.rows[0].count),
            today_schedule: todaySchedule.rows.map(row => ({
                start_time: row.start_time.slice(0,5),
                end_time: row.end_time.slice(0,5),
                subject_name: row.subject_name,
                teacher_name: `${row.teacher_first} ${row.teacher_last}`,
                room_name: row.room_name
            })),
            announcements: announcements.rows,
            recent_results: results.rows,
            fee_expected: parseFloat(fees.rows[0].expected),
            fee_paid: parseFloat(fees.rows[0].paid),
            fee_balance: feeBalance
        });
    } catch (error) {
        console.error('Error fetching dashboard:', error);
        res.status(500).json({ error: 'Error fetching dashboard data' });
    }
}

// Change password
async function changePassword(req, res) {
    const { current_password, new_password } = req.body;
    
    try {
        const user = await pool.query(`
            SELECT password_hash FROM users WHERE id = $1
        `, [req.user.id]);
        
        const isValid = await bcrypt.compare(current_password, user.rows[0].password_hash);
        
        if (!isValid) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }
        
        const hashedPassword = await bcrypt.hash(new_password, 10);
        
        await pool.query(`
            UPDATE users SET password_hash = $1 WHERE id = $2
        `, [hashedPassword, req.user.id]);
        
        res.json({ message: 'Password changed successfully' });
    } catch (error) {
        console.error('Error changing password:', error);
        res.status(500).json({ error: 'Error changing password' });
    }
}

module.exports = {
    getStudentProfile,
    getStudentDashboard,
    changePassword
};