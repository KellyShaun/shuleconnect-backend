const { Pool } = require('pg');
const moment = require('moment');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

// ==================== DORMITORIES & ROOMS ====================

// Get all dormitories
async function getDormitories(req, res) {
    try {
        const result = await pool.query(`
            SELECT d.*, 
                   COUNT(DISTINCT r.id) as room_count,
                   SUM(r.capacity) as total_beds,
                   SUM(r.current_occupancy) as occupied_beds,
                   u.first_name as house_parent_first,
                   u.last_name as house_parent_last
            FROM hostel_dormitories d
            LEFT JOIN hostel_rooms r ON d.id = r.dormitory_id
            LEFT JOIN users u ON d.house_parent_id = u.id
            WHERE d.school_id = $1 AND d.is_active = true
            GROUP BY d.id, u.first_name, u.last_name
            ORDER BY d.dormitory_name
        `, [req.user.school_id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching dormitories:', error);
        res.status(500).json({ error: 'Error fetching dormitories' });
    }
}

// Create dormitory
async function createDormitory(req, res) {
    const { dormitory_name, building, floor, gender, house_parent_id, total_rooms, total_beds, contact_phone } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO hostel_dormitories (
                school_id, dormitory_name, building, floor, gender, house_parent_id,
                total_rooms, total_beds, available_beds, contact_phone, is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
            RETURNING *
        `, [req.user.school_id, dormitory_name, building, floor, gender, house_parent_id,
            total_rooms, total_beds, total_beds, contact_phone]);
        
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creating dormitory:', error);
        res.status(500).json({ error: 'Error creating dormitory' });
    }
}

// Get rooms by dormitory
async function getRooms(req, res) {
    const { dormitory_id } = req.query;
    
    try {
        let query = `
            SELECT r.*, 
                   d.dormitory_name,
                   COUNT(hba.id) as occupied_beds
            FROM hostel_rooms r
            JOIN hostel_dormitories d ON r.dormitory_id = d.id
            LEFT JOIN hostel_bed_allocations hba ON r.id = hba.room_id AND hba.is_current = true
            WHERE d.school_id = $1
        `;
        const params = [req.user.school_id];
        
        if (dormitory_id) {
            query += ` AND r.dormitory_id = $2`;
            params.push(dormitory_id);
        }
        
        query += ` GROUP BY r.id, d.dormitory_name ORDER BY r.room_number`;
        
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching rooms:', error);
        res.status(500).json({ error: 'Error fetching rooms' });
    }
}

// Create room
async function createRoom(req, res) {
    const { dormitory_id, room_number, room_type, capacity, floor, has_attached_bathroom, notes } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO hostel_rooms (
                dormitory_id, room_number, room_type, capacity, current_occupancy,
                floor, has_attached_bathroom, notes, is_active
            ) VALUES ($1, $2, $3, $4, 0, $5, $6, $7, true)
            RETURNING *
        `, [dormitory_id, room_number, room_type, capacity, floor, has_attached_bathroom, notes]);
        
        // Update dormitory total rooms and beds
        await pool.query(`
            UPDATE hostel_dormitories 
            SET total_rooms = total_rooms + 1, total_beds = total_beds + $1
            WHERE id = $2
        `, [capacity, dormitory_id]);
        
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creating room:', error);
        res.status(500).json({ error: 'Error creating room' });
    }
}

// ==================== BED ALLOCATION ====================

// Get available beds
async function getAvailableBeds(req, res) {
    const { dormitory_id } = req.query;
    
    try {
        const result = await pool.query(`
            SELECT r.id, r.room_number, r.room_type, r.capacity, r.current_occupancy,
                   (r.capacity - r.current_occupancy) as available_beds,
                   d.dormitory_name, d.gender
            FROM hostel_rooms r
            JOIN hostel_dormitories d ON r.dormitory_id = d.id
            WHERE d.school_id = $1 AND r.capacity > r.current_occupancy
            ${dormitory_id ? 'AND r.dormitory_id = $2' : ''}
            ORDER BY d.dormitory_name, r.room_number
        `, dormitory_id ? [req.user.school_id, dormitory_id] : [req.user.school_id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching available beds:', error);
        res.status(500).json({ error: 'Error fetching available beds' });
    }
}

// Allocate bed to student
async function allocateBed(req, res) {
    const { student_id, room_id, bed_number, notes } = req.body;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Check if student already has allocation
        const existing = await client.query(`
            SELECT id FROM hostel_bed_allocations 
            WHERE student_id = $1 AND is_current = true
        `, [student_id]);
        
        if (existing.rows.length > 0) {
            // Deallocate current
            await client.query(`
                UPDATE hostel_bed_allocations 
                SET is_current = false, deallocated_date = CURRENT_DATE
                WHERE student_id = $1 AND is_current = true
            `, [student_id]);
        }
        
        // Create new allocation
        const result = await client.query(`
            INSERT INTO hostel_bed_allocations (
                student_id, room_id, bed_number, allocated_date, is_current, allocated_by, notes
            ) VALUES ($1, $2, $3, CURRENT_DATE, true, $4, $5)
            RETURNING id
        `, [student_id, room_id, bed_number, req.user.id, notes]);
        
        // Update room occupancy
        await client.query(`
            UPDATE hostel_rooms 
            SET current_occupancy = current_occupancy + 1
            WHERE id = $1
        `, [room_id]);
        
        // Update dormitory available beds
        await client.query(`
            UPDATE hostel_dormitories 
            SET available_beds = available_beds - 1
            WHERE id = (SELECT dormitory_id FROM hostel_rooms WHERE id = $1)
        `, [room_id]);
        
        await client.query('COMMIT');
        
        res.status(201).json({ 
            message: 'Bed allocated successfully', 
            allocation_id: result.rows[0].id 
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error allocating bed:', error);
        res.status(500).json({ error: 'Error allocating bed' });
    } finally {
        client.release();
    }
}

// Get student's current allocation
async function getStudentAllocation(req, res) {
    const { student_id } = req.params;
    
    try {
        const result = await pool.query(`
            SELECT hba.*, r.room_number, r.room_type, d.dormitory_name, d.building, d.floor
            FROM hostel_bed_allocations hba
            JOIN hostel_rooms r ON hba.room_id = r.id
            JOIN hostel_dormitories d ON r.dormitory_id = d.id
            WHERE hba.student_id = $1 AND hba.is_current = true
        `, [student_id]);
        
        res.json(result.rows[0] || null);
    } catch (error) {
        console.error('Error fetching student allocation:', error);
        res.status(500).json({ error: 'Error fetching student allocation' });
    }
}

// ==================== CHECK-IN/OUT ====================

// Check-in student
async function checkInStudent(req, res) {
    const { student_id, expected_return_date, notes } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO hostel_student_checkins (
                student_id, check_in_time, expected_return_date, approved_by, status, notes
            ) VALUES ($1, CURRENT_TIMESTAMP, $2, $3, 'checked_in', $4)
            RETURNING id
        `, [student_id, expected_return_date, req.user.id, notes]);
        
        res.status(201).json({ 
            message: 'Student checked in successfully', 
            checkin_id: result.rows[0].id 
        });
    } catch (error) {
        console.error('Error checking in student:', error);
        res.status(500).json({ error: 'Error checking in student' });
    }
}

// Check-out student
async function checkOutStudent(req, res) {
    const { student_id, notes } = req.body;
    
    try {
        const result = await pool.query(`
            UPDATE hostel_student_checkins 
            SET check_out_time = CURRENT_TIMESTAMP, status = 'checked_out', notes = COALESCE(notes || '', $1)
            WHERE student_id = $2 AND status = 'checked_in'
            RETURNING id
        `, [notes, student_id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'No active check-in found for this student' });
        }
        
        res.json({ message: 'Student checked out successfully' });
    } catch (error) {
        console.error('Error checking out student:', error);
        res.status(500).json({ error: 'Error checking out student' });
    }
}

// ==================== MEAL MANAGEMENT ====================

// Get meal menus
async function getMealMenus(req, res) {
    const { start_date, end_date } = req.query;
    
    try {
        let query = `
            SELECT * FROM hostel_meal_menus
            WHERE school_id = $1 AND meal_date BETWEEN $2 AND $3
            ORDER BY meal_date, FIELD(meal_type, 'breakfast', 'lunch', 'dinner')
        `;
        
        const result = await pool.query(query, [req.user.school_id, start_date, end_date]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching meal menus:', error);
        res.status(500).json({ error: 'Error fetching meal menus' });
    }
}

// Create meal menu
async function createMealMenu(req, res) {
    const { meal_date, meal_type, menu, dietary_options, special_notes } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO hostel_meal_menus (
                school_id, meal_date, meal_type, menu, dietary_options, special_notes, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (school_id, meal_date, meal_type) DO UPDATE SET
                menu = EXCLUDED.menu,
                dietary_options = EXCLUDED.dietary_options,
                special_notes = EXCLUDED.special_notes
            RETURNING *
        `, [req.user.school_id, meal_date, meal_type, menu, dietary_options, special_notes, req.user.id]);
        
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creating meal menu:', error);
        res.status(500).json({ error: 'Error creating meal menu' });
    }
}

// Mark meal attendance
async function markMealAttendance(req, res) {
    const { student_id, meal_menu_id, status, notes } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO hostel_meal_attendance (
                student_id, meal_menu_id, meal_date, meal_type, status, marked_by, notes
            ) VALUES (
                $1, $2, 
                (SELECT meal_date FROM hostel_meal_menus WHERE id = $2),
                (SELECT meal_type FROM hostel_meal_menus WHERE id = $2),
                $3, $4, $5
            )
            ON CONFLICT (student_id, meal_menu_id) DO UPDATE SET
                status = EXCLUDED.status,
                notes = EXCLUDED.notes,
                marked_at = CURRENT_TIMESTAMP
            RETURNING id
        `, [student_id, meal_menu_id, status, req.user.id, notes]);
        
        res.status(201).json({ message: 'Meal attendance marked', id: result.rows[0].id });
    } catch (error) {
        console.error('Error marking meal attendance:', error);
        res.status(500).json({ error: 'Error marking meal attendance' });
    }
}

// ==================== VISITOR MANAGEMENT ====================

// Request visitor access
async function requestVisitorAccess(req, res) {
    const { student_id, visitor_name, visitor_phone, visitor_id_number, relationship, purpose } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO hostel_visitor_logs (
                student_id, visitor_name, visitor_phone, visitor_id_number, relationship, purpose, status
            ) VALUES ($1, $2, $3, $4, $5, $6, 'pending')
            RETURNING id
        `, [student_id, visitor_name, visitor_phone, visitor_id_number, relationship, purpose]);
        
        res.status(201).json({ 
            message: 'Visitor request submitted', 
            request_id: result.rows[0].id 
        });
    } catch (error) {
        console.error('Error requesting visitor access:', error);
        res.status(500).json({ error: 'Error requesting visitor access' });
    }
}

