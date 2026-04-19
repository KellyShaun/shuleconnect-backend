const { Pool } = require('pg');
const moment = require('moment');
const axios = require('axios');
const crypto = require('crypto');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

// Generate receipt number
function generateReceiptNumber() {
    const year = new Date().getFullYear();
    const random = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
    return `RCP/${year}/${random}`;
}

// ==================== FEE STRUCTURES ====================

// Create fee structure
async function createFeeStructure(req, res) {
    const {
        class_id, term_id, category_id, fee_name, fee_code, amount,
        is_mandatory, frequency, due_date, late_fee_type, late_fee_value,
        discount_percentage, prorate_enabled
    } = req.body;

    try {
        const result = await pool.query(`
            INSERT INTO fee_structures (
                school_id, class_id, term_id, category_id, fee_name, fee_code,
                amount, is_mandatory, frequency, due_date, late_fee_type,
                late_fee_value, discount_percentage, prorate_enabled
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING *
        `, [req.user.school_id, class_id, term_id, category_id, fee_name, fee_code,
            amount, is_mandatory, frequency, due_date, late_fee_type,
            late_fee_value, discount_percentage, prorate_enabled]);

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creating fee structure:', error);
        res.status(500).json({ error: 'Error creating fee structure' });
    }
}

// Get fee structures
async function getFeeStructures(req, res) {
    const { class_id, term_id, category_id } = req.query;

    try {
        let query = `
            SELECT fs.*, c.name as class_name, t.term_name, fc.category_name, fc.vote_head
            FROM fee_structures fs
            LEFT JOIN classes c ON fs.class_id = c.id
            LEFT JOIN academic_terms t ON fs.term_id = t.id
            LEFT JOIN fee_categories fc ON fs.category_id = fc.id
            WHERE fs.school_id = $1
        `;
        const params = [req.user.school_id];
        let paramCount = 2;

        if (class_id) {
            query += ` AND fs.class_id = $${paramCount}`;
            params.push(class_id);
            paramCount++;
        }
        if (term_id) {
            query += ` AND fs.term_id = $${paramCount}`;
            params.push(term_id);
            paramCount++;
        }
        if (category_id) {
            query += ` AND fs.category_id = $${paramCount}`;
            params.push(category_id);
            paramCount++;
        }

        query += ` ORDER BY fs.created_at DESC`;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching fee structures:', error);
        res.status(500).json({ error: 'Error fetching fee structures' });
    }
}

// ==================== STUDENT FEE ASSIGNMENT ====================

// Assign fees to students
async function assignFeesToStudents(req, res) {
    const { fee_structure_id, student_ids, discount_id } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Get fee structure details
        const feeResult = await client.query(`
            SELECT * FROM fee_structures WHERE id = $1
        `, [fee_structure_id]);

        const fee = feeResult.rows[0];
        if (!fee) throw new Error('Fee structure not found');

        let discount = null;
        if (discount_id) {
            const discountResult = await client.query(`
                SELECT * FROM fee_discounts WHERE id = $1 AND is_active = true
            `, [discount_id]);
            discount = discountResult.rows[0];
        }

        for (const studentId of student_ids) {
            const discountedAmount = discount 
                ? discount.discount_type === 'percentage' 
                    ? fee.amount * (1 - discount.discount_value / 100)
                    : fee.amount - discount.discount_value
                : fee.amount;

            await client.query(`
                INSERT INTO student_fees (
                    student_id, fee_structure_id, discount_id, original_amount,
                    discounted_amount, balance, due_date, status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
            `, [studentId, fee_structure_id, discount_id, fee.amount,
                discountedAmount, discountedAmount, fee.due_date]);
        }

        await client.query('COMMIT');
        res.json({ message: `Fees assigned to ${student_ids.length} students successfully` });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error assigning fees:', error);
        res.status(500).json({ error: 'Error assigning fees' });
    } finally {
        client.release();
    }
}

