const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

// Get today's attendance for a class
async function getTodayAttendance(req, res) {
    const { class_id, date } = req.query;
    const attendanceDate = date || new Date().toISOString().split('T')[0];
    
    try {
        // Get all students in class
        const students = await pool.query(`
            SELECT s.id, s.admission_number, u.first_name, u.last_name, u.email, u.phone
            FROM students s
            JOIN users u ON s.user_id = u.id
            WHERE s.class_id = $1 AND s.enrollment_status = 'active'
        `, [class_id]);
        
        // Get existing attendance for today
        const attendance = await pool.query(`
            SELECT * FROM attendance 
            WHERE class_id = $1 AND date = $2
        `, [class_id, attendanceDate]);
        
        const attendanceMap = {};
        attendance.rows.forEach(a => {
            attendanceMap[a.student_id] = a;
        });
        
        const result = students.rows.map(student => ({
            id: student.id,
            admission_number: student.admission_number,
            first_name: student.first_name,
            last_name: student.last_name,
            email: student.email,
            phone: student.phone,
            status: attendanceMap[student.id]?.status || null
        }));
        
        const summary = {
            total: result.length,
            present: result.filter(s => s.status === 'present').length,
            absent: result.filter(s => s.status === 'absent').length,
            late: result.filter(s => s.status === 'late').length,
            excused: result.filter(s => s.status === 'excused').length,
            not_marked: result.filter(s => !s.status).length
        };
        
        res.json({
            date: attendanceDate,
            class_id: class_id,
            students: result,
            summary: summary
        });
    } catch (error) {
        console.error('Error fetching attendance:', error);
        res.status(500).json({ error: 'Error fetching attendance: ' + error.message });
    }
}

// Mark attendance
async function markAttendance(req, res) {
    const { class_id, date, attendance_data } = req.body;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        for (const item of attendance_data) {
            const { student_id, status } = item;  // Removed remarks and temperature
            
            // Check if attendance already exists
            const existing = await client.query(`
                SELECT id FROM attendance 
                WHERE student_id = $1 AND date = $2 AND class_id = $3
            `, [student_id, date, class_id]);
            
            if (existing.rows.length > 0) {
                // Update existing - removed remarks and temperature
                await client.query(`
                    UPDATE attendance 
                    SET status = $1, marked_by = $2, updated_at = CURRENT_TIMESTAMP
                    WHERE id = $3
                `, [status, req.user.id, existing.rows[0].id]);
            } else {
                // Insert new - removed remarks and temperature
                await client.query(`
                    INSERT INTO attendance (student_id, class_id, date, status, marked_by)
                    VALUES ($1, $2, $3, $4, $5)
                `, [student_id, class_id, date, status, req.user.id]);
            }
        }
        
        await client.query('COMMIT');
        res.json({ message: 'Attendance saved successfully' });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error marking attendance:', error);
        res.status(500).json({ error: 'Error marking attendance: ' + error.message });
    } finally {
        client.release();
    }
}

// Get teacher's classes
async function getTeacherClasses(req, res) {
    try {
        const result = await pool.query(`
            SELECT DISTINCT c.id, c.name, c.class_level
            FROM classes c
            JOIN class_subjects cs ON c.id = cs.class_id
            WHERE cs.teacher_id = $1 AND c.is_active = true
            ORDER BY c.class_level, c.name
        `, [req.user.id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching teacher classes:', error);
        res.status(500).json({ error: 'Error fetching teacher classes' });
    }
}

// Get attendance report for a class
async function getAttendanceReport(req, res) {
    try {
        const { class_id } = req.params;
        const { month, year } = req.query;
        
        const query = `
            SELECT 
                date,
                COUNT(CASE WHEN status = 'present' THEN 1 END) as present,
                COUNT(CASE WHEN status = 'absent' THEN 1 END) as absent,
                COUNT(CASE WHEN status = 'late' THEN 1 END) as late,
                COUNT(CASE WHEN status = 'excused' THEN 1 END) as excused,
                COUNT(*) as total
            FROM attendance
            WHERE class_id = $1
                AND EXTRACT(MONTH FROM date) = $2
                AND EXTRACT(YEAR FROM date) = $3
            GROUP BY date
            ORDER BY date
        `;
        
        const result = await pool.query(query, [class_id, month || new Date().getMonth() + 1, year || new Date().getFullYear()]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching attendance report:', error);
        res.status(500).json({ error: 'Error fetching attendance report' });
    }
}

// Get student attendance
async function getStudentAttendance(req, res) {
    try {
        const { studentId } = req.params;
        const { start_date, end_date } = req.query;
        
        let query = `
            SELECT a.date, a.status, c.name as class_name
            FROM attendance a
            JOIN classes c ON a.class_id = c.id
            WHERE a.student_id = $1
        `;
        const params = [studentId];
        
        if (start_date && end_date) {
            query += ` AND a.date BETWEEN $2 AND $3`;
            params.push(start_date, end_date);
        }
        
        query += ` ORDER BY a.date DESC LIMIT 30`;
        
        const result = await pool.query(query, params);
        
        const stats = {
            present: result.rows.filter(r => r.status === 'present').length,
            absent: result.rows.filter(r => r.status === 'absent').length,
            late: result.rows.filter(r => r.status === 'late').length,
            excused: result.rows.filter(r => r.status === 'excused').length,
            total: result.rows.length,
            attendance_rate: result.rows.length > 0 
                ? ((result.rows.filter(r => r.status === 'present').length / result.rows.length) * 100).toFixed(1)
                : 0
        };
        
        res.json({
            attendance: result.rows,
            stats
        });
    } catch (error) {
        console.error('Error fetching student attendance:', error);
        res.status(500).json({ error: 'Error fetching student attendance' });
    }
}

module.exports = {
    getTodayAttendance,
    markAttendance,
    getTeacherClasses,
    getAttendanceReport,
    getStudentAttendance
};