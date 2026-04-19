const { Pool } = require('pg');
const moment = require('moment');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

// Get parent's children
async function getChildren(req, res) {
    try {
        const result = await pool.query(`
            SELECT s.id, s.admission_number, u.first_name, u.last_name, 
                   c.name as class_name, s.student_type
            FROM student_parents sp
            JOIN students s ON sp.student_id = s.id
            JOIN users u ON s.user_id = u.id
            JOIN classes c ON s.class_id = c.id
            WHERE sp.parent_id = $1 AND s.enrollment_status = 'active'
        `, [req.user.id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching children:', error);
        res.status(500).json({ error: 'Error fetching children' });
    }
}

// Get child dashboard data
async function getChildDashboard(req, res) {
    const { student_id } = req.params;
    
    try {
        // Verify parent has access to this child
        const access = await pool.query(`
            SELECT 1 FROM student_parents 
            WHERE student_id = $1 AND parent_id = $2
        `, [student_id, req.user.id]);
        
        if (access.rows.length === 0) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        // Get attendance rate (last 30 days)
        const attendance = await pool.query(`
            SELECT 
                COUNT(CASE WHEN status = 'present' THEN 1 END) as present,
                COUNT(*) as total
            FROM attendance
            WHERE student_id = $1 AND date >= CURRENT_DATE - INTERVAL '30 days'
        `, [student_id]);
        
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
        `, [student_id]);
        
        // Get fee balance
        const fees = await pool.query(`
            SELECT 
                COALESCE(SUM(discounted_amount), 0) as expected,
                COALESCE(SUM(paid_amount), 0) as paid
            FROM student_fees
            WHERE student_id = $1
        `, [student_id]);
        
        const feeBalance = fees.rows[0].expected - fees.rows[0].paid;
        
        // Get borrowed books
        const books = await pool.query(`
            SELECT COUNT(*) as count
            FROM borrowings b
            JOIN book_copies bc ON b.copy_id = bc.id
            JOIN books bk ON bc.book_id = bk.id
            WHERE b.user_id = (SELECT user_id FROM students WHERE id = $1) 
                AND b.status = 'borrowed'
        `, [student_id]);
        
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
            LIMIT 10
        `, [student_id]);
        
        // Get performance trend
        const trend = await pool.query(`
            SELECT t.term_name, tp.average_score, tp.mean_grade
            FROM term_performance tp
            JOIN academic_terms t ON tp.term_id = t.id
            WHERE tp.student_id = $1
            ORDER BY t.id
        `, [student_id]);
        
        // Get attendance trend (last 7 days)
        const attendanceTrend = await pool.query(`
            SELECT 
                TO_CHAR(date, 'Mon DD') as date,
                COUNT(CASE WHEN status = 'present' THEN 1 END) as present,
                COUNT(CASE WHEN status = 'absent' THEN 1 END) as absent,
                COUNT(CASE WHEN status = 'late' THEN 1 END) as late
            FROM attendance
            WHERE student_id = $1 AND date >= CURRENT_DATE - INTERVAL '7 days'
            GROUP BY date
            ORDER BY date
        `, [student_id]);
        
        // Get borrowed books list
        const borrowedBooks = await pool.query(`
            SELECT bk.title, bk.author, b.borrowed_date, b.due_date
            FROM borrowings b
            JOIN book_copies bc ON b.copy_id = bc.id
            JOIN books bk ON bc.book_id = bk.id
            WHERE b.user_id = (SELECT user_id FROM students WHERE id = $1) 
                AND b.status = 'borrowed'
        `, [student_id]);
        
        // Get term summary
        const termSummary = await pool.query(`
            SELECT t.term_name, t.academic_year, tp.average_score, tp.mean_grade, tp.class_position as position, t.id as term_id
            FROM term_performance tp
            JOIN academic_terms t ON tp.term_id = t.id
            WHERE tp.student_id = $1
            ORDER BY t.id DESC
        `, [student_id]);
        
        // Get payment history
        const payments = await pool.query(`
            SELECT p.payment_date, p.receipt_number, p.amount, p.payment_method, p.reference
            FROM payments p
            WHERE p.student_id = $1
            ORDER BY p.payment_date DESC
            LIMIT 10
        `, [student_id]);
        
        res.json({
            attendance_rate: Math.round(attendanceRate),
            average_score: Math.round(averageScore.rows[0]?.avg_score || 0),
            fee_balance: feeBalance,
            total_fees: fees.rows[0].expected,
            total_paid: fees.rows[0].paid,
            borrowed_books: parseInt(books.rows[0].count),
            recent_results: results.rows,
            performance_trend: trend.rows.map(t => ({ exam: t.term_name, score: t.average_score })),
            attendance_trend: attendanceTrend.rows,
            borrowed_books_list: borrowedBooks.rows,
            term_summary: termSummary.rows,
            payment_history: payments.rows
        });
    } catch (error) {
        console.error('Error fetching child dashboard:', error);
        res.status(500).json({ error: 'Error fetching dashboard data' });
    }
}

// Pay fees
async function payFees(req, res) {
    const { student_id, amount } = req.body;
    
    try {
        // Create payment record
        const receiptNumber = `RCP${Date.now()}`;
        
        await pool.query(`
            INSERT INTO payments (school_id, student_id, amount, payment_method, receipt_number, status)
            VALUES ((SELECT school_id FROM users WHERE id = $1), $2, $3, 'mpesa', $4, 'pending')
        `, [req.user.id, student_id, amount, receiptNumber]);
        
        res.json({ message: 'Payment initiated successfully', receipt_number: receiptNumber });
    } catch (error) {
        console.error('Error processing payment:', error);
        res.status(500).json({ error: 'Error processing payment' });
    }
}

// Send message to teacher
async function sendMessage(req, res) {
    const { student_id, subject, message } = req.body;
    
    try {
        // Get class teacher
        const teacher = await pool.query(`
            SELECT teacher_id FROM class_subjects 
            WHERE class_id = (SELECT class_id FROM students WHERE id = $1)
            LIMIT 1
        `, [student_id]);
        
        if (teacher.rows.length === 0) {
            return res.status(404).json({ error: 'Teacher not found' });
        }
        
        await pool.query(`
            INSERT INTO messages (sender_id, receiver_id, subject, message, conversation_id)
            VALUES ($1, $2, $3, $4, 
                (SELECT COALESCE(MAX(conversation_id), 0) + 1 FROM messages)
            )
        `, [req.user.id, teacher.rows[0].teacher_id, subject, message]);
        
        res.json({ message: 'Message sent successfully' });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Error sending message' });
    }
}

// Request absence
async function requestAbsence(req, res) {
    const { student_id, absence_date, reason } = req.body;
    const attachment_url = req.file?.path || null;
    
    try {
        await pool.query(`
            INSERT INTO absence_requests (student_id, parent_id, absence_date, reason, attachment_url, status)
            VALUES ($1, $2, $3, $4, $5, 'pending')
        `, [student_id, req.user.id, absence_date, reason, attachment_url]);
        
        res.json({ message: 'Absence request submitted' });
    } catch (error) {
        console.error('Error submitting absence request:', error);
        res.status(500).json({ error: 'Error submitting request' });
    }
}

// Download report card
async function downloadReportCard(req, res) {
    const { student_id, term_id } = req.params;
    
    try {
        // Generate PDF report card
        // This would integrate with a PDF generation library
        // For now, return a success message
        res.json({ message: 'Report card generation started' });
    } catch (error) {
        console.error('Error generating report card:', error);
        res.status(500).json({ error: 'Error generating report card' });
    }
}

module.exports = {
    getChildren,
    getChildDashboard,
    payFees,
    sendMessage,
    requestAbsence,
    downloadReportCard
};