const express = require('express');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const router = express.Router();

// Get all subjects
router.get('/', authenticateToken, async (req, res) => {
    try {
        const result = await req.db.query(`
            SELECT * FROM subjects WHERE is_active = true ORDER BY name
        `);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create subject
router.post('/', authenticateToken, authorizeRole('school_admin'), async (req, res) => {
    const { name, code, description } = req.body;
    try {
        const result = await req.db.query(`
            INSERT INTO subjects (name, code, description, is_active)
            VALUES ($1, $2, $3, true) RETURNING *
        `, [name, code, description]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;