const { Pool } = require('pg');
const moment = require('moment');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

// Helper Functions
function generateStaffNumber() {
    const year = new Date().getFullYear();
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `STF/${year}/${random}`;
}

function generateContractNumber() {
    const year = new Date().getFullYear();
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `CTR/${year}/${random}`;
}

// Calculate PAYE (Kenyan Tax)
function calculatePAYE(grossSalary) {
    let tax = 0;
    // Kenyan tax bands (simplified)
    if (grossSalary <= 24000) {
        tax = grossSalary * 0.10;
    } else if (grossSalary <= 32333) {
        tax = 2400 + (grossSalary - 24000) * 0.25;
    } else {
        tax = 2400 + (8333 * 0.25) + (grossSalary - 32333) * 0.30;
    }
    return Math.round(tax);
}

// Calculate NSSF (Tier I and II)
function calculateNSSF(grossSalary) {
    const tier1Limit = 6000;
    const tier2Limit = 18000;
    
    let nssf = 0;
    if (grossSalary <= tier1Limit) {
        nssf = grossSalary * 0.06;
    } else if (grossSalary <= tier2Limit) {
        nssf = (tier1Limit * 0.06) + ((grossSalary - tier1Limit) * 0.06);
    } else {
        nssf = (tier1Limit * 0.06) + ((tier2Limit - tier1Limit) * 0.06);
    }
    return Math.min(Math.round(nssf), 1080); // Cap at 1080
}

// Calculate NHIF (Kenyan NHIF rates)
function calculateNHIF(grossSalary) {
    const nhifRates = [
        { min: 0, max: 5999, amount: 150 },
        { min: 6000, max: 7999, amount: 300 },
        { min: 8000, max: 11999, amount: 400 },
        { min: 12000, max: 14999, amount: 500 },
        { min: 15000, max: 19999, amount: 600 },
        { min: 20000, max: 24999, amount: 750 },
        { min: 25000, max: 29999, amount: 850 },
        { min: 30000, max: 34999, amount: 900 },
        { min: 35000, max: 39999, amount: 950 },
        { min: 40000, max: 44999, amount: 1000 },
        { min: 45000, max: 49999, amount: 1100 },
        { min: 50000, max: 59999, amount: 1200 },
        { min: 60000, max: 69999, amount: 1300 },
        { min: 70000, max: 79999, amount: 1400 },
        { min: 80000, max: 89999, amount: 1500 },
        { min: 90000, max: 99999, amount: 1600 },
        { min: 100000, max: Infinity, amount: 1700 }
    ];
    
    const rate = nhifRates.find(r => grossSalary >= r.min && grossSalary <= r.max);
    return rate ? rate.amount : 1700;
}

// ==================== STAFF MANAGEMENT ====================

