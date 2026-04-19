const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

// Get all users with role-based filtering
async function getUsers(req, res) {
    try {
        let query = `
            SELECT u.id, u.username, u.email, u.phone, u.first_name, u.last_name,
                   u.role, u.is_active, u.last_login, u.created_at,
                   u.department, u.role_description,
                   COALESCE(s.admission_number, '') as admission_number,
                   COALESCE(c.name, '') as class_name,
                   COALESCE(sd.position, '') as position
            FROM users u
            LEFT JOIN students s ON u.id = s.user_id
            LEFT JOIN classes c ON s.class_id = c.id
            LEFT JOIN staff_details sd ON u.id = sd.user_id
        `;
        
        const params = [];
        
        // Role-based filtering
        if (req.user.role === 'school_admin') {
            query += ' WHERE u.school_id = $1';
            params.push(req.user.school_id);
        } else if (req.user.role === 'teacher') {
            query += ' WHERE u.school_id = $1 AND u.role IN ($2, $3, $4)';
            params.push(req.user.school_id, 'student', 'parent', 'teacher');
        } else if (req.user.role === 'parent') {
            // Parents can only see their children
            query += `
                WHERE u.id IN (
                    SELECT student_id FROM student_parents WHERE parent_id = $1
                )
            `;
            params.push(req.user.id);
        } else if (req.user.role === 'student') {
            query += ' WHERE u.id = $1';
            params.push(req.user.id);
        }
        
        query += ' ORDER BY u.created_at DESC';
        
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching users' });
    }
}

