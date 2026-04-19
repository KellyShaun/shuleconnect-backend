const { Pool } = require('pg');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

// ==================== GRADING SCALES ====================

// Get grading scales
async function getGradingScales(req, res) {
    try {
        const result = await pool.query(`
            SELECT * FROM grading_scales 
            WHERE school_id = $1 AND is_active = true
            ORDER BY min_percentage DESC
        `, [req.user.school_id]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching grading scales:', error);
        res.status(500).json({ error: 'Error fetching grading scales' });
    }
}

// Create/Update grading scale
async function saveGradingScale(req, res) {
    const { grade, min_percentage, max_percentage, points, cbc_level, remark, is_cbc } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO grading_scales (school_id, grade, min_percentage, max_percentage, points, cbc_level, remark, is_cbc)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (id) DO UPDATE SET
                min_percentage = EXCLUDED.min_percentage,
                max_percentage = EXCLUDED.max_percentage,
                points = EXCLUDED.points,
                remark = EXCLUDED.remark
            RETURNING *
        `, [req.user.school_id, grade, min_percentage, max_percentage, points, cbc_level, remark, is_cbc]);
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error saving grading scale:', error);
        res.status(500).json({ error: 'Error saving grading scale' });
    }
}

// ==================== EXAMS & ASSESSMENTS ====================

// Get exams for a class and subject
async function getExams(req, res) {
    try {
        const { class_id, subject_id } = req.query;
        
        if (!class_id || !subject_id) {
            return res.status(400).json({ error: 'class_id and subject_id are required' });
        }
        
        const result = await pool.query(`
            SELECT e.*, 
                   COUNT(DISTINCT em.student_id) as marks_count
            FROM exams e
            LEFT JOIN exam_marks em ON e.id = em.exam_id
            WHERE e.class_id = $1 AND e.subject_id = $2
            GROUP BY e.id
            ORDER BY e.exam_date DESC, e.id DESC
        `, [class_id, subject_id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching exams:', error);
        res.status(500).json({ error: 'Error fetching exams: ' + error.message });
    }
}

// Create exam
async function createExam(req, res) {
    const { exam_name, class_id, subject_id, exam_date, max_score, pass_mark, term_id } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO exams (exam_name, class_id, subject_id, exam_date, max_score, pass_mark, term_id, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `, [exam_name, class_id, subject_id, exam_date, max_score, pass_mark, term_id, req.user.id]);
        
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creating exam:', error);
        res.status(500).json({ error: 'Error creating exam: ' + error.message });
    }
}

// Get exam details by ID
async function getExamDetails(req, res) {
    try {
        const { id } = req.params;
        
        const result = await pool.query(`
            SELECT e.*, c.name as class_name, s.name as subject_name
            FROM exams e
            JOIN classes c ON e.class_id = c.id
            JOIN subjects s ON e.subject_id = s.id
            WHERE e.id = $1
        `, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Exam not found' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error fetching exam details:', error);
        res.status(500).json({ error: 'Error fetching exam details' });
    }
}

// ==================== MARKS ENTRY ====================

// Get students for marks entry
async function getStudentsForMarks(req, res) {
    try {
        const { class_id, exam_id } = req.query;
        
        if (!class_id || !exam_id) {
            return res.status(400).json({ error: 'class_id and exam_id are required' });
        }
        
        // Get all students in the class
        const students = await pool.query(`
            SELECT s.id, s.admission_number, u.first_name, u.last_name, u.email
            FROM students s
            JOIN users u ON s.user_id = u.id
            WHERE s.class_id = $1 AND s.enrollment_status = 'active'
            ORDER BY u.first_name, u.last_name
        `, [class_id]);
        
        // Get existing marks for this exam
        const marks = await pool.query(`
            SELECT student_id, score, remarks, grade
            FROM exam_marks
            WHERE exam_id = $1
        `, [exam_id]);
        
        const marksMap = {};
        marks.rows.forEach(m => {
            marksMap[m.student_id] = m;
        });
        
        const result = students.rows.map(student => ({
            id: student.id,
            admission_number: student.admission_number,
            first_name: student.first_name,
            last_name: student.last_name,
            email: student.email,
            current_score: marksMap[student.id]?.score || null,
            current_grade: marksMap[student.id]?.grade || null,
            remarks: marksMap[student.id]?.remarks || ''
        }));
        
        res.json(result);
    } catch (error) {
        console.error('Error fetching students for marks:', error);
        res.status(500).json({ error: 'Error fetching students: ' + error.message });
    }
}