async function getStaff(req, res) {
    const { department, status, search, page = 1, limit = 20 } = req.query;
    
    try {
        let query = `
            SELECT sd.*, u.first_name, u.last_name, u.email, u.phone, u.gender,
                   u.date_of_birth, u.national_id, u.profile_photo_url
            FROM staff_details sd
            JOIN users u ON sd.user_id = u.id
            WHERE u.school_id = $1 AND u.role IN ('teacher', 'staff', 'accountant', 'librarian')
        `;
        
        const params = [req.user.school_id];
        let paramCount = 2;
        
        if (department) {
            query += ` AND sd.department = $${paramCount}`;
            params.push(department);
            paramCount++;
        }
        
        if (status === 'active') {
            query += ` AND sd.is_active = true`;
        } else if (status === 'inactive') {
            query += ` AND sd.is_active = false`;
        }
        
        if (search) {
            query += ` AND (u.first_name ILIKE $${paramCount} OR u.last_name ILIKE $${paramCount} OR sd.staff_number ILIKE $${paramCount})`;
            params.push(`%${search}%`);
            paramCount++;
        }
        
        const countQuery = query.replace(
            'SELECT sd.*, u.first_name, u.last_name, u.email, u.phone, u.gender, u.date_of_birth, u.national_id, u.profile_photo_url',
            'SELECT COUNT(*) as total'
        );
        const countResult = await pool.query(countQuery, params);
        const total = parseInt(countResult.rows[0].total);
        
        const offset = (page - 1) * limit;
        query += ` ORDER BY sd.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(limit, offset);
        
        const result = await pool.query(query, params);
        
        res.json({
            staff: result.rows,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching staff:', error);
        res.status(500).json({ error: 'Error fetching staff' });
    }
}

async function getStaffById(req, res) {
    const { id } = req.params;
    
    try {
        const result = await pool.query(`
            SELECT sd.*, u.first_name, u.last_name, u.email, u.phone, u.gender,
                   u.date_of_birth, u.national_id, u.profile_photo_url,
                   COALESCE(
                       (SELECT json_agg(jsonb_build_object(
                           'id', sc.id,
                           'contract_number', sc.contract_number,
                           'contract_type', sc.contract_type,
                           'start_date', sc.start_date,
                           'end_date', sc.end_date,
                           'salary_amount', sc.salary_amount,
                           'status', sc.status
                       )) FROM staff_contracts sc WHERE sc.staff_id = sd.id ORDER BY sc.start_date DESC),
                       '[]'
                   ) as contracts,
                   COALESCE(
                       (SELECT json_agg(jsonb_build_object(
                           'id', lr.id,
                           'leave_type', lt.leave_name,
                           'start_date', lr.start_date,
                           'end_date', lr.end_date,
                           'status', lr.status
                       )) FROM leave_requests lr
                       JOIN leave_types lt ON lr.leave_type_id = lt.id
                       WHERE lr.staff_id = sd.id ORDER BY lr.created_at DESC LIMIT 5),
                       '[]'
                   ) as recent_leaves
            FROM staff_details sd
            JOIN users u ON sd.user_id = u.id
            WHERE sd.id = $1 AND u.school_id = $2
        `, [id, req.user.school_id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Staff not found' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error fetching staff:', error);
        res.status(500).json({ error: 'Error fetching staff' });
    }
}

async function createStaff(req, res) {
    const {
        user_id, job_title, department, employment_type, tsc_number, kra_pin,
        nssf_number, nhif_number, bank_name, bank_account, bank_branch,
        emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
        highest_qualification, specialization, years_of_experience, joining_date
    } = req.body;
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Check if staff already exists
        const existing = await client.query(`
            SELECT id FROM staff_details WHERE user_id = $1
        `, [user_id]);
        
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Staff record already exists for this user' });
        }
        
        const staffNumber = generateStaffNumber();
        
        const result = await client.query(`
            INSERT INTO staff_details (
                user_id, staff_number, job_title, department, employment_type,
                tsc_number, kra_pin, nssf_number, nhif_number, bank_name,
                bank_account, bank_branch, emergency_contact_name, emergency_contact_phone,
                emergency_contact_relation, highest_qualification, specialization,
                years_of_experience, joining_date, is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, true)
            RETURNING id
        `, [user_id, staffNumber, job_title, department, employment_type,
            tsc_number, kra_pin, nssf_number, nhif_number, bank_name,
            bank_account, bank_branch, emergency_contact_name, emergency_contact_phone,
            emergency_contact_relation, highest_qualification, specialization,
            years_of_experience, joining_date]);
        
        await client.query('COMMIT');
        
        res.status(201).json({
            message: 'Staff record created successfully',
            staff_id: result.rows[0].id,
            staff_number: staffNumber
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error creating staff:', error);
        res.status(500).json({ error: 'Error creating staff' });
    } finally {
        client.release();
    }
}

// ==================== CONTRACT MANAGEMENT ====================

async function createContract(req, res) {
    const {
        staff_id, contract_type, start_date, end_date, probation_period_months,
        notice_period_days, salary_amount, benefits, notes
    } = req.body;
    
    try {
        const contractNumber = generateContractNumber();
        
        const result = await pool.query(`
            INSERT INTO staff_contracts (
                staff_id, contract_number, contract_type, start_date, end_date,
                probation_period_months, notice_period_days, salary_amount, benefits, notes,
                status, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11)
            RETURNING id
        `, [staff_id, contractNumber, contract_type, start_date, end_date,
            probation_period_months, notice_period_days, salary_amount, benefits, notes, req.user.id]);
        
        res.status(201).json({
            message: 'Contract created successfully',
            contract_id: result.rows[0].id,
            contract_number: contractNumber
        });
    } catch (error) {
        console.error('Error creating contract:', error);
        res.status(500).json({ error: 'Error creating contract' });
    }
}

async function getExpiringContracts(req, res) {
    const { days = 30 } = req.query;
    
    try {
        const result = await pool.query(`
            SELECT sc.*, sd.staff_number, u.first_name, u.last_name, u.email, u.phone
            FROM staff_contracts sc
            JOIN staff_details sd ON sc.staff_id = sd.id
            JOIN users u ON sd.user_id = u.id
            WHERE sc.end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + $1::INTERVAL
                AND sc.status = 'active'
            ORDER BY sc.end_date ASC
        `, [`${days} days`]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching expiring contracts:', error);
        res.status(500).json({ error: 'Error fetching expiring contracts' });
    }
}

// ==================== LEAVE MANAGEMENT ====================

async function getLeaveTypes(req, res) {
    try {
        const result = await pool.query(`
            SELECT * FROM leave_types WHERE school_id = $1 AND is_active = true
        `, [req.user.school_id]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching leave types:', error);
        res.status(500).json({ error: 'Error fetching leave types' });
    }
}

async function getLeaveBalances(req, res) {
    const { staff_id } = req.params;
    
    try {
        const result = await pool.query(`
            SELECT lt.leave_name, lt.leave_code, lt.days_per_year,
                   COALESCE(lb.used_days, 0) as used_days,
                   COALESCE(lb.pending_days, 0) as pending_days,
                   COALESCE(lb.carried_over_days, 0) as carried_over,
                   (lt.days_per_year + COALESCE(lb.carried_over_days, 0) - COALESCE(lb.used_days, 0) - COALESCE(lb.pending_days, 0)) as available_days
            FROM leave_types lt
            LEFT JOIN leave_balances lb ON lt.id = lb.leave_type_id AND lb.staff_id = $1 AND lb.year = EXTRACT(YEAR FROM CURRENT_DATE)
            WHERE lt.school_id = $2 AND lt.is_active = true
            ORDER BY lt.leave_name
        `, [staff_id, req.user.school_id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching leave balances:', error);
        res.status(500).json({ error: 'Error fetching leave balances' });
    }
}

async function submitLeaveRequest(req, res) {
    const { staff_id, leave_type_id, start_date, end_date, reason, attachment_url } = req.body;
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Calculate total days
        const start = moment(start_date);
        const end = moment(end_date);
        const totalDays = end.diff(start, 'days') + 1;
        
        // Check available balance
        const balance = await client.query(`
            SELECT (lt.days_per_year + COALESCE(lb.carried_over_days, 0) - COALESCE(lb.used_days, 0) - COALESCE(lb.pending_days, 0)) as available
            FROM leave_types lt
            LEFT JOIN leave_balances lb ON lt.id = lb.leave_type_id AND lb.staff_id = $1 AND lb.year = EXTRACT(YEAR FROM CURRENT_DATE)
            WHERE lt.id = $2
        `, [staff_id, leave_type_id]);
        
        if (balance.rows[0]?.available < totalDays) {
            return res.status(400).json({ error: 'Insufficient leave days available' });
        }
        
        // Create leave request
        const result = await client.query(`
            INSERT INTO leave_requests (
                staff_id, leave_type_id, start_date, end_date, total_days, reason, attachment_url, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
            RETURNING id
        `, [staff_id, leave_type_id, start_date, end_date, totalDays, reason, attachment_url]);
        
        // Update pending days in balance
        await client.query(`
            INSERT INTO leave_balances (staff_id, leave_type_id, year, pending_days)
            VALUES ($1, $2, EXTRACT(YEAR FROM CURRENT_DATE), $3)
            ON CONFLICT (staff_id, leave_type_id, year) DO UPDATE
            SET pending_days = leave_balances.pending_days + $3
        `, [staff_id, leave_type_id, totalDays]);
        
        await client.query('COMMIT');
        
        res.status(201).json({
            message: 'Leave request submitted successfully',
            request_id: result.rows[0].id
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error submitting leave request:', error);
        res.status(500).json({ error: 'Error submitting leave request' });
    } finally {
        client.release();
    }
}

async function approveLeaveRequest(req, res) {
    const { id } = req.params;
    const { status, rejection_reason } = req.body;
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const leaveRequest = await client.query(`
            SELECT * FROM leave_requests WHERE id = $1
        `, [id]);
        
        if (leaveRequest.rows.length === 0) {
            return res.status(404).json({ error: 'Leave request not found' });
        }
        
        await client.query(`
            UPDATE leave_requests 
            SET status = $1, approved_by = $2, approved_date = CURRENT_DATE,
                rejection_reason = $3, updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
        `, [status, req.user.id, rejection_reason, id]);
        
        if (status === 'approved') {
            // Update used days and clear pending days
            await client.query(`
                UPDATE leave_balances 
                SET used_days = used_days + $1, pending_days = pending_days - $1
                WHERE staff_id = $2 AND leave_type_id = $3 AND year = EXTRACT(YEAR FROM CURRENT_DATE)
            `, [leaveRequest.rows[0].total_days, leaveRequest.rows[0].staff_id, leaveRequest.rows[0].leave_type_id]);
        } else if (status === 'rejected') {
            // Clear pending days only
            await client.query(`
                UPDATE leave_balances 
                SET pending_days = pending_days - $1
                WHERE staff_id = $2 AND leave_type_id = $3 AND year = EXTRACT(YEAR FROM CURRENT_DATE)
            `, [leaveRequest.rows[0].total_days, leaveRequest.rows[0].staff_id, leaveRequest.rows[0].leave_type_id]);
        }
        
        await client.query('COMMIT');
        
        res.json({ message: `Leave request ${status}` });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error approving leave request:', error);
        res.status(500).json({ error: 'Error processing leave request' });
    } finally {
        client.release();
    }
}

// ==================== PAYROLL PROCESSING ====================

async function processPayroll(req, res) {
    const { payroll_month, staff_ids } = req.body;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Get all active staff or specific ones
        let staffQuery = `
            SELECT sd.*, u.first_name, u.last_name, u.email,
                   sc.salary_amount, sc.benefits
            FROM staff_details sd
            JOIN users u ON sd.user_id = u.id
            LEFT JOIN staff_contracts sc ON sd.id = sc.staff_id AND sc.status = 'active'
            WHERE sd.is_active = true AND u.school_id = $1
        `;
        
        const params = [req.user.school_id];
        
        if (staff_ids && staff_ids.length > 0) {
            staffQuery += ` AND sd.id = ANY($2)`;
            params.push(staff_ids);
        }
        
        const staff = await client.query(staffQuery, params);
        
        // Create payroll record
        const payrollResult = await client.query(`
            INSERT INTO payroll (school_id, payroll_month, payroll_period, processed_by, status)
            VALUES ($1, $2, 'monthly', $3, 'processed')
            RETURNING id
        `, [req.user.school_id, payroll_month, req.user.id]);
        
        const payrollId = payrollResult.rows[0].id;
        let totalGross = 0;
        let totalDeductions = 0;
        let totalNet = 0;
        
        for (const employee of staff.rows) {
            const basicSalary = parseFloat(employee.salary_amount) || 0;
            const benefits = employee.benefits || {};
            
            const houseAllowance = benefits.house_allowance || 0;
            const transportAllowance = benefits.transport_allowance || 0;
            const medicalAllowance = benefits.medical_allowance || 0;
            const otherAllowances = benefits.other_allowances || 0;
            
            const grossSalary = basicSalary + houseAllowance + transportAllowance + medicalAllowance + otherAllowances;
            const payeTax = calculatePAYE(grossSalary);
            const nssf = calculateNSSF(grossSalary);
            const nhif = calculateNHIF(grossSalary);
            const totalDeductionsAmount = payeTax + nssf + nhif;
            const netSalary = grossSalary - totalDeductionsAmount;
            
            totalGross += grossSalary;
            totalDeductions += totalDeductionsAmount;
            totalNet += netSalary;
            
            await client.query(`
                INSERT INTO payroll_items (
                    payroll_id, staff_id, basic_salary, house_allowance, transport_allowance,
                    medical_allowance, other_allowances, gross_salary, paye_tax, nssf, nhif,
                    total_deductions, net_salary, bank_account
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            `, [payrollId, employee.id, basicSalary, houseAllowance, transportAllowance,
                medicalAllowance, otherAllowances, grossSalary, payeTax, nssf, nhif,
                totalDeductionsAmount, netSalary, employee.bank_account]);
        }
        
        // Update payroll totals
        await client.query(`
            UPDATE payroll 
            SET total_gross = $1, total_deductions = $2, total_net = $3
            WHERE id = $4
        `, [totalGross, totalDeductions, totalNet, payrollId]);
        
        await client.query('COMMIT');
        
        res.json({
            message: 'Payroll processed successfully',
            payroll_id: payrollId,
            summary: {
                total_employees: staff.rows.length,
                total_gross: totalGross,
                total_deductions: totalDeductions,
                total_net: totalNet
            }
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error processing payroll:', error);
        res.status(500).json({ error: 'Error processing payroll' });
    } finally {
        client.release();
    }
}

async function getPayrollHistory(req, res) {
    const { year, month } = req.query;
    
    try {
        let query = `
            SELECT p.*, COUNT(pi.id) as employee_count
            FROM payroll p
            LEFT JOIN payroll_items pi ON p.id = pi.payroll_id
            WHERE p.school_id = $1
        `;
        
        const params = [req.user.school_id];
        let paramCount = 2;
        
        if (year) {
            query += ` AND EXTRACT(YEAR FROM p.payroll_month) = $${paramCount}`;
            params.push(year);
            paramCount++;
        }
        
        if (month) {
            query += ` AND EXTRACT(MONTH FROM p.payroll_month) = $${paramCount}`;
            params.push(month);
            paramCount++;
        }
        
        query += ` GROUP BY p.id ORDER BY p.payroll_month DESC`;
        
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching payroll history:', error);
        res.status(500).json({ error: 'Error fetching payroll history' });
    }
}

async function generatePayslip(req, res) {
    const { payroll_item_id } = req.params;
    
    try {
        const result = await pool.query(`
            SELECT pi.*, p.payroll_month, sd.staff_number,
                   u.first_name, u.last_name, u.email, u.phone, u.national_id,
                   sd.bank_name, sd.bank_account
            FROM payroll_items pi
            JOIN payroll p ON pi.payroll_id = p.id
            JOIN staff_details sd ON pi.staff_id = sd.id
            JOIN users u ON sd.user_id = u.id
            WHERE pi.id = $1 AND p.school_id = $2
        `, [payroll_item_id, req.user.school_id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Payslip not found' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error generating payslip:', error);
        res.status(500).json({ error: 'Error generating payslip' });
    }
}

// ==================== STAFF APPRAISALS ====================

async function createAppraisal(req, res) {
    const {
        staff_id, appraisal_period, appraisal_date, overall_rating,
        strengths, weaknesses, goals_achieved, areas_for_improvement,
        training_recommendations, promotion_recommended, salary_adjustment_recommended,
        adjustment_amount, staff_comments
    } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO staff_appraisals (
                staff_id, appraisal_period, appraisal_date, reviewer_id,
                overall_rating, strengths, weaknesses, goals_achieved,
                areas_for_improvement, training_recommendations,
                promotion_recommended, salary_adjustment_recommended,
                adjustment_amount, staff_comments, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'draft')
            RETURNING id
        `, [staff_id, appraisal_period, appraisal_date, req.user.id,
            overall_rating, strengths, weaknesses, goals_achieved,
            areas_for_improvement, training_recommendations,
            promotion_recommended, salary_adjustment_recommended,
            adjustment_amount, staff_comments]);
        
        res.status(201).json({ message: 'Appraisal created', id: result.rows[0].id });
    } catch (error) {
        console.error('Error creating appraisal:', error);
        res.status(500).json({ error: 'Error creating appraisal' });
    }
}

// ==================== STAFF DOCUMENTS ====================

async function uploadStaffDocument(req, res) {
    const { staff_id, document_type, document_name, document_number, issue_date, expiry_date, notes } = req.body;
    const document_url = req.file?.path || req.body.document_url;
    
    try {
        const result = await pool.query(`
            INSERT INTO staff_documents (
                staff_id, document_type, document_name, document_url, document_number,
                issue_date, expiry_date, uploaded_by, is_verified
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)
            RETURNING id
        `, [staff_id, document_type, document_name, document_url, document_number,
            issue_date, expiry_date, req.user.id]);
        
        res.status(201).json({ message: 'Document uploaded', id: result.rows[0].id });
    } catch (error) {
        console.error('Error uploading document:', error);
        res.status(500).json({ error: 'Error uploading document' });
    }
}

async function getExpiringDocuments(req, res) {
    const { days = 30 } = req.query;
    
    try {
        const result = await pool.query(`
            SELECT sd.*, u.first_name, u.last_name, sd2.staff_number
            FROM staff_documents sd
            JOIN staff_details sd2 ON sd.staff_id = sd2.id
            JOIN users u ON sd2.user_id = u.id
            WHERE sd.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + $1::INTERVAL
                AND sd.is_verified = true
            ORDER BY sd.expiry_date ASC
        `, [`${days} days`]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching expiring documents:', error);
        res.status(500).json({ error: 'Error fetching expiring documents' });
    }
}

// ==================== HR DASHBOARD ====================

async function getHRDashboard(req, res) {
    try {
        // Staff count by department
        const staffByDepartment = await pool.query(`
            SELECT department, COUNT(*) as count
            FROM staff_details sd
            JOIN users u ON sd.user_id = u.id
            WHERE u.school_id = $1 AND sd.is_active = true
            GROUP BY department
        `, [req.user.school_id]);
        
        // Pending leave requests
        const pendingLeaves = await pool.query(`
            SELECT COUNT(*) as count
            FROM leave_requests lr
            JOIN staff_details sd ON lr.staff_id = sd.id
            JOIN users u ON sd.user_id = u.id
            WHERE u.school_id = $1 AND lr.status = 'pending'
        `, [req.user.school_id]);
        
        // Upcoming contract expirations
        const expiringContracts = await pool.query(`
            SELECT COUNT(*) as count
            FROM staff_contracts sc
            JOIN staff_details sd ON sc.staff_id = sd.id
            JOIN users u ON sd.user_id = u.id
            WHERE u.school_id = $1 AND sc.end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
                AND sc.status = 'active'
        `, [req.user.school_id]);
        
        // Staff on leave today
        const staffOnLeave = await pool.query(`
            SELECT COUNT(*) as count
            FROM leave_requests lr
            JOIN staff_details sd ON lr.staff_id = sd.id
            JOIN users u ON sd.user_id = u.id
            WHERE u.school_id = $1 
                AND lr.status = 'approved'
                AND CURRENT_DATE BETWEEN lr.start_date AND lr.end_date
        `, [req.user.school_id]);
        
        // Staff attendance rate (last 30 days)
        const attendanceRate = await pool.query(`
            SELECT 
                COUNT(CASE WHEN a.status = 'present' THEN 1 END) * 100.0 / COUNT(*) as rate
            FROM attendance a
            JOIN users u ON a.user_id = u.id
            WHERE u.school_id = $1 AND a.attendance_date >= CURRENT_DATE - INTERVAL '30 days'
        `, [req.user.school_id]);
        
        res.json({
            staff_by_department: staffByDepartment.rows,
            pending_leave_requests: parseInt(pendingLeaves.rows[0].count),
            expiring_contracts: parseInt(expiringContracts.rows[0].count),
            staff_on_leave_today: parseInt(staffOnLeave.rows[0].count),
            attendance_rate: parseFloat(attendanceRate.rows[0]?.rate || 0).toFixed(1)
        });
    } catch (error) {
        console.error('Error fetching HR dashboard:', error);
        res.status(500).json({ error: 'Error fetching HR dashboard' });
    }
}

module.exports = {
    // Staff
    getStaff,
    getStaffById,
    createStaff,
    // Contracts
    createContract,
    getExpiringContracts,
    // Leave
    getLeaveTypes,
    getLeaveBalances,
    submitLeaveRequest,
    approveLeaveRequest,
    // Payroll
    processPayroll,
    getPayrollHistory,
    generatePayslip,
    // Appraisals
    createAppraisal,
    // Documents
    uploadStaffDocument,
    getExpiringDocuments,
    // Dashboard
    getHRDashboard
};