// Approve visitor
async function approveVisitor(req, res) {
    const { id, status, notes } = req.body;
    
    try {
        await pool.query(`
            UPDATE hostel_visitor_logs 
            SET status = $1, approved_by = $2, notes = COALESCE(notes || '', $3)
            WHERE id = $4
        `, [status, req.user.id, notes, id]);
        
        res.json({ message: `Visitor request ${status}` });
    } catch (error) {
        console.error('Error approving visitor:', error);
        res.status(500).json({ error: 'Error approving visitor' });
    }
}

// ==================== DISCIPLINE & MEDICAL ====================

// Add discipline record
async function addDisciplineRecord(req, res) {
    const { student_id, incident_type, severity, description, action_taken, witnesses } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO hostel_discipline_logs (
                student_id, incident_type, severity, description, action_taken, witnesses, reported_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id
        `, [student_id, incident_type, severity, description, action_taken, witnesses, req.user.id]);
        
        res.status(201).json({ message: 'Discipline record added', id: result.rows[0].id });
    } catch (error) {
        console.error('Error adding discipline record:', error);
        res.status(500).json({ error: 'Error adding discipline record' });
    }
}

// Add medical log
async function addMedicalLog(req, res) {
    const { student_id, symptoms, diagnosis, temperature, medication_given, referred_to_hospital, hospital_name, parent_notified, notes } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO hostel_medical_logs (
                student_id, symptoms, diagnosis, temperature, medication_given,
                referred_to_hospital, hospital_name, parent_notified, reported_by, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id
        `, [student_id, symptoms, diagnosis, temperature, medication_given,
            referred_to_hospital, hospital_name, parent_notified, req.user.id, notes]);
        
        res.status(201).json({ message: 'Medical log added', id: result.rows[0].id });
    } catch (error) {
        console.error('Error adding medical log:', error);
        res.status(500).json({ error: 'Error adding medical log' });
    }
}

