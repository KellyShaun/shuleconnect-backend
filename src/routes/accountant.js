const express = require('express');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const router = express.Router();

// Get accountant dashboard statistics
router.get('/dashboard', authenticateToken, async (req, res) => {
    try {
        // Return mock data for now
        res.json({
            totalFeesCollected: 12500000,
            expectedFees: 15700000,
            pendingFees: 3200000,
            totalStudents: 1247,
            collectionRate: 79.6,
            thisMonthCollection: 2340000,
            recentPayments: [
                { id: 1, student: 'John Kamau', amount: 45000, date: '2024-03-15', status: 'paid', method: 'M-Pesa', receipt: 'RCP001' },
                { id: 2, student: 'Mary Wanjiku', amount: 45000, date: '2024-03-14', status: 'paid', method: 'Bank Transfer', receipt: 'RCP002' }
            ],
            feeCollectionData: [
                { month: 'Jan', collected: 850000, target: 1200000 },
                { month: 'Feb', collected: 920000, target: 1200000 },
                { month: 'Mar', collected: 1100000, target: 1200000 }
            ],
            paymentMethods: [
                { name: 'M-Pesa', value: 45, color: '#4CAF50' },
                { name: 'Bank Transfer', value: 30, color: '#2196F3' },
                { name: 'Cash', value: 20, color: '#FF9800' }
            ]
        });
    } catch (error) {
        console.error('Error fetching accountant dashboard:', error);
        res.status(500).json({ error: 'Error fetching dashboard data' });
    }
});

// Get fee structure
router.get('/fee-structure', authenticateToken, async (req, res) => {
    try {
        res.json([
            { id: 1, fee_type: 'Tuition Fee', amount: 25000, class_level: 'All Classes', term: 'Term 1', is_mandatory: true },
            { id: 2, fee_type: 'Activity Fee', amount: 5000, class_level: 'All Classes', term: 'Term 1', is_mandatory: true },
            { id: 3, fee_type: 'Library Fee', amount: 3000, class_level: 'All Classes', term: 'Term 1', is_mandatory: true }
        ]);
    } catch (error) {
        console.error('Error fetching fee structure:', error);
        res.status(500).json({ error: 'Error fetching fee structure' });
    }
});

// Save fee structure
router.post('/fee-structure', authenticateToken, authorizeRole('accountant', 'school_admin'), async (req, res) => {
    try {
        res.status(201).json({ message: 'Fee structure saved successfully', data: req.body });
    } catch (error) {
        console.error('Error saving fee structure:', error);
        res.status(500).json({ error: 'Error saving fee structure' });
    }
});

// Get students for fee collection
router.get('/students', authenticateToken, async (req, res) => {
    try {
        res.json([
            { id: 1, name: 'John Kamau', admission_no: 'STU2024001', class: 'Form 4A', total_fees: 45000, paid: 45000, balance: 0, status: 'paid' },
            { id: 2, name: 'Mary Wanjiku', admission_no: 'STU2024002', class: 'Form 4A', total_fees: 45000, paid: 30000, balance: 15000, status: 'partial' },
            { id: 3, name: 'James Otieno', admission_no: 'STU2024003', class: 'Form 3B', total_fees: 45000, paid: 20000, balance: 25000, status: 'partial' }
        ]);
    } catch (error) {
        console.error('Error fetching students:', error);
        res.status(500).json({ error: 'Error fetching students' });
    }
});

// Record payment
router.post('/payments', authenticateToken, authorizeRole('accountant', 'school_admin'), async (req, res) => {
    try {
        res.status(201).json({ 
            message: 'Payment recorded successfully', 
            receipt_no: `RCP${Date.now()}`,
            payment: req.body 
        });
    } catch (error) {
        console.error('Error recording payment:', error);
        res.status(500).json({ error: 'Error recording payment' });
    }
});

// Get payments history
router.get('/payments', authenticateToken, async (req, res) => {
    try {
        res.json([
            { id: 1, student: 'John Kamau', amount: 45000, date: '2024-03-15', status: 'paid', method: 'M-Pesa', receipt: 'RCP001' },
            { id: 2, student: 'Mary Wanjiku', amount: 45000, date: '2024-03-14', status: 'paid', method: 'Bank Transfer', receipt: 'RCP002' },
            { id: 3, student: 'James Otieno', amount: 20000, date: '2024-03-10', status: 'paid', method: 'Cash', receipt: 'RCP003' }
        ]);
    } catch (error) {
        console.error('Error fetching payments:', error);
        res.status(500).json({ error: 'Error fetching payments' });
    }
});

// Get fee defaulters
router.get('/defaulters', authenticateToken, async (req, res) => {
    try {
        res.json([
            { id: 1, name: 'James Otieno', admission_no: 'STU2024003', class: 'Form 3B', balance: 25000, days_overdue: 15 },
            { id: 2, name: 'Sarah Muthoni', admission_no: 'STU2024004', class: 'Form 3B', balance: 45000, days_overdue: 30 }
        ]);
    } catch (error) {
        console.error('Error fetching defaulters:', error);
        res.status(500).json({ error: 'Error fetching defaulters' });
    }
});

// Get financial reports
router.get('/reports', authenticateToken, async (req, res) => {
    try {
        const { type, month, year } = req.query;
        res.json({
            summary: {
                total_income: 12500000,
                total_expenses: 5200000,
                net_profit: 7300000
            },
            transactions: [
                { id: 1, date: '2024-03-15', description: 'Fee Payment', type: 'Income', amount: 45000, category: 'Tuition Fee' },
                { id: 2, date: '2024-03-14', description: 'Salary Payment', type: 'Expense', amount: 350000, category: 'Salaries' }
            ],
            chart_data: [
                { month: 'Jan', income: 850000, expenses: 450000 },
                { month: 'Feb', income: 920000, expenses: 480000 },
                { month: 'Mar', income: 1100000, expenses: 500000 }
            ]
        });
    } catch (error) {
        console.error('Error fetching reports:', error);
        res.status(500).json({ error: 'Error fetching reports' });
    }
});

module.exports = router;