// Get student fee balance
async function getStudentFeeBalance(req, res) {
    const { student_id } = req.params;

    try {
        const result = await pool.query(`
            SELECT 
                sf.*,
                fs.fee_name,
                fs.fee_code,
                fc.category_name,
                fs.due_date,
                CASE 
                    WHEN sf.balance <= 0 THEN 'paid'
                    WHEN sf.due_date < CURRENT_DATE THEN 'overdue'
                    WHEN sf.balance < sf.discounted_amount THEN 'partial'
                    ELSE 'pending'
                END as payment_status,
                (sf.discounted_amount - sf.paid_amount) as current_balance,
                EXTRACT(DAY FROM (sf.due_date - CURRENT_DATE)) as days_overdue
            FROM student_fees sf
            JOIN fee_structures fs ON sf.fee_structure_id = fs.id
            LEFT JOIN fee_categories fc ON fs.category_id = fc.id
            WHERE sf.student_id = $1 AND sf.balance > 0
            ORDER BY fs.due_date ASC
        `, [student_id]);

        // Get total summary
        const summary = await pool.query(`
            SELECT 
                COALESCE(SUM(sf.discounted_amount), 0) as total_expected,
                COALESCE(SUM(sf.paid_amount), 0) as total_paid,
                COALESCE(SUM(sf.balance), 0) as total_balance,
                COUNT(CASE WHEN sf.due_date < CURRENT_DATE AND sf.balance > 0 THEN 1 END) as overdue_items
            FROM student_fees sf
            WHERE sf.student_id = $1
        `, [student_id]);

        res.json({
            fees: result.rows,
            summary: summary.rows[0]
        });
    } catch (error) {
        console.error('Error fetching fee balance:', error);
        res.status(500).json({ error: 'Error fetching fee balance' });
    }
}

// ==================== PAYMENT PROCESSING ====================