// ==================== DASHBOARD STATS ====================

async function getHostelDashboard(req, res) {
    try {
        // Occupancy rate
        const occupancy = await pool.query(`
            SELECT 
                SUM(total_beds) as total_beds,
                SUM(total_beds - available_beds) as occupied_beds,
                ROUND((SUM(total_beds - available_beds)::decimal / NULLIF(SUM(total_beds), 0)) * 100, 1) as occupancy_rate
            FROM hostel_dormitories
            WHERE school_id = $1 AND is_active = true
        `, [req.user.school_id]);
        
        // Today's meal attendance
        const mealAttendance = await pool.query(`
            SELECT 
                meal_type,
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'present' THEN 1 END) as present
            FROM hostel_meal_attendance hma
            JOIN hostel_meal_menus hmm ON hma.meal_menu_id = hmm.id
            WHERE hmm.meal_date = CURRENT_DATE AND hmm.school_id = $1
            GROUP BY meal_type
        `, [req.user.school_id]);
        
        // Pending visitor approvals
        const pendingVisitors = await pool.query(`
            SELECT COUNT(*) as count
            FROM hostel_visitor_logs
            WHERE status = 'pending'
        `);
        
        // Current checked-in students
        const checkedIn = await pool.query(`
            SELECT COUNT(*) as count
            FROM hostel_student_checkins
            WHERE status = 'checked_in'
        `);
        
        // Today's activities
        const activities = await pool.query(`
            SELECT * FROM hostel_activities
            WHERE activity_date = CURRENT_DATE AND school_id = $1
            ORDER BY start_time
        `, [req.user.school_id]);
        
        res.json({
            occupancy_rate: parseFloat(occupancy.rows[0]?.occupancy_rate || 0),
            total_beds: parseInt(occupancy.rows[0]?.total_beds || 0),
            occupied_beds: parseInt(occupancy.rows[0]?.occupied_beds || 0),
            meal_attendance: mealAttendance.rows,
            pending_visitors: parseInt(pendingVisitors.rows[0]?.count || 0),
            checked_in_students: parseInt(checkedIn.rows[0]?.count || 0),
            today_activities: activities.rows
        });
    } catch (error) {
        console.error('Error fetching hostel dashboard:', error);
        res.status(500).json({ error: 'Error fetching hostel dashboard' });
    }
}

module.exports = {
    // Dormitories & Rooms
    getDormitories,
    createDormitory,
    getRooms,
    createRoom,
    getAvailableBeds,
    allocateBed,
    getStudentAllocation,
    // Check-in/out
    checkInStudent,
    checkOutStudent,
    // Meal Management
    getMealMenus,
    createMealMenu,
    markMealAttendance,
    // Visitor Management
    requestVisitorAccess,
    approveVisitor,
    // Discipline & Medical
    addDisciplineRecord,
    addMedicalLog,
    // Dashboard
    getHostelDashboard
};