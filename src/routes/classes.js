const express = require('express');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const router = express.Router();

// GET /api/classes - Get all classes
router.get('/', authenticateToken, async (req, res) => {
    try {
        const result = await req.db.query(`
            SELECT c.*, 
                   COUNT(s.id) as student_count,
                   COUNT(DISTINCT cs.subject_id) as subject_count
            FROM classes c
            LEFT JOIN students s ON c.id = s.class_id AND s.enrollment_status = 'active'
            LEFT JOIN class_subjects cs ON c.id = cs.class_id
            WHERE c.school_id = $1 AND c.is_active = true
            GROUP BY c.id
            ORDER BY c.class_level, c.name
        `, [req.user.school_id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching classes:', error);
        res.status(500).json({ error: 'Error fetching classes: ' + error.message });
    }
});

// GET /api/classes/:id - Get single class
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const result = await req.db.query(`
            SELECT c.*, 
                   COUNT(s.id) as student_count
            FROM classes c
            LEFT JOIN students s ON c.id = s.class_id AND s.enrollment_status = 'active'
            WHERE c.id = $1 AND c.school_id = $2
            GROUP BY c.id
        `, [req.params.id, req.user.school_id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Class not found' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error fetching class:', error);
        res.status(500).json({ error: 'Error fetching class: ' + error.message });
    }
});

// GET /api/classes/:id/subjects - Get subjects for a specific class (FIXED)
router.get('/:id/subjects', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await req.db.query(`
            SELECT DISTINCT s.id, s.name, s.code
            FROM subjects s
            JOIN class_subjects cs ON s.id = cs.subject_id
            WHERE cs.class_id = $1
            ORDER BY s.name
        `, [id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching subjects for class:', error);
        res.status(500).json({ error: 'Error fetching subjects: ' + error.message });
    }
});

// POST /api/classes - Create new class
router.post('/', authenticateToken, authorizeRole('school_admin'), async (req, res) => {
    const { name, class_level, capacity, stream } = req.body;
    
    try {
        const result = await req.db.query(`
            INSERT INTO classes (school_id, name, class_level, capacity, is_active)
            VALUES ($1, $2, $3, $4, true)
            RETURNING *
        `, [req.user.school_id, name, class_level, capacity]);
        
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creating class:', error);
        res.status(500).json({ error: 'Error creating class: ' + error.message });
    }
});

// PUT /api/classes/:id - Update class
router.put('/:id', authenticateToken, authorizeRole('school_admin'), async (req, res) => {
    const { id } = req.params;
    const { name, class_level, capacity, is_active } = req.body;
    
    try {
        const result = await req.db.query(`
            UPDATE classes 
            SET name = COALESCE($1, name),
                class_level = COALESCE($2, class_level),
                capacity = COALESCE($3, capacity),
                is_active = COALESCE($4, is_active),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $5 AND school_id = $6
            RETURNING *
        `, [name, class_level, capacity, is_active, id, req.user.school_id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Class not found' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating class:', error);
        res.status(500).json({ error: 'Error updating class: ' + error.message });
    }
});

// DELETE /api/classes/:id - Delete class (soft delete)
router.delete('/:id', authenticateToken, authorizeRole('school_admin'), async (req, res) => {
    const { id } = req.params;
    
    try {
        const result = await req.db.query(`
            UPDATE classes SET is_active = false, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND school_id = $2
            RETURNING id
        `, [id, req.user.school_id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Class not found' });
        }
        
        res.json({ message: 'Class deleted successfully' });
    } catch (error) {
        console.error('Error deleting class:', error);
        res.status(500).json({ error: 'Error deleting class: ' + error.message });
    }
});

module.exports = router;