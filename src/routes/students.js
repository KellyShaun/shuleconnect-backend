const express = require('express');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const router = express.Router();

// GET /api/students - Get all students (accessible by school_admin and teachers)
router.get('/', authenticateToken, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;
        const { status, search, class_id } = req.query;

        let query = `
            SELECT s.*, u.first_name, u.last_name, u.email, u.phone, u.gender,
                   u.date_of_birth, u.address,
                   c.name as class_name, c.class_level,
                   COALESCE(s.ai_risk_score, 0) as risk_score
            FROM students s
            JOIN users u ON s.user_id = u.id
            LEFT JOIN classes c ON s.class_id = c.id
            WHERE u.school_id = $1
        `;
        
        const params = [req.user.school_id];
        let paramCount = 2;

        if (class_id) {
            query += ` AND s.class_id = $${paramCount}`;
            params.push(class_id);
            paramCount++;
        }

        if (status && status !== 'all') {
            query += ` AND s.enrollment_status = $${paramCount}`;
            params.push(status);
            paramCount++;
        }

        if (search) {
            query += ` AND (u.first_name ILIKE $${paramCount} OR u.last_name ILIKE $${paramCount} OR s.admission_number ILIKE $${paramCount})`;
            params.push(`%${search}%`);
            paramCount++;
        }

        // Get total count
        const countQuery = `
            SELECT COUNT(*) as total
            FROM students s
            JOIN users u ON s.user_id = u.id
            WHERE u.school_id = $1
            ${class_id ? 'AND s.class_id = $2' : ''}
            ${status && status !== 'all' ? `AND s.enrollment_status = $${class_id ? 3 : 2}` : ''}
        `;
        
        let countParams = [req.user.school_id];
        if (class_id) countParams.push(class_id);
        if (status && status !== 'all') countParams.push(status);
        
        const countResult = await req.db.query(countQuery, countParams);
        const total = parseInt(countResult.rows[0].total);

        // Add pagination
        query += ` ORDER BY s.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(limit, offset);
        
        const result = await req.db.query(query, params);

        res.json({
            students: result.rows,
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching students:', error);
        res.status(500).json({ error: 'Error fetching students: ' + error.message });
    }
});

// GET /api/students/stats - Get student statistics (accessible by school_admin)
router.get('/stats', authenticateToken, async (req, res) => {
    try {
        const result = await req.db.query(`
            SELECT 
                COUNT(*) as total_students,
                COUNT(CASE WHEN s.enrollment_status = 'active' THEN 1 END) as active_students,
                COUNT(CASE WHEN u.gender = 'Male' THEN 1 END) as male_students,
                COUNT(CASE WHEN u.gender = 'Female' THEN 1 END) as female_students,
                COUNT(CASE WHEN s.student_type = 'boarding' THEN 1 END) as boarding_students,
                COUNT(CASE WHEN s.student_type = 'day_scholar' THEN 1 END) as day_scholars,
                COUNT(CASE WHEN s.ai_risk_score > 50 THEN 1 END) as at_risk_students
            FROM students s
            JOIN users u ON s.user_id = u.id
            WHERE u.school_id = $1
        `, [req.user.school_id]);
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Error fetching statistics' });
    }
});

// GET /api/students/my-children - Get parent's children
router.get('/my-children', authenticateToken, async (req, res) => {
    try {
        // Only parents can access this
        if (req.user.role !== 'parent') {
            return res.status(403).json({ error: 'Access denied. Parent role required.' });
        }
        
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
        console.error('Error fetching children:', error);
        res.status(500).json({ error: 'Error fetching children' });
    }
});

// GET /api/students/:id - Get single student
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const result = await req.db.query(`
            SELECT s.*, u.first_name, u.last_name, u.email, u.phone, u.gender,
                   u.date_of_birth, u.address,
                   c.name as class_name,
                   COALESCE(
                       (SELECT json_agg(jsonb_build_object(
                           'id', p.id,
                           'first_name', p.first_name,
                           'last_name', p.last_name,
                           'email', p.email,
                           'phone', p.phone,
                           'relationship', sp.relationship,
                           'is_primary', sp.is_primary
                       )) FROM student_parents sp JOIN users p ON sp.parent_id = p.id WHERE sp.student_id = s.id),
                       '[]'
                   ) as parents
            FROM students s
            JOIN users u ON s.user_id = u.id
            LEFT JOIN classes c ON s.class_id = c.id
            WHERE s.id = $1 AND u.school_id = $2
        `, [req.params.id, req.user.school_id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Student not found' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error fetching student:', error);
        res.status(500).json({ error: 'Error fetching student' });
    }
});

// POST /api/students - Create new student (Admin only)
router.post('/', authenticateToken, authorizeRole('school_admin'), async (req, res) => {
    const client = await req.db.connect();
    
    try {
        await client.query('BEGIN');
        
        const {
            first_name, last_name, email, phone, date_of_birth, gender,  // REMOVED middle_name and national_id
            address, class_id, stream, admission_date,
            medical_conditions, allergies, emergency_contact, emergency_phone,
            previous_school, parents_data
        } = req.body;
        
        // Generate admission number
        const year = new Date().getFullYear();
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        const admissionNumber = `${year}${random}`;
        
        // Generate username
        const username = `${first_name.toLowerCase()}.${last_name.toLowerCase()}${Math.floor(Math.random() * 1000)}`;
        const tempPassword = Math.random().toString(36).slice(-8);
        const bcrypt = require('bcryptjs');
        const hashedPassword = await bcrypt.hash(tempPassword, 10);
        
        // Create user - REMOVED middle_name and national_id
        const userResult = await client.query(`
            INSERT INTO users (school_id, username, email, phone, first_name, last_name,
             date_of_birth, gender, address, password_hash, role, is_active)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)
            RETURNING id
        `, [req.user.school_id, username, email, phone, first_name, last_name,
            date_of_birth, gender, address, hashedPassword, 'student']);
        
        const userId = userResult.rows[0].id;
        
        // Create student
        const studentResult = await client.query(`
            INSERT INTO students (user_id, admission_number, class_id, stream, admission_date,
             medical_conditions, allergies, emergency_contact, emergency_phone,
             previous_school, enrollment_status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active')
            RETURNING id
        `, [userId, admissionNumber, class_id, stream, admission_date || new Date(),
            medical_conditions, allergies, emergency_contact, emergency_phone,
            previous_school]);
        
        const studentId = studentResult.rows[0].id;
        
        // Add parents if provided
        if (parents_data && parents_data.length > 0) {
            for (const parent of parents_data) {
                let parentId = parent.id;
                
                if (!parentId) {
                    const parentUsername = parent.email ? parent.email.split('@')[0] : `parent_${Date.now()}`;
                    const parentPassword = Math.random().toString(36).slice(-8);
                    const parentHashedPassword = await bcrypt.hash(parentPassword, 10);
                    
                    const parentResult = await client.query(`
                        INSERT INTO users (school_id, username, email, phone, first_name, last_name,
                         password_hash, role, is_active)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
                        RETURNING id
                    `, [req.user.school_id, parentUsername, parent.email, parent.phone,
                        parent.first_name, parent.last_name, parentHashedPassword, 'parent']);
                    parentId = parentResult.rows[0].id;
                }
                
                await client.query(`
                    INSERT INTO student_parents (student_id, parent_id, relationship, is_primary)
                    VALUES ($1, $2, $3, $4)
                `, [studentId, parentId, parent.relationship, parent.is_primary || false]);
            }
        }
        
        await client.query('COMMIT');
        
        res.status(201).json({
            message: 'Student created successfully',
            student: {
                id: studentId,
                admission_number: admissionNumber,
                username: username,
                temporary_password: tempPassword
            }
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error creating student:', error);
        res.status(500).json({ error: 'Error creating student: ' + error.message });
    } finally {
        client.release();
    }
});

// PUT /api/students/:id - Update student (Admin only)
router.put('/:id', authenticateToken, authorizeRole('school_admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        // Update user info - REMOVED middle_name and national_id
        const userFields = ['first_name', 'last_name', 'email', 'phone', 'address'];
        for (const field of userFields) {
            if (updates[field] !== undefined) {
                await req.db.query(`
                    UPDATE users SET ${field} = $1 
                    WHERE id = (SELECT user_id FROM students WHERE id = $2)
                `, [updates[field], id]);
            }
        }
        
        // Update student info
        const studentFields = ['class_id', 'stream', 'medical_conditions', 'allergies', 'emergency_contact', 'emergency_phone'];
        for (const field of studentFields) {
            if (updates[field] !== undefined) {
                await req.db.query(`
                    UPDATE students SET ${field} = $1 WHERE id = $2
                `, [updates[field], id]);
            }
        }
        
        res.json({ message: 'Student updated successfully' });
    } catch (error) {
        console.error('Error updating student:', error);
        res.status(500).json({ error: 'Error updating student' });
    }
});

// DELETE /api/students/:id - Deactivate student (Admin only)
router.delete('/:id', authenticateToken, authorizeRole('school_admin'), async (req, res) => {
    try {
        await req.db.query(`
            UPDATE students SET enrollment_status = 'inactive' WHERE id = $1
        `, [req.params.id]);
        res.json({ message: 'Student deactivated successfully' });
    } catch (error) {
        console.error('Error deactivating student:', error);
        res.status(500).json({ error: 'Error deactivating student' });
    }
});

module.exports = router;