// Save marks
async function saveMarks(req, res) {
    const { exam_id, marks_data } = req.body;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Get exam details to calculate grade
        const exam = await client.query(`
            SELECT max_score, pass_mark FROM exams WHERE id = $1
        `, [exam_id]);
        
        if (exam.rows.length === 0) {
            throw new Error('Exam not found');
        }
        
        const maxScore = exam.rows[0].max_score;
        
        for (const mark of marks_data) {
            const { student_id, score, remarks } = mark;
            const percentage = (score / maxScore) * 100;
            
            // Calculate grade based on percentage
            let grade = 'E';
            if (percentage >= 80) grade = 'A';
            else if (percentage >= 75) grade = 'A-';
            else if (percentage >= 70) grade = 'B+';
            else if (percentage >= 65) grade = 'B';
            else if (percentage >= 60) grade = 'B-';
            else if (percentage >= 55) grade = 'C+';
            else if (percentage >= 50) grade = 'C';
            else if (percentage >= 45) grade = 'C-';
            else if (percentage >= 40) grade = 'D+';
            else if (percentage >= 35) grade = 'D';
            else if (percentage >= 30) grade = 'D-';
            else grade = 'E';
            
            // Check if mark already exists
            const existing = await client.query(`
                SELECT id FROM exam_marks WHERE exam_id = $1 AND student_id = $2
            `, [exam_id, student_id]);
            
            if (existing.rows.length > 0) {
                // Update existing
                await client.query(`
                    UPDATE exam_marks 
                    SET score = $1, remarks = $2, grade = $3, updated_at = CURRENT_TIMESTAMP
                    WHERE exam_id = $4 AND student_id = $5
                `, [score, remarks, grade, exam_id, student_id]);
            } else {
                // Insert new
                await client.query(`
                    INSERT INTO exam_marks (exam_id, student_id, score, remarks, grade)
                    VALUES ($1, $2, $3, $4, $5)
                `, [exam_id, student_id, score, remarks, grade]);
            }
        }
        
        await client.query('COMMIT');
        res.json({ message: 'Marks saved successfully' });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error saving marks:', error);
        res.status(500).json({ error: 'Error saving marks: ' + error.message });
    } finally {
        client.release();
    }
}

// Bulk upload marks
async function bulkUploadMarks(req, res) {
    const { exam_id, marks_data } = req.body;
    
    try {
        let savedCount = 0;
        for (const mark of marks_data) {
            const result = await pool.query(`
                INSERT INTO exam_marks (exam_id, student_id, score, remarks)
                SELECT $1, s.id, $2, $3
                FROM students s
                WHERE s.admission_number = $4
                ON CONFLICT (exam_id, student_id) DO UPDATE SET 
                    score = EXCLUDED.score,
                    remarks = EXCLUDED.remarks,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING *
            `, [exam_id, mark.score, mark.remarks, mark.admission_number]);
            
            if (result.rows.length > 0) savedCount++;
        }
        
        res.json({ message: `Successfully uploaded ${savedCount} marks`, count: savedCount });
    } catch (error) {
        console.error('Error bulk uploading marks:', error);
        res.status(500).json({ error: 'Error bulk uploading marks' });
    }
}

// ==================== PERFORMANCE CALCULATION ====================

// Calculate term performance for a student
async function calculateTermPerformance(req, res) {
    const { student_id, term_id } = req.params;
    
    try {
        const result = await pool.query(`
            SELECT 
                AVG((r.score / e.max_score) * 100) as average_score,
                AVG(r.points) as total_points
            FROM results r
            JOIN exams e ON r.exam_id = e.id
            WHERE r.student_id = $1 AND e.term_id = $2
        `, [student_id, term_id]);
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error calculating term performance:', error);
        res.status(500).json({ error: 'Error calculating term performance' });
    }
}

