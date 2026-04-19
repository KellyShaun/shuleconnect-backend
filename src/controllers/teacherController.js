const { Pool } = require('pg');
const moment = require('moment');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

// Get teacher dashboard data
async function getTeacherDashboard(req, res) {
    try {
        // Get teacher info
        const teacher = await pool.query(`
            SELECT u.first_name, u.last_name, u.email, u.phone
            FROM users u
            WHERE u.id = $1
        `, [req.user.id]);
        
        // Get assigned classes
        const classes = await pool.query(`
            SELECT DISTINCT c.id, c.name, cs.subject_id, s.name as subject_name
            FROM class_subjects cs
            JOIN classes c ON cs.class_id = c.id
            JOIN subjects s ON cs.subject_id = s.id
            WHERE cs.teacher_id = $1 AND c.is_active = true
        `, [req.user.id]);
        
        // Get today's schedule
        const todaySchedule = await pool.query(`
            SELECT te.*, c.name as class_name, s.name as subject_name, r.room_name,
                   p.start_time, p.end_time
            FROM timetable_entries te
            JOIN classes c ON te.class_id = c.id
            JOIN subjects s ON te.subject_id = s.id
            JOIN periods p ON te.period_id = p.id
            LEFT JOIN rooms r ON te.room_id = r.id
            WHERE te.teacher_id = $1 AND te.day_of_week = EXTRACT(DOW FROM CURRENT_DATE)
            ORDER BY p.start_time
        `, [req.user.id]);
        
        // Get total students count
        const totalStudents = await pool.query(`
            SELECT COUNT(DISTINCT s.id) as count
            FROM class_subjects cs
            JOIN students s ON cs.class_id = s.class_id
            WHERE cs.teacher_id = $1 AND s.enrollment_status = 'active'
        `, [req.user.id]);
        
        // Get pending grading count
        const pendingGrading = await pool.query(`
            SELECT COUNT(*) as count
            FROM assignments a
            WHERE a.teacher_id = $1 AND a.due_date < CURRENT_DATE
            AND NOT EXISTS (
                SELECT 1 FROM assignment_submissions 
                WHERE assignment_id = a.id AND graded = true
            )
        `, [req.user.id]);
        
        // Get class performance
        const classPerformance = await pool.query(`
            SELECT 
                c.name as class_name,
                ROUND(AVG(r.score), 1) as average_score,
                ROUND(AVG(CASE WHEN a.status = 'present' THEN 100 ELSE 0 END), 1) as attendance_rate
            FROM class_subjects cs
            JOIN classes c ON cs.class_id = c.id
            LEFT JOIN results r ON cs.subject_id = r.subject_id
            LEFT JOIN attendance a ON cs.class_id = a.class_id
            WHERE cs.teacher_id = $1
            GROUP BY c.id, c.name
        `, [req.user.id]);
        
        // Get recent activities
        const recentActivities = await pool.query(`
            SELECT 
                'Attendance marked' as description,
                CURRENT_DATE as date,
                c.name as class_name,
                'completed' as status
            FROM attendance a
            JOIN classes c ON a.class_id = c.id
            WHERE a.marked_by = $1
            ORDER BY a.created_at DESC
            LIMIT 5
        `, [req.user.id]);
        
        res.json({
            teacher_info: teacher.rows[0],
            assigned_classes: classes.rows,
            today_schedule: todaySchedule.rows,
            total_students: parseInt(totalStudents.rows[0].count),
            pending_tasks: {
                assignments_to_grading: parseInt(pendingGrading.rows[0].count)
            },
            class_performance: classPerformance.rows,
            recent_activities: recentActivities.rows
        });
    } catch (error) {
        console.error('Error fetching teacher dashboard:', error);
        res.status(500).json({ error: 'Error fetching dashboard data' });
    }
}

// Get teacher's classes
async function getTeacherClasses(req, res) {
    try {
        const result = await pool.query(`
            SELECT DISTINCT c.id, c.name, cs.subject_id, s.name as subject_name
            FROM class_subjects cs
            JOIN classes c ON cs.class_id = c.id
            JOIN subjects s ON cs.subject_id = s.id
            WHERE cs.teacher_id = $1 AND c.is_active = true
            ORDER BY c.name
        `, [req.user.id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching teacher classes:', error);
        res.status(500).json({ error: 'Error fetching classes' });
    }
}

// Get students by class
async function getClassStudents(req, res) {
    const { class_id } = req.params;
    
    try {
        const result = await pool.query(`
            SELECT s.id, s.admission_number, u.first_name, u.last_name, u.email
            FROM students s
            JOIN users u ON s.user_id = u.id
            WHERE s.class_id = $1 AND s.enrollment_status = 'active'
            ORDER BY u.last_name, u.first_name
        `, [class_id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching class students:', error);
        res.status(500).json({ error: 'Error fetching students' });
    }
}

// Get class attendance
async function getClassAttendance(req, res) {
    const { class_id } = req.params;
    const { date } = req.query;
    
    try {
        const result = await pool.query(`
            SELECT a.* FROM attendance a
            WHERE a.class_id = $1 AND a.attendance_date = $2
        `, [class_id, date]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching class attendance:', error);
        res.status(500).json({ error: 'Error fetching attendance' });
    }
}

// Post assignment
async function postAssignment(req, res) {
    const { class_id, subject_id, title, description, due_date, max_score } = req.body;
    const attachment_url = req.file?.path || null;
    
    try {
        const result = await pool.query(`
            INSERT INTO assignments (teacher_id, class_id, subject_id, title, description, due_date, max_score, attachment_url)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id
        `, [req.user.id, class_id, subject_id, title, description, due_date, max_score, attachment_url]);
        
        res.status(201).json({ message: 'Assignment posted', id: result.rows[0].id });
    } catch (error) {
        console.error('Error posting assignment:', error);
        res.status(500).json({ error: 'Error posting assignment' });
    }
}

module.exports = {
    getTeacherDashboard,
    getTeacherClasses,
    getClassStudents,
    getClassAttendance,
    postAssignment
};