// Get single user by ID with full details
async function getUserById(req, res) {
    const { id } = req.params;
    
    try {
        const result = await pool.query(`
            SELECT u.*, 
                   s.admission_number, s.class_id, s.stream, s.medical_conditions,
                   c.name as class_name,
                   sd.staff_id, sd.position, sd.department, sd.qualification,
                   json_agg(DISTINCT jsonb_build_object('id', p.id, 'name', p.first_name, 'relationship', sp.relationship)) 
                   FILTER (WHERE p.id IS NOT NULL) as parents,
                   json_agg(DISTINCT jsonb_build_object('id', ch.id, 'name', ch.first_name, 'admission', ch.admission_number)) 
                   FILTER (WHERE ch.id IS NOT NULL) as children
            FROM users u
            LEFT JOIN students s ON u.id = s.user_id
            LEFT JOIN classes c ON s.class_id = c.id
            LEFT JOIN staff_details sd ON u.id = sd.user_id
            LEFT JOIN student_parents sp ON s.id = sp.student_id
            LEFT JOIN users p ON sp.parent_id = p.id
            LEFT JOIN student_parents sp2 ON u.id = sp2.parent_id
            LEFT JOIN students s2 ON sp2.student_id = s2.id
            LEFT JOIN users ch ON s2.user_id = ch.id
            WHERE u.id = $1
            GROUP BY u.id, s.id, c.id, sd.id
        `, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching user' });
    }
}

// Create new user (Admin only)
async function createUser(req, res) {
    const {
        email, username, firstName, lastName, phone,
        role, department, position, classId, admissionNumber,
        parentIds, relationship, password
    } = req.body;
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Check if user exists
        const existingUser = await client.query(
            'SELECT id FROM users WHERE email = $1 OR username = $2',
            [email, username]
        );
        
        if (existingUser.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Email or username already exists' });
        }
        
        // Generate temporary password if not provided
        const tempPassword = password || Math.random().toString(36).slice(-8);
        const hashedPassword = await bcrypt.hash(tempPassword, 10);
        
        // Create user
        const userResult = await client.query(
            `INSERT INTO users (school_id, username, email, phone, first_name, last_name,
             password_hash, role, department, created_by, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
             RETURNING id, username, email, role`,
            [req.user.school_id, username, email, phone, firstName, lastName,
             hashedPassword, role, department, req.user.id]
        );
        
        const newUser = userResult.rows[0];
        
        // Handle role-specific data
        if (role === 'student') {
            await client.query(
                `INSERT INTO students (user_id, admission_number, class_id, admission_date)
                 VALUES ($1, $2, $3, CURRENT_DATE)`,
                [newUser.id, admissionNumber || generateAdmissionNumber(), classId]
            );
        } else if (role === 'parent' && parentIds) {
            for (const studentId of parentIds) {
                await client.query(
                    `INSERT INTO student_parents (student_id, parent_id, relationship)
                     VALUES ($1, $2, $3)`,
                    [studentId, newUser.id, relationship || 'parent']
                );
            }
        } else {
            // Staff details
            await client.query(
                `INSERT INTO staff_details (user_id, position, department, start_date)
                 VALUES ($1, $2, $3, CURRENT_DATE)`,
                [newUser.id, position, department]
            );
        }
        
        // Create user preferences
        await client.query(
            `INSERT INTO user_preferences (user_id, notification_settings, dashboard_layout)
             VALUES ($1, $2, $3)`,
            [newUser.id, '{}', '{}']
        );
        
        await client.query('COMMIT');
        
        res.status(201).json({
            message: 'User created successfully',
            user: newUser,
            temporaryPassword: tempPassword
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(error);
        res.status(500).json({ error: 'Error creating user' });
    } finally {
        client.release();
    }
}

// Update user
async function updateUser(req, res) {
    const { id } = req.params;
    const updates = req.body;
    
    try {
        const allowedUpdates = ['first_name', 'last_name', 'phone', 'email', 'department', 'position', 'is_active'];
        const updateFields = [];
        const values = [id];
        let paramCount = 2;
        
        for (const [key, value] of Object.entries(updates)) {
            if (allowedUpdates.includes(key)) {
                updateFields.push(`${key} = $${paramCount}`);
                values.push(value);
                paramCount++;
            }
        }
        
        if (updateFields.length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }
        
        updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
        
        const query = `
            UPDATE users 
            SET ${updateFields.join(', ')} 
            WHERE id = $1 AND school_id = $${paramCount}
            RETURNING id, username, email, role, is_active
        `;
        
        values.push(req.user.school_id);
        
        const result = await pool.query(query, values);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({ message: 'User updated successfully', user: result.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error updating user' });
    }
}

// Delete/Deactivate user
async function deactivateUser(req, res) {
    const { id } = req.params;
    
    try {
        const result = await pool.query(
            `UPDATE users 
             SET is_active = false, updated_at = CURRENT_TIMESTAMP 
             WHERE id = $1 AND school_id = $2
             RETURNING id`,
            [id, req.user.school_id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // End all active sessions
        await pool.query(
            `UPDATE user_sessions 
             SET is_active = false, logout_time = CURRENT_TIMESTAMP 
             WHERE user_id = $1 AND is_active = true`,
            [id]
        );
        
        res.json({ message: 'User deactivated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error deactivating user' });
    }
}

// Reset user password
async function resetPassword(req, res) {
    const { id } = req.params;
    
    try {
        const newPassword = Math.random().toString(36).slice(-8);
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        
        await pool.query(
            'UPDATE users SET password_hash = $1 WHERE id = $2 AND school_id = $3',
            [hashedPassword, id, req.user.school_id]
        );
        
        res.json({ 
            message: 'Password reset successfully', 
            newPassword: newPassword 
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error resetting password' });
    }
}

// Get user dashboard data based on role
async function getDashboardData(req, res) {
    const user = req.user;
    
    try {
        let dashboardData = {};
        
        switch (user.role) {
            case 'super_admin':
                dashboardData = await getSuperAdminDashboard(req.db);
                break;
            case 'school_admin':
                dashboardData = await getSchoolAdminDashboard(req.db, user);
                break;
            case 'teacher':
                dashboardData = await getTeacherDashboard(req.db, user);
                break;
            case 'student':
                dashboardData = await getStudentDashboard(req.db, user);
                break;
            case 'parent':
                dashboardData = await getParentDashboard(req.db, user);
                break;
            case 'accountant':
                dashboardData = await getAccountantDashboard(req.db, user);
                break;
            case 'librarian':
                dashboardData = await getLibrarianDashboard(req.db, user);
                break;
            case 'transport_manager':
                dashboardData = await getTransportDashboard(req.db, user);
                break;
            case 'hostel_manager':
                dashboardData = await getHostelDashboard(req.db, user);
                break;
            default:
                dashboardData = await getDefaultDashboard(req.db, user);
        }
        
        res.json(dashboardData);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching dashboard data' });
    }
}

// Role-specific dashboard functions
async function getSchoolAdminDashboard(db, user) {
    const queries = {
        totalStudents: 'SELECT COUNT(*) FROM students s JOIN users u ON s.user_id = u.id WHERE u.school_id = $1',
        totalTeachers: 'SELECT COUNT(*) FROM users WHERE school_id = $1 AND role = $2',
        totalStaff: 'SELECT COUNT(*) FROM users WHERE school_id = $1 AND role IN ($2, $3, $4)',
        feeCollection: 'SELECT COALESCE(SUM(amount), 0) as total FROM fee_payments fp JOIN students s ON fp.student_id = s.id JOIN users u ON s.user_id = u.id WHERE u.school_id = $1 AND fp.status = $2',
        attendanceRate: 'SELECT ROUND(AVG(CASE WHEN status = $1 THEN 1 ELSE 0 END) * 100, 2) as rate FROM attendance a JOIN students s ON a.student_id = s.id JOIN users u ON s.user_id = u.id WHERE u.school_id = $2 AND a.date >= CURRENT_DATE - INTERVAL $3'
    };
    
    const [students, teachers, staff, fees, attendance] = await Promise.all([
        db.query(queries.totalStudents, [user.school_id]),
        db.query(queries.totalTeachers, [user.school_id, 'teacher']),
        db.query(queries.totalStaff, [user.school_id, 'non_teaching_staff', 'support_staff', 'accountant']),
        db.query(queries.feeCollection, [user.school_id, 'completed']),
        db.query(queries.attendanceRate, ['present', user.school_id, '30 days'])
    ]);
    
    return {
        stats: {
            totalStudents: parseInt(students.rows[0].count) || 0,
            totalTeachers: parseInt(teachers.rows[0].count) || 0,
            totalStaff: parseInt(staff.rows[0].count) || 0,
            totalFeesCollected: parseFloat(fees.rows[0].total) || 0,
            attendanceRate: parseFloat(attendance.rows[0].rate) || 0
        },
        recentActivities: await getRecentActivities(db, user.school_id),
        pendingApprovals: await getPendingApprovals(db, user.school_id)
    };
}

async function getTeacherDashboard(db, user) {
    const classes = await db.query(`
        SELECT c.id, c.name, cs.subject_id, sub.name as subject_name
        FROM class_subjects cs
        JOIN classes c ON cs.class_id = c.id
        JOIN subjects sub ON cs.subject_id = sub.id
        WHERE cs.teacher_id = $1
    `, [user.id]);
    
    const todaySchedule = await db.query(`
        SELECT te.*, c.name as class_name, sub.name as subject_name
        FROM timetable_entries te
        JOIN classes c ON te.class_id = c.id
        JOIN subjects sub ON te.subject_id = sub.id
        WHERE te.teacher_id = $1 AND te.day_of_week = EXTRACT(DOW FROM CURRENT_DATE)
        ORDER BY te.start_time
    `, [user.id]);
    
    return {
        myClasses: classes.rows,
        todaySchedule: todaySchedule.rows,
        pendingTasks: {
            assignmentsToGrade: await getPendingGrading(db, user.id),
            attendanceToMark: await getPendingAttendance(db, user.id)
        }
    };
}

async function getStudentDashboard(db, user) {
    const student = await db.query(`
        SELECT s.*, c.name as class_name 
        FROM students s
        JOIN classes c ON s.class_id = c.id
        WHERE s.user_id = $1
    `, [user.id]);
    
    const performance = await db.query(`
        SELECT sub.name as subject, AVG(r.score) as average, MAX(r.score) as highest
        FROM results r
        JOIN exams e ON r.exam_id = e.id
        JOIN subjects sub ON e.subject_id = sub.id
        WHERE r.student_id = $1
        GROUP BY sub.id, sub.name
    `, [student.rows[0]?.id]);
    
    const attendance = await db.query(`
        SELECT 
            COUNT(CASE WHEN status = 'present' THEN 1 END) as present,
            COUNT(CASE WHEN status = 'absent' THEN 1 END) as absent,
            COUNT(CASE WHEN status = 'late' THEN 1 END) as late
        FROM attendance
        WHERE student_id = $1 AND date >= DATE_TRUNC('month', CURRENT_DATE)
    `, [student.rows[0]?.id]);
    
    const feeBalance = await db.query(`
        SELECT 
            COALESCE(SUM(fs.amount), 0) as expected,
            COALESCE(SUM(fp.amount), 0) as paid
        FROM fee_structures fs
        LEFT JOIN fee_payments fp ON fs.id = ANY(fp.transaction_id)
        WHERE fs.class_id = $1
    `, [student.rows[0]?.class_id]);
    
    return {
        studentInfo: student.rows[0],
        performance: performance.rows,
        attendance: attendance.rows[0],
        feeBalance: {
            balance: (feeBalance.rows[0]?.expected || 0) - (feeBalance.rows[0]?.paid || 0),
            expected: feeBalance.rows[0]?.expected || 0,
            paid: feeBalance.rows[0]?.paid || 0
        },
        timetable: await getStudentTimetable(db, student.rows[0]?.class_id),
        upcomingAssignments: await getUpcomingAssignments(db, student.rows[0]?.id)
    };
}

async function getParentDashboard(db, user) {
    const children = await db.query(`
        SELECT s.*, u.first_name, u.last_name, u.email, c.name as class_name
        FROM student_parents sp
        JOIN students s ON sp.student_id = s.id
        JOIN users u ON s.user_id = u.id
        JOIN classes c ON s.class_id = c.id
        WHERE sp.parent_id = $1
    `, [user.id]);
    
    const childrenData = [];
    for (const child of children.rows) {
        const feeBalance = await db.query(`
            SELECT 
                COALESCE(SUM(fs.amount), 0) as expected,
                COALESCE(SUM(fp.amount), 0) as paid
            FROM fee_structures fs
            LEFT JOIN fee_payments fp ON fs.id = ANY(fp.transaction_id)
            WHERE fs.class_id = $1
        `, [child.class_id]);
        
        childrenData.push({
            ...child,
            feeBalance: {
                balance: (feeBalance.rows[0]?.expected || 0) - (feeBalance.rows[0]?.paid || 0),
                expected: feeBalance.rows[0]?.expected || 0,
                paid: feeBalance.rows[0]?.paid || 0
            }
        });
    }
    
    return {
        children: childrenData,
        announcements: await getSchoolAnnouncements(db, user.school_id),
        upcomingEvents: await getUpcomingEvents(db, user.school_id)
    };
}

// Helper functions
function generateAdmissionNumber() {
    return `STU${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

async function getRecentActivities(db, schoolId) {
    const result = await db.query(`
        SELECT action, created_at, ip_address
        FROM activity_logs al
        JOIN users u ON al.user_id = u.id
        WHERE u.school_id = $1
        ORDER BY created_at DESC
        LIMIT 10
    `, [schoolId]);
    return result.rows;
}

async function getPendingApprovals(db, schoolId) {
    const result = await db.query(`
        SELECT 'leave_request' as type, COUNT(*) as count
        FROM leave_requests lr
        JOIN users u ON lr.user_id = u.id
        WHERE u.school_id = $1 AND lr.status = 'pending'
        UNION ALL
        SELECT 'new_registration' as type, COUNT(*) as count
        FROM students s
        JOIN users u ON s.user_id = u.id
        WHERE u.school_id = $1 AND s.enrollment_status = 'pending'
    `, [schoolId]);
    return result.rows;
}

async function getPendingGrading(db, teacherId) {
    const result = await db.query(`
        SELECT COUNT(*) as count
        FROM assignments a
        WHERE a.teacher_id = $1 AND a.due_date < CURRENT_DATE
        AND NOT EXISTS (
            SELECT 1 FROM assignment_submissions 
            WHERE assignment_id = a.id AND graded = true
        )
    `, [teacherId]);
    return result.rows[0]?.count || 0;
}

async function getPendingAttendance(db, teacherId) {
    const result = await db.query(`
        SELECT COUNT(*) as count
        FROM timetable_entries te
        WHERE te.teacher_id = $1 
        AND te.day_of_week = EXTRACT(DOW FROM CURRENT_DATE)
        AND te.start_time < CURRENT_TIME
        AND NOT EXISTS (
            SELECT 1 FROM attendance a 
            WHERE a.class_id = te.class_id 
            AND a.date = CURRENT_DATE
        )
    `, [teacherId]);
    return result.rows[0]?.count || 0;
}

async function getStudentTimetable(db, classId) {
    const result = await db.query(`
        SELECT te.*, sub.name as subject_name, u.first_name as teacher_name
        FROM timetable_entries te
        JOIN subjects sub ON te.subject_id = sub.id
        JOIN users u ON te.teacher_id = u.id
        WHERE te.class_id = $1
        ORDER BY te.day_of_week, te.start_time
    `, [classId]);
    return result.rows;
}

async function getUpcomingAssignments(db, studentId) {
    const result = await db.query(`
        SELECT a.*, sub.name as subject_name
        FROM assignments a
        JOIN subjects sub ON a.subject_id = sub.id
        WHERE a.class_id IN (
            SELECT class_id FROM students WHERE id = $1
        )
        AND a.due_date > CURRENT_DATE
        ORDER BY a.due_date ASC
        LIMIT 5
    `, [studentId]);
    return result.rows;
}

async function getSchoolAnnouncements(db, schoolId) {
    const result = await db.query(`
        SELECT title, message, created_at
        FROM notifications
        WHERE school_id = $1 AND type = 'announcement'
        ORDER BY created_at DESC
        LIMIT 5
    `, [schoolId]);
    return result.rows;
}

async function getUpcomingEvents(db, schoolId) {
    const result = await db.query(`
        SELECT title, description, event_date
        FROM calendar_events
        WHERE school_id = $1 AND event_date >= CURRENT_DATE
        ORDER BY event_date ASC
        LIMIT 5
    `, [schoolId]);
    return result.rows;
}

module.exports = {
    getUsers,
    getUserById,
    createUser,
    updateUser,
    deactivateUser,
    resetPassword,
    getDashboardData
};