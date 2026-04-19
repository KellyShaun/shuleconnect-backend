const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

// ==================== GET ALL DATA ====================

// Get all classes
async function getClasses(req, res) {
    try {
        const result = await pool.query(`
            SELECT id, name, class_level FROM classes 
            WHERE school_id = $1 AND is_active = true
            ORDER BY class_level, name
        `, [req.user.school_id]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching classes:', error);
        res.status(500).json({ error: 'Error fetching classes' });
    }
}

// Get all subjects
async function getSubjects(req, res) {
    try {
        const result = await pool.query(`
            SELECT id, name, code FROM subjects 
            WHERE school_id = $1 AND is_active = true
            ORDER BY name
        `, [req.user.school_id]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching subjects:', error);
        res.status(500).json({ error: 'Error fetching subjects' });
    }
}

// Get all teachers
async function getTeachers(req, res) {
    try {
        const result = await pool.query(`
            SELECT id, first_name, last_name, email FROM users 
            WHERE school_id = $1 AND role = 'teacher' AND is_active = true
            ORDER BY first_name, last_name
        `, [req.user.school_id]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching teachers:', error);
        res.status(500).json({ error: 'Error fetching teachers' });
    }
}

// Get all rooms
async function getRooms(req, res) {
    try {
        const result = await pool.query(`
            SELECT id, room_name, room_code, room_type, capacity, building, floor 
            FROM rooms 
            WHERE school_id = $1 AND is_active = true
            ORDER BY building, floor, room_name
        `, [req.user.school_id]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching rooms:', error);
        res.status(500).json({ error: 'Error fetching rooms' });
    }
}

// Get periods
async function getPeriods(req, res) {
    try {
        const result = await pool.query(`
            SELECT id, period_number, start_time, end_time, is_break, break_name 
            FROM periods 
            WHERE school_id = $1
            ORDER BY period_number
        `, [req.user.school_id]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching periods:', error);
        res.status(500).json({ error: 'Error fetching periods' });
    }
}

// Get terms
async function getTerms(req, res) {
    try {
        const result = await pool.query(`
            SELECT id, term_name, academic_year, is_current 
            FROM academic_terms 
            WHERE school_id = $1
            ORDER BY academic_year DESC, id DESC
        `, [req.user.school_id]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching terms:', error);
        res.status(500).json({ error: 'Error fetching terms' });
    }
}

// ==================== TIMETABLE CRUD ====================

// Get timetable for a class
async function getClassTimetable(req, res) {
    const { class_id, term_id } = req.query;
    
    if (!class_id || !term_id) {
        return res.status(400).json({ error: 'Class ID and Term ID are required' });
    }
    
    try {
        const result = await pool.query(`
            SELECT 
                te.id,
                te.class_id,
                te.subject_id,
                s.name as subject_name,
                te.teacher_id,
                u.first_name as teacher_first,
                u.last_name as teacher_last,
                te.room_id,
                r.room_name,
                te.period_id,
                p.period_number,
                p.start_time,
                p.end_time,
                te.day_of_week,
                te.is_double_period,
                te.notes
            FROM timetable_entries te
            JOIN subjects s ON te.subject_id = s.id
            JOIN users u ON te.teacher_id = u.id
            LEFT JOIN rooms r ON te.room_id = r.id
            JOIN periods p ON te.period_id = p.id
            WHERE te.class_id = $1 
                AND te.term_id = $2
                AND te.school_id = $3
            ORDER BY te.day_of_week, p.period_number
        `, [class_id, term_id, req.user.school_id]);
        
        // Organize by day and period
        const timetable = {};
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
        
        days.forEach(day => {
            timetable[day] = {};
        });
        
        result.rows.forEach(entry => {
            const dayName = getDayName(entry.day_of_week);
            if (timetable[dayName]) {
                timetable[dayName][entry.period_id] = entry;
            }
        });
        
        res.json(timetable);
    } catch (error) {
        console.error('Error fetching timetable:', error);
        res.status(500).json({ error: 'Error fetching timetable' });
    }
}

// Get teacher timetable
async function getTeacherTimetable(req, res) {
    const { teacher_id, term_id } = req.query;
    
    try {
        const result = await pool.query(`
            SELECT 
                te.id,
                c.name as class_name,
                s.name as subject_name,
                r.room_name,
                p.period_number,
                p.start_time,
                p.end_time,
                te.day_of_week
            FROM timetable_entries te
            JOIN classes c ON te.class_id = c.id
            JOIN subjects s ON te.subject_id = s.id
            LEFT JOIN rooms r ON te.room_id = r.id
            JOIN periods p ON te.period_id = p.id
            WHERE te.teacher_id = $1 
                AND te.term_id = $2
                AND te.school_id = $3
            ORDER BY te.day_of_week, p.period_number
        `, [teacher_id, term_id, req.user.school_id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching teacher timetable:', error);
        res.status(500).json({ error: 'Error fetching teacher timetable' });
    }
}

// Create timetable entry
async function createTimetableEntry(req, res) {
    const {
        class_id, subject_id, teacher_id, room_id, period_id,
        day_of_week, term_id, is_double_period, notes
    } = req.body;
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Check for teacher conflict
        const teacherConflict = await client.query(`
            SELECT id, class_id FROM timetable_entries
            WHERE teacher_id = $1 
                AND day_of_week = $2 
                AND period_id = $3
                AND term_id = $4
                AND school_id = $5
        `, [teacher_id, day_of_week, period_id, term_id, req.user.school_id]);
        
        if (teacherConflict.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ 
                error: 'Teacher already has a class at this time',
                conflict: teacherConflict.rows[0]
            });
        }
        
        // Check for room conflict
        if (room_id) {
            const roomConflict = await client.query(`
                SELECT id, class_id FROM timetable_entries
                WHERE room_id = $1 
                    AND day_of_week = $2 
                    AND period_id = $3
                    AND term_id = $4
                    AND school_id = $5
            `, [room_id, day_of_week, period_id, term_id, req.user.school_id]);
            
            if (roomConflict.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(409).json({ 
                    error: 'Room is already booked at this time',
                    conflict: roomConflict.rows[0]
                });
            }
        }
        
        // Create entry
        const result = await client.query(`
            INSERT INTO timetable_entries (
                school_id, class_id, subject_id, teacher_id, room_id, period_id,
                day_of_week, term_id, is_double_period, notes, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id
        `, [req.user.school_id, class_id, subject_id, teacher_id, room_id, period_id,
            day_of_week, term_id, is_double_period || false, notes, req.user.id]);
        
        await client.query('COMMIT');
        res.status(201).json({ 
            message: 'Timetable entry created successfully',
            id: result.rows[0].id
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error creating timetable entry:', error);
        res.status(500).json({ error: 'Error creating timetable entry' });
    } finally {
        client.release();
    }
}

// Update timetable entry
async function updateTimetableEntry(req, res) {
    const { id } = req.params;
    const { subject_id, teacher_id, room_id, period_id, day_of_week, is_double_period, notes } = req.body;
    
    try {
        const result = await pool.query(`
            UPDATE timetable_entries 
            SET subject_id = $1, teacher_id = $2, room_id = $3, 
                period_id = $4, day_of_week = $5, is_double_period = $6,
                notes = $7, updated_at = CURRENT_TIMESTAMP
            WHERE id = $8 AND school_id = $9
            RETURNING id
        `, [subject_id, teacher_id, room_id, period_id, day_of_week, 
            is_double_period, notes, id, req.user.school_id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Entry not found' });
        }
        
        res.json({ message: 'Timetable entry updated successfully' });
    } catch (error) {
        console.error('Error updating timetable entry:', error);
        res.status(500).json({ error: 'Error updating timetable entry' });
    }
}

// Delete timetable entry
async function deleteTimetableEntry(req, res) {
    const { id } = req.params;
    
    try {
        const result = await pool.query(`
            DELETE FROM timetable_entries 
            WHERE id = $1 AND school_id = $2
            RETURNING id
        `, [id, req.user.school_id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Entry not found' });
        }
        
        res.json({ message: 'Timetable entry deleted successfully' });
    } catch (error) {
        console.error('Error deleting timetable entry:', error);
        res.status(500).json({ error: 'Error deleting timetable entry' });
    }
}

// Helper function
function getDayName(dayNumber) {
    const days = {
        1: 'Monday',
        2: 'Tuesday',
        3: 'Wednesday',
        4: 'Thursday',
        5: 'Friday'
    };
    return days[dayNumber] || 'Monday';
}

module.exports = {
    getClasses,
    getSubjects,
    getTeachers,
    getRooms,
    getPeriods,
    getTerms,
    getClassTimetable,
    getTeacherTimetable,
    createTimetableEntry,
    updateTimetableEntry,
    deleteTimetableEntry
};