// Process payment
async function processPayment(req, res) {
    const {
        student_id, amount, payment_method, mpesa_code, bank_name,
        cheque_number, reference, notes
    } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Generate receipt number
        const receiptNumber = generateReceiptNumber();

        // Create payment record
        const paymentResult = await client.query(`
            INSERT INTO payments (
                school_id, student_id, payment_method, amount, payment_date,
                receipt_number, mpesa_code, bank_name, cheque_number, reference,
                notes, recorded_by, status
            ) VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6, $7, $8, $9, $10, $11, 'completed')
            RETURNING *
        `, [req.user.school_id, student_id, payment_method, amount, receiptNumber,
            mpesa_code, bank_name, cheque_number, reference, notes, req.user.id]);

        const payment = paymentResult.rows[0];

        // Get outstanding fees (oldest first)
        const fees = await client.query(`
            SELECT id, balance FROM student_fees
            WHERE student_id = $1 AND balance > 0
            ORDER BY due_date ASC
        `, [student_id]);

        let remainingAmount = amount;

        // Allocate payment to fees
        for (const fee of fees.rows) {
            if (remainingAmount <= 0) break;

            const allocationAmount = Math.min(remainingAmount, parseFloat(fee.balance));
            
            await client.query(`
                INSERT INTO payment_allocations (payment_id, student_fee_id, amount)
                VALUES ($1, $2, $3)
            `, [payment.id, fee.id, allocationAmount]);

            // Update student fee balance
            await client.query(`
                UPDATE student_fees 
                SET paid_amount = paid_amount + $1,
                    balance = balance - $1,
                    status = CASE 
                        WHEN balance - $1 <= 0 THEN 'paid'
                        WHEN balance - $1 < discounted_amount THEN 'partial'
                        ELSE status
                    END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $2
            `, [allocationAmount, fee.id]);

            remainingAmount -= allocationAmount;
        }

        // If overpayment, create credit note
        if (remainingAmount > 0) {
            await client.query(`
                INSERT INTO student_fees (
                    student_id, fee_structure_id, original_amount, discounted_amount,
                    paid_amount, balance, due_date, status, notes
                ) VALUES ($1, NULL, $2, $2, $2, 0, CURRENT_DATE + INTERVAL '90 days', 'paid', 'Credit from overpayment')
            `, [student_id, remainingAmount]);
        }

        // Create journal entry for double-entry accounting
        const journalResult = await client.query(`
            INSERT INTO journal_entries (
                school_id, entry_date, reference, description, entry_type, created_by, approval_status
            ) VALUES ($1, CURRENT_DATE, $2, $3, 'payment', $4, 'approved')
            RETURNING id
        `, [req.user.school_id, receiptNumber, `Payment received from student ${student_id}`, req.user.id]);

        // Debit: Cash/Bank account, Credit: Fee Income account
        await client.query(`
            INSERT INTO journal_lines (journal_entry_id, account_id, debit_amount, credit_amount)
            VALUES 
                ($1, (SELECT id FROM chart_of_accounts WHERE account_code = 'CASH' LIMIT 1), $2, 0),
                ($1, (SELECT id FROM chart_of_accounts WHERE account_code = 'FEE_INCOME' LIMIT 1), 0, $2)
        `, [journalResult.rows[0].id, amount]);

        await client.query('COMMIT');

        // Send payment confirmation
        const student = await client.query(`
            SELECT u.phone, u.email, u.first_name, u.last_name
            FROM students s
            JOIN users u ON s.user_id = u.id
            WHERE s.id = $1
        `, [student_id]);

        if (student.rows[0]) {
            const message = `Payment of KES ${amount.toLocaleString()} received. Receipt: ${receiptNumber}. Balance: KES ${(summary.total_balance - amount).toLocaleString()}`;
            // Send SMS/Email (implement external service)
        }

        res.json({
            message: 'Payment processed successfully',
            receipt_number: receiptNumber,
            amount: amount,
            balance_remaining: remainingAmount
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error processing payment:', error);
        res.status(500).json({ error: 'Error processing payment' });
    } finally {
        client.release();
    }
}

// ==================== M-PESA INTEGRATION ====================

// Initiate STK Push (M-Pesa Express)
async function initiateSTKPush(req, res) {
    const { phone_number, amount, student_id } = req.body;

    try {
        // Get student details
        const student = await pool.query(`
            SELECT s.admission_number, u.first_name, u.last_name
            FROM students s
            JOIN users u ON s.user_id = u.id
            WHERE s.id = $1
        `, [student_id]);

        if (!student.rows[0]) {
            return res.status(404).json({ error: 'Student not found' });
        }

        // Format phone number (remove 0 or +254)
        let formattedPhone = phone_number;
        if (formattedPhone.startsWith('0')) {
            formattedPhone = '254' + formattedPhone.substring(1);
        } else if (formattedPhone.startsWith('+')) {
            formattedPhone = formattedPhone.substring(1);
        }

        // Prepare STK Push payload
        const timestamp = moment().format('YYYYMMDDHHmmss');
        const password = Buffer.from(
            `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`
        ).toString('base64');

        const payload = {
            BusinessShortCode: process.env.MPESA_SHORTCODE,
            Password: password,
            Timestamp: timestamp,
            TransactionType: 'CustomerPayBillOnline',
            Amount: amount,
            PartyA: formattedPhone,
            PartyB: process.env.MPESA_SHORTCODE,
            PhoneNumber: formattedPhone,
            CallBackURL: `${process.env.BASE_URL}/api/fees/mpesa-callback`,
            AccountReference: student.rows[0].admission_number,
            TransactionDesc: `School Fees Payment - ${student.rows[0].first_name} ${student.rows[0].last_name}`
        };

        // Call M-Pesa API
        const response = await axios.post(
            'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
            payload,
            {
                headers: {
                    Authorization: `Bearer ${await getMpesaToken()}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        // Save transaction record
        await pool.query(`
            INSERT INTO mpesa_transactions (
                school_id, transaction_id, phone_number, amount, account_number,
                status, payment_method, shortcode
            ) VALUES ($1, $2, $3, $4, $5, 'pending', 'stk_push', $6)
        `, [req.user.school_id, response.data.CheckoutRequestID, phone_number,
            amount, student.rows[0].admission_number, process.env.MPESA_SHORTCODE]);

        res.json({
            message: 'STK Push initiated successfully',
            checkout_request_id: response.data.CheckoutRequestID,
            response_code: response.data.ResponseCode
        });

    } catch (error) {
        console.error('STK Push error:', error);
        res.status(500).json({ error: 'Failed to initiate STK Push' });
    }
}

// M-Pesa Callback Handler
async function mpesaCallback(req, res) {
    const { Body } = req.body;

    try {
        const { stkCallback } = Body;
        const { ResultCode, ResultDesc, CheckoutRequestID, CallbackMetadata } = stkCallback;

        // Update transaction status
        await pool.query(`
            UPDATE mpesa_transactions 
            SET status = $1, result_code = $2, result_desc = $3, callback_data = $4,
                processed_at = CURRENT_TIMESTAMP
            WHERE transaction_id = $5
        `, [ResultCode === 0 ? 'completed' : 'failed', ResultCode, ResultDesc, 
            JSON.stringify(Body), CheckoutRequestID]);

        if (ResultCode === 0) {
            // Extract payment details
            const metadata = {};
            CallbackMetadata.Item.forEach(item => {
                metadata[item.Name] = item.Value;
            });

            const mpesaReceipt = metadata.MpesaReceiptNumber;
            const amount = metadata.Amount;
            const phoneNumber = metadata.PhoneNumber;

            // Get student by account number
            const transaction = await pool.query(`
                SELECT account_number FROM mpesa_transactions 
                WHERE transaction_id = $1
            `, [CheckoutRequestID]);

            if (transaction.rows[0]) {
                const student = await pool.query(`
                    SELECT s.id FROM students s
                    WHERE s.admission_number = $1
                `, [transaction.rows[0].account_number]);

                if (student.rows[0]) {
                    // Process the payment automatically
                    const paymentReq = {
                        body: {
                            student_id: student.rows[0].id,
                            amount: amount,
                            payment_method: 'mpesa',
                            mpesa_code: mpesaReceipt,
                            reference: CheckoutRequestID
                        },
                        user: { id: 1, school_id: transaction.rows[0].school_id }
                    };
                    
                    await processPayment(paymentReq, {
                        json: () => {},
                        status: () => ({ json: () => {} })
                    });
                }
            }
        }

        res.json({ ResultCode: 0, ResultDesc: 'Success' });
    } catch (error) {
        console.error('M-Pesa callback error:', error);
        res.json({ ResultCode: 1, ResultDesc: 'Failed' });
    }
}

// Get M-Pesa Access Token
async function getMpesaToken() {
    const auth = Buffer.from(
        `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
    ).toString('base64');

    const response = await axios.get(
        'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
        {
            headers: { Authorization: `Basic ${auth}` }
        }
    );

    return response.data.access_token;
}

// ==================== REPORTS ====================

// Get fee collection report
async function getFeeCollectionReport(req, res) {
    const { start_date, end_date, class_id, format } = req.query;

    try {
        let query = `
            SELECT 
                p.payment_date,
                p.amount,
                p.payment_method,
                p.receipt_number,
                u.first_name,
                u.last_name,
                u.admission_number,
                c.name as class_name,
                p.reference
            FROM payments p
            JOIN students s ON p.student_id = s.id
            JOIN users u ON s.user_id = u.id
            JOIN classes c ON s.class_id = c.id
            WHERE p.school_id = $1
        `;
        const params = [req.user.school_id];
        let paramCount = 2;

        if (start_date) {
            query += ` AND p.payment_date >= $${paramCount}`;
            params.push(start_date);
            paramCount++;
        }
        if (end_date) {
            query += ` AND p.payment_date <= $${paramCount}`;
            params.push(end_date);
            paramCount++;
        }
        if (class_id) {
            query += ` AND s.class_id = $${paramCount}`;
            params.push(class_id);
            paramCount++;
        }

        query += ` ORDER BY p.payment_date DESC`;

        const result = await pool.query(query, params);

        // Calculate summary
        const summary = {
            total_collected: result.rows.reduce((sum, p) => sum + parseFloat(p.amount), 0),
            total_transactions: result.rows.length,
            by_method: {},
            by_class: {}
        };

        result.rows.forEach(p => {
            summary.by_method[p.payment_method] = (summary.by_method[p.payment_method] || 0) + parseFloat(p.amount);
            summary.by_class[p.class_name] = (summary.by_class[p.class_name] || 0) + parseFloat(p.amount);
        });

        if (format === 'csv') {
            const csv = result.rows.map(row => 
                `${row.payment_date},${row.admission_number},${row.first_name} ${row.last_name},${row.class_name},${row.amount},${row.payment_method},${row.receipt_number}`
            ).join('\n');
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=fee_report_${start_date}_to_${end_date}.csv`);
            res.send(`Date,Admission Number,Student Name,Class,Amount,Method,Receipt Number\n${csv}`);
        } else {
            res.json({ payments: result.rows, summary });
        }
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ error: 'Error generating report' });
    }
}

// Get defaulters list
async function getDefaulters(req, res) {
    const { class_id, days_overdue } = req.query;

    try {
        const query = `
            SELECT 
                s.id as student_id,
                u.first_name,
                u.last_name,
                u.phone,
                u.email,
                u.admission_number,
                c.name as class_name,
                COALESCE(SUM(sf.balance), 0) as total_balance,
                COUNT(sf.id) as overdue_items,
                MIN(sf.due_date) as oldest_due_date,
                EXTRACT(DAY FROM (CURRENT_DATE - MIN(sf.due_date))) as days_overdue
            FROM students s
            JOIN users u ON s.user_id = u.id
            JOIN classes c ON s.class_id = c.id
            JOIN student_fees sf ON s.id = sf.student_id
            WHERE sf.balance > 0 
                AND sf.due_date < CURRENT_DATE
                AND u.school_id = $1
            ${class_id ? 'AND s.class_id = $2' : ''}
            GROUP BY s.id, u.id, c.id
            HAVING SUM(sf.balance) > 0
            ORDER BY total_balance DESC
        `;

        const params = [req.user.school_id];
        if (class_id) params.push(class_id);

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching defaulters:', error);
        res.status(500).json({ error: 'Error fetching defaulters' });
    }
}

// Get dashboard statistics
async function getFeeDashboardStats(req, res) {
    try {
        // Today's collection
        const today = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) as total
            FROM payments
            WHERE school_id = $1 AND payment_date = CURRENT_DATE
        `, [req.user.school_id]);

        // Month to date
        const monthToDate = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) as total
            FROM payments
            WHERE school_id = $1 
                AND payment_date >= DATE_TRUNC('month', CURRENT_DATE)
        `, [req.user.school_id]);

        // Year to date
        const yearToDate = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) as total
            FROM payments
            WHERE school_id = $1 
                AND payment_date >= DATE_TRUNC('year', CURRENT_DATE)
        `, [req.user.school_id]);

        // Collection rate
        const collectionRate = await pool.query(`
            SELECT 
                COALESCE(SUM(sf.discounted_amount), 0) as expected,
                COALESCE(SUM(sf.paid_amount), 0) as collected,
                CASE 
                    WHEN COALESCE(SUM(sf.discounted_amount), 0) > 0 
                    THEN (COALESCE(SUM(sf.paid_amount), 0) / COALESCE(SUM(sf.discounted_amount), 0)) * 100
                    ELSE 0
                END as rate
            FROM student_fees sf
            JOIN students s ON sf.student_id = s.id
            JOIN users u ON s.user_id = u.id
            WHERE u.school_id = $1
        `, [req.user.school_id]);

        // Recent payments
        const recentPayments = await pool.query(`
            SELECT p.*, u.first_name, u.last_name, u.admission_number
            FROM payments p
            JOIN students s ON p.student_id = s.id
            JOIN users u ON s.user_id = u.id
            WHERE p.school_id = $1
            ORDER BY p.created_at DESC
            LIMIT 10
        `, [req.user.school_id]);

        // Defaulters count
        const defaulters = await pool.query(`
            SELECT COUNT(DISTINCT s.id) as count
            FROM students s
            JOIN student_fees sf ON s.id = sf.student_id
            WHERE sf.balance > 0 AND sf.due_date < CURRENT_DATE
        `);

        res.json({
            today_collection: parseFloat(today.rows[0].total),
            month_to_date: parseFloat(monthToDate.rows[0].total),
            year_to_date: parseFloat(yearToDate.rows[0].total),
            collection_rate: parseFloat(collectionRate.rows[0].rate),
            expected_amount: parseFloat(collectionRate.rows[0].expected),
            collected_amount: parseFloat(collectionRate.rows[0].collected),
            defaulters_count: parseInt(defaulters.rows[0].count),
            recent_payments: recentPayments.rows
        });
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        res.status(500).json({ error: 'Error fetching dashboard stats' });
    }
}

// ==================== EXPENSES ====================

// Record expense
async function recordExpense(req, res) {
    const {
        category_id, expense_category, expense_subcategory, amount,
        description, vendor_name, vendor_phone, invoice_number, receipt_url
    } = req.body;

    try {
        const result = await pool.query(`
            INSERT INTO expenses (
                school_id, category_id, expense_category, expense_subcategory,
                amount, expense_date, description, vendor_name, vendor_phone,
                invoice_number, receipt_url, recorded_by, status
            ) VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, $7, $8, $9, $10, $11, 'pending')
            RETURNING *
        `, [req.user.school_id, category_id, expense_category, expense_subcategory,
            amount, description, vendor_name, vendor_phone, invoice_number,
            receipt_url, req.user.id]);

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error recording expense:', error);
        res.status(500).json({ error: 'Error recording expense' });
    }
}

// ==================== DISCOUNTS & WAIVERS ====================

// Apply discount to student
async function applyDiscount(req, res) {
    const { student_id, discount_id, student_fee_id } = req.body;

    try {
        const discount = await pool.query(`
            SELECT * FROM fee_discounts WHERE id = $1 AND is_active = true
        `, [discount_id]);

        if (!discount.rows[0]) {
            return res.status(404).json({ error: 'Discount not found' });
        }

        const studentFee = await pool.query(`
            SELECT * FROM student_fees WHERE id = $1
        `, [student_fee_id]);

        if (!studentFee.rows[0]) {
            return res.status(404).json({ error: 'Student fee record not found' });
        }

        const discountValue = discount.rows[0].discount_type === 'percentage'
            ? studentFee.rows[0].original_amount * (discount.rows[0].discount_value / 100)
            : discount.rows[0].discount_value;

        const newAmount = studentFee.rows[0].original_amount - discountValue;

        await pool.query(`
            UPDATE student_fees 
            SET discount_id = $1,
                discounted_amount = $2,
                balance = $2 - paid_amount,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
        `, [discount_id, newAmount, student_fee_id]);

        res.json({ message: 'Discount applied successfully', new_amount: newAmount });
    } catch (error) {
        console.error('Error applying discount:', error);
        res.status(500).json({ error: 'Error applying discount' });
    }
}

// Add to backend/src/controllers/feeController.js

// Get accountant dashboard data
async function getAccountantDashboard(req, res) {
    try {
        // Today's collection
        const today = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) as total
            FROM payments
            WHERE school_id = $1 AND payment_date = CURRENT_DATE AND status = 'completed'
        `, [req.user.school_id]);
        
        // Month to date
        const month = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) as total
            FROM payments
            WHERE school_id = $1 
                AND payment_date >= DATE_TRUNC('month', CURRENT_DATE)
                AND status = 'completed'
        `, [req.user.school_id]);
        
        // Year to date
        const year = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) as total
            FROM payments
            WHERE school_id = $1 
                AND payment_date >= DATE_TRUNC('year', CURRENT_DATE)
                AND status = 'completed'
        `, [req.user.school_id]);
        
        // Collection rate
        const rate = await pool.query(`
            SELECT 
                COALESCE(SUM(sf.discounted_amount), 0) as expected,
                COALESCE(SUM(sf.paid_amount), 0) as collected
            FROM student_fees sf
            JOIN students s ON sf.student_id = s.id
            JOIN users u ON s.user_id = u.id
            WHERE u.school_id = $1
        `, [req.user.school_id]);
        
        const collectionRate = rate.rows[0].expected > 0 
            ? (rate.rows[0].collected / rate.rows[0].expected) * 100 
            : 0;
        
        // Defaulters count
        const defaulters = await pool.query(`
            SELECT COUNT(DISTINCT s.id) as count
            FROM students s
            JOIN student_fees sf ON s.id = sf.student_id
            WHERE sf.balance > 0 AND sf.due_date < CURRENT_DATE
        `);
        
        // Recent payments
        const recent = await pool.query(`
            SELECT p.*, u.first_name, u.last_name, u.admission_number, c.name as class_name
            FROM payments p
            JOIN students s ON p.student_id = s.id
            JOIN users u ON s.user_id = u.id
            JOIN classes c ON s.class_id = c.id
            WHERE p.school_id = $1
            ORDER BY p.created_at DESC
            LIMIT 10
        `, [req.user.school_id]);
        
        // Payment trends (last 30 days)
        const trends = await pool.query(`
            SELECT 
                TO_CHAR(payment_date, 'Mon DD') as date,
                COALESCE(SUM(amount), 0) as amount
            FROM payments
            WHERE school_id = $1 AND payment_date >= CURRENT_DATE - INTERVAL '30 days'
            GROUP BY payment_date
            ORDER BY payment_date
        `, [req.user.school_id]);
        
        // Class collection summary
        const classCollection = await pool.query(`
            SELECT 
                c.name as class_name,
                COUNT(DISTINCT s.id) as student_count,
                COALESCE(SUM(sf.discounted_amount), 0) as expected,
                COALESCE(SUM(sf.paid_amount), 0) as collected,
                COALESCE(SUM(sf.balance), 0) as balance,
                CASE 
                    WHEN COALESCE(SUM(sf.discounted_amount), 0) > 0 
                    THEN (COALESCE(SUM(sf.paid_amount), 0) / COALESCE(SUM(sf.discounted_amount), 0)) * 100
                    ELSE 0
                END as rate
            FROM classes c
            LEFT JOIN students s ON c.id = s.class_id
            LEFT JOIN student_fees sf ON s.id = sf.student_id
            WHERE c.school_id = $1
            GROUP BY c.id, c.name
        `, [req.user.school_id]);
        
        res.json({
            total_collected_today: parseFloat(today.rows[0].total),
            total_collected_month: parseFloat(month.rows[0].total),
            total_collected_year: parseFloat(year.rows[0].total),
            collection_rate: Math.round(collectionRate),
            expected_amount: parseFloat(rate.rows[0].expected),
            collected_amount: parseFloat(rate.rows[0].collected),
            defaulters_count: parseInt(defaulters.rows[0].count),
            recent_payments: recent.rows,
            payment_trends: trends.rows,
            class_collection: classCollection.rows
        });
    } catch (error) {
        console.error('Error fetching accountant dashboard:', error);
        res.status(500).json({ error: 'Error fetching dashboard data' });
    }
}

// Get defaulters list
async function getDefaulters(req, res) {
    try {
        const result = await pool.query(`
            SELECT 
                s.id as student_id,
                u.first_name || ' ' || u.last_name as student_name,
                u.admission_number,
                c.name as class_name,
                COALESCE(SUM(sf.balance), 0) as balance,
                MIN(sf.due_date) as oldest_due_date,
                EXTRACT(DAY FROM (CURRENT_DATE - MIN(sf.due_date))) as days_overdue
            FROM students s
            JOIN users u ON s.user_id = u.id
            JOIN classes c ON s.class_id = c.id
            JOIN student_fees sf ON s.id = sf.student_id
            WHERE sf.balance > 0 AND sf.due_date < CURRENT_DATE
                AND u.school_id = $1
            GROUP BY s.id, u.id, c.id
            HAVING SUM(sf.balance) > 0
            ORDER BY balance DESC
        `, [req.user.school_id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching defaulters:', error);
        res.status(500).json({ error: 'Error fetching defaulters' });
    }
}

// Send reminder to defaulter
async function sendReminder(req, res) {
    const { student_id } = req.body;
    
    try {
        // Get student details
        const student = await pool.query(`
            SELECT u.phone, u.email, u.first_name, u.last_name,
                   COALESCE(SUM(sf.balance), 0) as balance
            FROM students s
            JOIN users u ON s.user_id = u.id
            JOIN student_fees sf ON s.id = sf.student_id
            WHERE s.id = $1
            GROUP BY u.id
        `, [student_id]);
        
        if (student.rows.length === 0) {
            return res.status(404).json({ error: 'Student not found' });
        }
        
        const message = `Dear Parent, your child ${student.rows[0].first_name} ${student.rows[0].last_name} has an outstanding fee balance of KES ${student.rows[0].balance.toLocaleString()}. Please clear the balance to avoid penalties.`;
        
        // Send SMS (integrate with SMS provider)
        // await sendSMS(student.rows[0].phone, message);
        
        // Send Email
        // await sendEmail(student.rows[0].email, 'Fee Payment Reminder', message);
        
        res.json({ message: 'Reminder sent successfully' });
    } catch (error) {
        console.error('Error sending reminder:', error);
        res.status(500).json({ error: 'Error sending reminder' });
    }
}

// Record manual payment
async function recordManualPayment(req, res) {
    const { student_id, amount, payment_method, notes } = req.body;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const receiptNumber = `RCP${Date.now()}${Math.floor(Math.random() * 1000)}`;
        
        // Insert payment
        const payment = await client.query(`
            INSERT INTO payments (school_id, student_id, amount, payment_date, payment_method, receipt_number, notes, status, recorded_by)
            VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, $6, 'completed', $7)
            RETURNING id
        `, [req.user.school_id, student_id, amount, payment_method, receiptNumber, notes, req.user.id]);
        
        // Update student fees
        const fees = await client.query(`
            SELECT id, balance FROM student_fees
            WHERE student_id = $1 AND balance > 0
            ORDER BY due_date ASC
        `, [student_id]);
        
        let remainingAmount = amount;
        
        for (const fee of fees.rows) {
            if (remainingAmount <= 0) break;
            
            const allocationAmount = Math.min(remainingAmount, parseFloat(fee.balance));
            
            await client.query(`
                INSERT INTO payment_allocations (payment_id, student_fee_id, amount)
                VALUES ($1, $2, $3)
            `, [payment.rows[0].id, fee.id, allocationAmount]);
            
            await client.query(`
                UPDATE student_fees 
                SET paid_amount = paid_amount + $1,
                    balance = balance - $1,
                    status = CASE 
                        WHEN balance - $1 <= 0 THEN 'paid'
                        WHEN balance - $1 < discounted_amount THEN 'partial'
                        ELSE status
                    END
                WHERE id = $2
            `, [allocationAmount, fee.id]);
            
            remainingAmount -= allocationAmount;
        }
        
        await client.query('COMMIT');
        
        res.json({ message: 'Payment recorded successfully', receipt_number: receiptNumber });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error recording payment:', error);
        res.status(500).json({ error: 'Error recording payment' });
    } finally {
        client.release();
    }
}

module.exports = {
    createFeeStructure,
    getFeeStructures,
    assignFeesToStudents,
    getStudentFeeBalance,
    processPayment,
    initiateSTKPush,
    mpesaCallback,
    getFeeCollectionReport,
    getDefaulters,
    getFeeDashboardStats,
    recordExpense,
    applyDiscount
};