// Get class performance
async function getClassPerformance(req, res) {
    const { class_id, term_id } = req.query;
    
    try {
        const result = await pool.query(`
            SELECT 
                s.id as student_id,
                u.first_name,
                u.last_name,
                s.admission_number,
                AVG((r.score / e.max_score) * 100) as average_score
            FROM students s
            JOIN users u ON s.user_id = u.id
            LEFT JOIN results r ON s.id = r.student_id
            LEFT JOIN exams e ON r.exam_id = e.id AND e.term_id = $2
            WHERE s.class_id = $1
            GROUP BY s.id, u.first_name, u.last_name, s.admission_number
            ORDER BY average_score DESC
        `, [class_id, term_id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching class performance:', error);
        res.status(500).json({ error: 'Error fetching class performance' });
    }
}

// Get performance trends
async function getPerformanceTrends(req, res) {
    const { student_id } = req.params;
    
    try {
        const result = await pool.query(`
            SELECT 
                t.term_name,
                t.academic_year,
                AVG((r.score / e.max_score) * 100) as average_score
            FROM results r
            JOIN exams e ON r.exam_id = e.id
            JOIN academic_terms t ON e.term_id = t.id
            WHERE r.student_id = $1
            GROUP BY t.id, t.term_name, t.academic_year
            ORDER BY t.id
        `, [student_id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching performance trends:', error);
        res.status(500).json({ error: 'Error fetching performance trends' });
    }
}

// Get subject performance
async function getSubjectPerformance(req, res) {
    const { class_id, term_id, subject_id } = req.query;
    
    try {
        const result = await pool.query(`
            SELECT 
                u.first_name,
                u.last_name,
                r.score,
                r.grade
            FROM results r
            JOIN students s ON r.student_id = s.id
            JOIN users u ON s.user_id = u.id
            WHERE s.class_id = $1 AND r.exam_id IN (
                SELECT id FROM exams WHERE term_id = $2 AND subject_id = $3
            )
            ORDER BY r.score DESC
        `, [class_id, term_id, subject_id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching subject performance:', error);
        res.status(500).json({ error: 'Error fetching subject performance' });
    }
}

// Get dashboard stats
async function getResultsDashboardStats(req, res) {
    try {
        const pendingMarks = await pool.query(`
            SELECT COUNT(DISTINCT e.id) as count
            FROM exams e
            WHERE NOT EXISTS (
                SELECT 1 FROM exam_marks em WHERE em.exam_id = e.id
            )
        `);
        
        res.json({
            pending_marks: parseInt(pendingMarks.rows[0].count),
            published_results: 0,
            top_performers: []
        });
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        res.status(500).json({ error: 'Error fetching dashboard stats' });
    }
}

// Get AI insights
async function getAIInsights(req, res) {
    try {
        res.json([]);
    } catch (error) {
        console.error('Error generating AI insights:', error);
        res.status(500).json({ error: 'Error generating insights' });
    }
}

// Generate report card
async function generateReportCard(req, res) {
    const { student_id, term_id } = req.params;
    
    try {
        const doc = new PDFDocument({ margin: 50 });
        const filename = `report_card_${student_id}_term_${term_id}.pdf`;
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        doc.pipe(res);
        
        doc.fontSize(20).text('SHULECONNECT SCHOOL', { align: 'center' });
        doc.fontSize(12).text('Student Report Card', { align: 'center' });
        doc.moveDown();
        doc.text(`Student ID: ${student_id}`);
        doc.text(`Term ID: ${term_id}`);
        doc.moveDown();
        doc.text('Thank you for using ShuleConnect');
        
        doc.end();
    } catch (error) {
        console.error('Error generating report card:', error);
        res.status(500).json({ error: 'Error generating report card' });
    }
}

// Generate bulk report cards
async function generateBulkReportCards(req, res) {
    try {
        res.json({ message: 'Bulk report cards generated', count: 0 });
    } catch (error) {
        console.error('Error generating bulk report cards:', error);
        res.status(500).json({ error: 'Error generating bulk report cards' });
    }
}

// Get exams for a class and subject
async function getExams(req, res) {
    try {
        const { class_id, subject_id } = req.query;
        
        if (!class_id || !subject_id) {
            return res.status(400).json({ error: 'class_id and subject_id are required' });
        }
        
        const result = await pool.query(`
            SELECT e.id, e.exam_name, e.class_id, e.subject_id, e.term_id, 
                   e.max_score, e.exam_date, e.created_at
            FROM exams e
            WHERE e.class_id = $1 AND e.subject_id = $2
            ORDER BY e.exam_date DESC, e.id DESC
        `, [class_id, subject_id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching exams:', error);
        res.status(500).json({ error: 'Error fetching exams: ' + error.message });
    }
}

// Export all functions
module.exports = {
    getGradingScales,
    saveGradingScale,
    getExams,
    createExam,
    getExamDetails,
    getStudentsForMarks,
    saveMarks,
    bulkUploadMarks,
    calculateTermPerformance,
    getClassPerformance,
    generateReportCard,
    generateBulkReportCards,
    getPerformanceTrends,
    getSubjectPerformance,
    getResultsDashboardStats,
    getAIInsights
};