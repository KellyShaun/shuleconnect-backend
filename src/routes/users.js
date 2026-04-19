// backend/src/routes/users.js
const express = require('express');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const {
    getUsers,
    getUserById,
    createUser,
    updateUser,
    deactivateUser,
    resetPassword,
    getDashboardData
} = require('../controllers/userController');

const router = express.Router();

// Get all users (with role-based filtering)
// Access: Admin, Teacher (limited), Parent (children only), Student (self only)
router.get('/', authenticateToken, getUsers);

// Get dashboard data for current user (role-specific dashboard)
// Access: All authenticated users
router.get('/dashboard', authenticateToken, getDashboardData);

// Get single user by ID with full details
// Access: Admin or the user themselves
router.get('/:id', authenticateToken, getUserById);

// Create new user (Admin only)
// Access: Super Admin, School Admin
router.post('/', authenticateToken, authorizeRole('super_admin', 'school_admin'), createUser);

// Update user information
// Access: Super Admin, School Admin
router.put('/:id', authenticateToken, authorizeRole('super_admin', 'school_admin'), updateUser);

// Deactivate user (soft delete)
// Access: Super Admin, School Admin
router.delete('/:id', authenticateToken, authorizeRole('super_admin', 'school_admin'), deactivateUser);

// Reset user password
// Access: Super Admin, School Admin
router.post('/:id/reset-password', authenticateToken, authorizeRole('super_admin', 'school_admin'), resetPassword);

module.exports = router;