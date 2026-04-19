const express = require('express');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const {
    getBooks,
    getBookById,
    createBook,
    updateBook,
    deleteBook,
    getUserBorrowingSummary,
    issueBook,
    returnBook,
    getLibraryDashboard,
    getLibraryUsers,
    searchBookByBarcode,
    payFine,
    getCategories,
    createCategory
    // Temporarily remove these until controller is updated
    // getLibrarianDashboard,
    // getLibraryMembers,
    // getBorrowings,
    // renewBook,
    // sendOverdueReminder
} = require('../controllers/libraryController');

const router = express.Router();

// Categories
router.get('/categories', authenticateToken, getCategories);
router.post('/categories', authenticateToken, authorizeRole('school_admin', 'librarian'), createCategory);

// Books
router.get('/books', authenticateToken, getBooks);
router.get('/books/:id', authenticateToken, getBookById);
router.post('/books', authenticateToken, authorizeRole('school_admin', 'librarian'), createBook);
router.put('/books/:id', authenticateToken, authorizeRole('school_admin', 'librarian'), updateBook);
router.delete('/books/:id', authenticateToken, authorizeRole('school_admin', 'librarian'), deleteBook);

// Borrowing
router.get('/user/:user_id/borrowings', authenticateToken, getUserBorrowingSummary);
router.post('/issue', authenticateToken, authorizeRole('school_admin', 'librarian'), issueBook);
router.post('/return', authenticateToken, authorizeRole('school_admin', 'librarian'), returnBook);

// Fines
router.post('/fines/:fine_id/pay', authenticateToken, payFine);

// Dashboard
router.get('/dashboard', authenticateToken, getLibraryDashboard);

// Comment out the problematic routes for now
// router.get('/librarian/dashboard', authenticateToken, getLibrarianDashboard);
// router.get('/members', authenticateToken, getLibraryMembers);
// router.get('/borrowings', authenticateToken, getBorrowings);
// router.post('/renew/:id', authenticateToken, renewBook);
// router.post('/reminder/:id', authenticateToken, sendOverdueReminder);

// Members & Users
router.get('/users', authenticateToken, getLibraryUsers);

// Search
router.get('/search', authenticateToken, searchBookByBarcode);

module.exports = router;