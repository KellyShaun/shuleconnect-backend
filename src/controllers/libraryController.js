const { Pool } = require('pg');
const QRCode = require('qrcode');
const moment = require('moment');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

// Helper Functions
function generateBarcode(bookId, copyNumber) {
    const year = new Date().getFullYear();
    return `LIB${String(bookId).padStart(6, '0')}${String(copyNumber).padStart(3, '0')}`;
}

function generateAccessionNumber() {
    const year = new Date().getFullYear();
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `ACC/${year}/${random}`;
}

// ==================== BOOK CATEGORIES ====================

async function getCategories(req, res) {
    try {
        const result = await pool.query(`
            SELECT * FROM book_categories 
            WHERE school_id = $1 AND is_active = true
            ORDER BY category_name
        `, [req.user.school_id]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ error: 'Error fetching categories' });
    }
}

async function createCategory(req, res) {
    const { category_name, category_code, dewey_range, description } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO book_categories (school_id, category_name, category_code, dewey_range, description)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `, [req.user.school_id, category_name, category_code, dewey_range, description]);
        
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creating category:', error);
        res.status(500).json({ error: 'Error creating category' });
    }
}

// ==================== BOOK MANAGEMENT ====================

async function getBooks(req, res) {
    const { search, category, page = 1, limit = 20 } = req.query;
    
    try {
        let query = `
            SELECT b.*, bc.category_name,
                   (SELECT COUNT(*) FROM book_copies WHERE book_id = b.id) as total_copies_actual,
                   (SELECT COUNT(*) FROM book_copies WHERE book_id = b.id AND status = 'available') as available_copies_actual
            FROM books b
            LEFT JOIN book_categories bc ON b.category_id = bc.id
            WHERE b.school_id = $1 AND b.is_active = true
        `;
        
        const params = [req.user.school_id];
        let paramCount = 2;
        
        if (search) {
            query += ` AND (b.title ILIKE $${paramCount} OR b.author ILIKE $${paramCount} OR b.isbn ILIKE $${paramCount})`;
            params.push(`%${search}%`);
            paramCount++;
        }
        
        if (category) {
            query += ` AND b.category_id = $${paramCount}`;
            params.push(category);
            paramCount++;
        }
        
        query += ` ORDER BY b.created_at DESC`;
        
        // Get total count
        const countQuery = query.replace(
            "SELECT b.*, bc.category_name, (SELECT COUNT(*) FROM book_copies WHERE book_id = b.id) as total_copies_actual, (SELECT COUNT(*) FROM book_copies WHERE book_id = b.id AND status = 'available') as available_copies_actual",
            'SELECT COUNT(*) as total'
        );
        const countResult = await pool.query(countQuery, params);
        const total = parseInt(countResult.rows[0].total);
        
        // Add pagination
        const offset = (page - 1) * limit;
        query += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(limit, offset);
        
        const result = await pool.query(query, params);
        
        res.json({
            books: result.rows,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching books:', error);
        res.status(500).json({ error: 'Error fetching books' });
    }
}

async function getBookById(req, res) {
    const { id } = req.params;
    
    try {
        const result = await pool.query(`
            SELECT b.*, bc.category_name,
                   COALESCE(
                       (SELECT json_agg(jsonb_build_object(
                           'id', bc2.id,
                           'copy_number', bc2.copy_number,
                           'barcode', bc2.barcode,
                           'qr_code', bc2.qr_code,
                           'condition', bc2.condition,
                           'status', bc2.status
                       )) FROM book_copies bc2 WHERE bc2.book_id = b.id),
                       '[]'
                   ) as copies
            FROM books b
            LEFT JOIN book_categories bc ON b.category_id = bc.id
            WHERE b.id = $1 AND b.school_id = $2
        `, [id, req.user.school_id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Book not found' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error fetching book:', error);
        res.status(500).json({ error: 'Error fetching book' });
    }
}

async function createBook(req, res) {
    const {
        title, author, isbn, publisher, edition, publication_year,
        category_id, language, pages, summary,
        location_shelf, location_row, location_section,
        purchase_price, purchase_date, total_copies,
        is_reference_only
    } = req.body;
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const accessionNumber = generateAccessionNumber();
        
        // Create book
        const bookResult = await client.query(`
            INSERT INTO books (
                school_id, title, author, isbn, publisher, edition, publication_year,
                category_id, language, pages, summary, accession_number,
                location_shelf, location_row, location_section,
                purchase_price, purchase_date, total_copies, available_copies,
                is_reference_only
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
            RETURNING id
        `, [req.user.school_id, title, author, isbn, publisher, edition, publication_year,
            category_id, language, pages, summary, accessionNumber,
            location_shelf, location_row, location_section,
            purchase_price, purchase_date, total_copies, total_copies,
            is_reference_only || false]);
        
        const bookId = bookResult.rows[0].id;
        
        // Create individual copies
        for (let i = 1; i <= total_copies; i++) {
            const barcode = generateBarcode(bookId, i);
            const qrCode = await QRCode.toDataURL(barcode);
            
            await client.query(`
                INSERT INTO book_copies (book_id, copy_number, barcode, qr_code, condition, status)
                VALUES ($1, $2, $3, $4, 'good', 'available')
            `, [bookId, i, barcode, qrCode]);
        }
        
        await client.query('COMMIT');
        
        res.status(201).json({
            message: 'Book created successfully',
            book_id: bookId,
            accession_number: accessionNumber
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error creating book:', error);
        res.status(500).json({ error: 'Error creating book: ' + error.message });
    } finally {
        client.release();
    }
}

async function updateBook(req, res) {
    const { id } = req.params;
    const updates = req.body;
    
    try {
        const allowedFields = ['title', 'author', 'isbn', 'publisher', 'edition', 'publication_year', 
                               'category_id', 'language', 'pages', 'summary', 'location_shelf', 
                               'location_row', 'location_section', 'is_reference_only'];
        
        const setClause = [];
        const values = [];
        let paramCount = 1;
        
        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                setClause.push(`${field} = $${paramCount}`);
                values.push(updates[field]);
                paramCount++;
            }
        }
        
        if (setClause.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }
        
        values.push(id, req.user.school_id);
        
        const query = `
            UPDATE books 
            SET ${setClause.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE id = $${paramCount} AND school_id = $${paramCount + 1}
            RETURNING *
        `;
        
        const result = await pool.query(query, values);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Book not found' });
        }
        
        res.json({ message: 'Book updated successfully', book: result.rows[0] });
    } catch (error) {
        console.error('Error updating book:', error);
        res.status(500).json({ error: 'Error updating book' });
    }
}

async function deleteBook(req, res) {
    const { id } = req.params;
    
    try {
        const result = await pool.query(`
            UPDATE books SET is_active = false WHERE id = $1 AND school_id = $2
            RETURNING id
        `, [id, req.user.school_id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Book not found' });
        }
        
        res.json({ message: 'Book deleted successfully' });
    } catch (error) {
        console.error('Error deleting book:', error);
        res.status(500).json({ error: 'Error deleting book' });
    }
}

// ==================== BORROWING & RETURNS ====================

async function getUserBorrowingSummary(req, res) {
    const { user_id } = req.params;
    
    try {
        // Get current borrowings
        const current = await pool.query(`
            SELECT b.*, bk.title, bk.author, bc.copy_number, bc.barcode,
                   EXTRACT(DAY FROM (CURRENT_DATE - b.due_date)) as days_overdue
            FROM borrowings b
            JOIN book_copies bc ON b.copy_id = bc.id
            JOIN books bk ON bc.book_id = bk.id
            WHERE b.user_id = $1 AND b.status = 'borrowed'
            ORDER BY b.due_date ASC
        `, [user_id]);
        
        // Get borrowing history
        const history = await pool.query(`
            SELECT b.*, bk.title, bk.author, bc.copy_number,
                   CASE WHEN b.returned_date IS NOT NULL THEN 'returned' ELSE 'borrowed' END as status
            FROM borrowings b
            JOIN book_copies bc ON b.copy_id = bc.id
            JOIN books bk ON bc.book_id = bk.id
            WHERE b.user_id = $1 AND b.status != 'borrowed'
            ORDER BY b.borrowed_date DESC
            LIMIT 20
        `, [user_id]);
        
        // Get fines
        const fines = await pool.query(`
            SELECT * FROM fines 
            WHERE user_id = $1 AND status = 'pending'
        `, [user_id]);
        
        const totalFines = fines.rows.reduce((sum, f) => sum + parseFloat(f.amount), 0);
        
        // Get settings
        const settings = await pool.query(`
            SELECT student_borrow_limit FROM library_settings WHERE school_id = $1
        `, [req.user.school_id]);
        
        const borrowLimit = settings.rows[0]?.student_borrow_limit || 3;
        
        res.json({
            current_borrowings: current.rows,
            borrowing_history: history.rows,
            pending_fines: fines.rows,
            total_fines: totalFines,
            borrow_limit: borrowLimit,
            remaining_limit: borrowLimit - current.rows.length
        });
    } catch (error) {
        console.error('Error fetching user borrowing summary:', error);
        res.status(500).json({ error: 'Error fetching borrowing summary' });
    }
}

async function issueBook(req, res) {
    const { barcode, user_id } = req.body;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Get book copy
        const copyResult = await client.query(`
            SELECT bc.*, bk.title, bk.is_reference_only, bk.school_id, bk.id as book_id
            FROM book_copies bc
            JOIN books bk ON bc.book_id = bk.id
            WHERE bc.barcode = $1 AND bc.status = 'available'
        `, [barcode]);
        
        if (copyResult.rows.length === 0) {
            return res.status(404).json({ error: 'Book not available or invalid barcode' });
        }
        
        const copy = copyResult.rows[0];
        
        // Check if reference only
        if (copy.is_reference_only) {
            return res.status(400).json({ error: 'Reference books cannot be borrowed' });
        }
        
        // Check user borrowing limit
        const currentBorrowings = await client.query(`
            SELECT COUNT(*) as count FROM borrowings 
            WHERE user_id = $1 AND status = 'borrowed'
        `, [user_id]);
        
        const settings = await client.query(`
            SELECT student_borrow_limit FROM library_settings WHERE school_id = $1
        `, [req.user.school_id]);
        
        const limit = settings.rows[0]?.student_borrow_limit || 3;
        
        if (parseInt(currentBorrowings.rows[0].count) >= limit) {
            return res.status(400).json({ error: `User has reached borrowing limit of ${limit} books` });
        }
        
        // Calculate due date
        const dueDate = moment().add(14, 'days').format('YYYY-MM-DD');
        
        // Create borrowing record
        await client.query(`
            INSERT INTO borrowings (copy_id, user_id, borrowed_date, due_date, status, issued_by)
            VALUES ($1, $2, CURRENT_DATE, $3, 'borrowed', $4)
        `, [copy.id, user_id, dueDate, req.user.id]);
        
        // Update copy status
        await client.query(`
            UPDATE book_copies SET status = 'borrowed' WHERE id = $1
        `, [copy.id]);
        
        // Update book available copies
        await client.query(`
            UPDATE books SET available_copies = available_copies - 1, borrowed_count = borrowed_count + 1
            WHERE id = $1
        `, [copy.book_id]);
        
        await client.query('COMMIT');
        
        res.json({
            message: 'Book issued successfully',
            due_date: dueDate,
            title: copy.title
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error issuing book:', error);
        res.status(500).json({ error: 'Error issuing book: ' + error.message });
    } finally {
        client.release();
    }
}

async function returnBook(req, res) {
    const { barcode, condition, notes } = req.body;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Get borrowing record
        const borrowingResult = await client.query(`
            SELECT b.*, bc.book_id, bc.copy_number, bk.title
            FROM borrowings b
            JOIN book_copies bc ON b.copy_id = bc.id
            JOIN books bk ON bc.book_id = bk.id
            WHERE bc.barcode = $1 AND b.status = 'borrowed'
        `, [barcode]);
        
        if (borrowingResult.rows.length === 0) {
            return res.status(404).json({ error: 'No active borrowing found for this book' });
        }
        
        const borrowing = borrowingResult.rows[0];
        
        // Calculate fine if overdue
        const dueDate = moment(borrowing.due_date);
        const today = moment();
        let fineAmount = 0;
        let daysOverdue = 0;
        
        if (today.isAfter(dueDate)) {
            daysOverdue = today.diff(dueDate, 'days');
            fineAmount = daysOverdue * 5;
        }
        
        // Update borrowing record
        await client.query(`
            UPDATE borrowings 
            SET returned_date = CURRENT_DATE, status = 'returned', notes = $1, returned_to = $2
            WHERE id = $3
        `, [notes, req.user.id, borrowing.id]);
        
        // Create fine if applicable
        if (fineAmount > 0) {
            await client.query(`
                INSERT INTO fines (borrowing_id, user_id, amount, daily_rate, days_overdue, reason, status)
                VALUES ($1, $2, $3, 5, $4, 'Overdue return', 'pending')
            `, [borrowing.id, borrowing.user_id, fineAmount, daysOverdue]);
        }
        
        // Update copy condition if changed
        if (condition && condition !== 'good') {
            await client.query(`
                UPDATE book_copies SET condition = $1, status = 'available' WHERE id = $2
            `, [condition, borrowing.copy_id]);
        } else {
            await client.query(`
                UPDATE book_copies SET status = 'available' WHERE id = $1
            `, [borrowing.copy_id]);
        }
        
        // Update book available copies
        await client.query(`
            UPDATE books SET available_copies = available_copies + 1 WHERE id = $1
        `, [borrowing.book_id]);
        
        await client.query('COMMIT');
        
        res.json({
            message: 'Book returned successfully',
            fine_amount: fineAmount,
            days_overdue: daysOverdue
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error returning book:', error);
        res.status(500).json({ error: 'Error returning book: ' + error.message });
    } finally {
        client.release();
    }
}

// ==================== DASHBOARD STATS ====================

async function getLibraryDashboard(req, res) {
    try {
        const todayIssued = await pool.query(`
            SELECT COUNT(*) as count FROM borrowings 
            WHERE borrowed_date = CURRENT_DATE
        `);
        
        const todayReturned = await pool.query(`
            SELECT COUNT(*) as count FROM borrowings 
            WHERE returned_date = CURRENT_DATE
        `);
        
        const overdueBooks = await pool.query(`
            SELECT COUNT(*) as count FROM borrowings 
            WHERE due_date < CURRENT_DATE AND status = 'borrowed'
        `);
        
        const pendingFines = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) as total FROM fines 
            WHERE status = 'pending'
        `);
        
        const availableBooks = await pool.query(`
            SELECT COALESCE(SUM(available_copies), 0) as count FROM books 
            WHERE school_id = $1 AND is_active = true
        `, [req.user.school_id]);
        
        const totalMembers = await pool.query(`
            SELECT COUNT(*) as count FROM users 
            WHERE school_id = $1 AND role IN ('student', 'teacher', 'staff') AND is_active = true
        `, [req.user.school_id]);
        
        const popularBooks = await pool.query(`
            SELECT bk.title, bk.author, COUNT(b.id) as borrow_count
            FROM borrowings b
            JOIN book_copies bc ON b.copy_id = bc.id
            JOIN books bk ON bc.book_id = bk.id
            WHERE bk.school_id = $1
            GROUP BY bk.id, bk.title, bk.author
            ORDER BY borrow_count DESC
            LIMIT 5
        `, [req.user.school_id]);
        
        res.json({
            today_issued: parseInt(todayIssued.rows[0].count),
            today_returned: parseInt(todayReturned.rows[0].count),
            overdue_books: parseInt(overdueBooks.rows[0].count),
            pending_fines: parseFloat(pendingFines.rows[0].total),
            available_books: parseInt(availableBooks.rows[0].count),
            total_members: parseInt(totalMembers.rows[0].count),
            popular_books: popularBooks.rows
        });
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        res.status(500).json({ error: 'Error fetching dashboard stats' });
    }
}

async function getLibraryUsers(req, res) {
    try {
        const result = await pool.query(`
            SELECT id, first_name, last_name, email, phone, role, 
                   admission_number as identifier
            FROM users 
            WHERE school_id = $1 AND role IN ('student', 'teacher', 'staff') AND is_active = true
            ORDER BY first_name, last_name
        `, [req.user.school_id]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Error fetching users' });
    }
}

async function searchBookByBarcode(req, res) {
    const { barcode } = req.query;
    
    try {
        const result = await pool.query(`
            SELECT bc.*, bk.title, bk.author, bk.is_reference_only
            FROM book_copies bc
            JOIN books bk ON bc.book_id = bk.id
            WHERE bc.barcode = $1 AND bk.school_id = $2
        `, [barcode, req.user.school_id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Book not found' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error searching book:', error);
        res.status(500).json({ error: 'Error searching book' });
    }
}

async function payFine(req, res) {
    const { fine_id } = req.params;
    const { payment_method } = req.body;
    
    try {
        const result = await pool.query(`
            UPDATE fines 
            SET status = 'paid', paid_date = CURRENT_DATE, paid_by = $1
            WHERE id = $2 AND status = 'pending'
            RETURNING *
        `, [req.user.id, fine_id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Fine not found or already paid' });
        }
        
        res.json({ message: 'Fine paid successfully', fine: result.rows[0] });
    } catch (error) {
        console.error('Error paying fine:', error);
        res.status(500).json({ error: 'Error paying fine' });
    }
}

// ==================== NEW FUNCTIONS FOR LIBRARIAN DASHBOARD ====================

async function getLibrarianDashboard(req, res) {
    try {
        const books = await pool.query(`
            SELECT 
                COUNT(DISTINCT b.id) as total_books,
                SUM(CASE WHEN bc.status = 'available' THEN 1 ELSE 0 END) as available_books,
                SUM(CASE WHEN bc.status = 'borrowed' THEN 1 ELSE 0 END) as borrowed_books
            FROM books b
            JOIN book_copies bc ON b.id = bc.book_id
            WHERE b.school_id = $1
        `, [req.user.school_id]);
        
        const overdue = await pool.query(`
            SELECT COUNT(*) as count
            FROM borrowings b
            JOIN book_copies bc ON b.copy_id = bc.id
            JOIN books bk ON bc.book_id = bk.id
            WHERE bk.school_id = $1 AND b.due_date < CURRENT_DATE AND b.status = 'borrowed'
        `, [req.user.school_id]);
        
        const members = await pool.query(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN u.is_active = true THEN 1 ELSE 0 END) as active
            FROM users u
            WHERE u.school_id = $1 AND u.role IN ('student', 'teacher', 'staff')
        `, [req.user.school_id]);
        
        const popular = await pool.query(`
            SELECT bk.title, bk.author, COUNT(b.id) as borrow_count
            FROM borrowings b
            JOIN book_copies bc ON b.copy_id = bc.id
            JOIN books bk ON bc.book_id = bk.id
            WHERE bk.school_id = $1
            GROUP BY bk.id, bk.title, bk.author
            ORDER BY borrow_count DESC
            LIMIT 5
        `, [req.user.school_id]);
        
        const recent = await pool.query(`
            SELECT b.id, bk.title as book_title, u.first_name || ' ' || u.last_name as member_name,
                   b.borrowed_date, b.due_date, b.status
            FROM borrowings b
            JOIN book_copies bc ON b.copy_id = bc.id
            JOIN books bk ON bc.book_id = bk.id
            JOIN users u ON b.user_id = u.id
            WHERE bk.school_id = $1
            ORDER BY b.borrowed_date DESC
            LIMIT 10
        `, [req.user.school_id]);
        
        const overdueList = await pool.query(`
            SELECT b.id, bk.title as book_title, u.first_name || ' ' || u.last_name as member_name,
                   b.due_date, EXTRACT(DAY FROM (CURRENT_DATE - b.due_date)) as days_overdue,
                   (EXTRACT(DAY FROM (CURRENT_DATE - b.due_date)) * 5) as fine_amount
            FROM borrowings b
            JOIN book_copies bc ON b.copy_id = bc.id
            JOIN books bk ON bc.book_id = bk.id
            JOIN users u ON b.user_id = u.id
            WHERE bk.school_id = $1 AND b.due_date < CURRENT_DATE AND b.status = 'borrowed'
        `, [req.user.school_id]);
        
        const categories = await pool.query(`
            SELECT bc.category_name as name, COUNT(b.id) as value
            FROM books b
            JOIN book_categories bc ON b.category_id = bc.id
            WHERE b.school_id = $1
            GROUP BY bc.id, bc.category_name
        `, [req.user.school_id]);
        
        res.json({
            total_books: parseInt(books.rows[0]?.total_books || 0),
            available_books: parseInt(books.rows[0]?.available_books || 0),
            borrowed_books: parseInt(books.rows[0]?.borrowed_books || 0),
            overdue_books: parseInt(overdue.rows[0]?.count || 0),
            total_members: parseInt(members.rows[0]?.total || 0),
            active_members: parseInt(members.rows[0]?.active || 0),
            popular_books: popular.rows,
            recent_borrowings: recent.rows,
            overdue_list: overdueList.rows,
            category_distribution: categories.rows
        });
    } catch (error) {
        console.error('Error fetching librarian dashboard:', error);
        res.status(500).json({ error: 'Error fetching dashboard data' });
    }
}

async function getLibraryMembers(req, res) {
    try {
        const result = await pool.query(`
            SELECT u.id, u.first_name || ' ' || u.last_name as name, u.email, u.phone, u.role,
                   (SELECT COUNT(*) FROM borrowings WHERE user_id = u.id AND status = 'borrowed') as books_borrowed
            FROM users u
            WHERE u.school_id = $1 AND u.role IN ('student', 'teacher', 'staff') AND u.is_active = true
            ORDER BY u.last_name
        `, [req.user.school_id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching library members:', error);
        res.status(500).json({ error: 'Error fetching members' });
    }
}

async function getBorrowings(req, res) {
    try {
        const result = await pool.query(`
            SELECT b.*, bk.title as book_title, u.first_name || ' ' || u.last_name as member_name,
                   CASE WHEN b.due_date < CURRENT_DATE AND b.status = 'borrowed' THEN 'overdue' ELSE b.status END as status
            FROM borrowings b
            JOIN book_copies bc ON b.copy_id = bc.id
            JOIN books bk ON bc.book_id = bk.id
            JOIN users u ON b.user_id = u.id
            WHERE bk.school_id = $1
            ORDER BY b.borrowed_date DESC
        `, [req.user.school_id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching borrowings:', error);
        res.status(500).json({ error: 'Error fetching borrowings' });
    }
}

async function renewBook(req, res) {
    const { id } = req.params;
    
    try {
        const borrowing = await pool.query(`
            SELECT * FROM borrowings WHERE id = $1 AND status = 'borrowed'
        `, [id]);
        
        if (borrowing.rows.length === 0) {
            return res.status(404).json({ error: 'Borrowing record not found' });
        }
        
        const renewedCount = (borrowing.rows[0].renewed_count || 0) + 1;
        const newDueDate = moment().add(14, 'days').format('YYYY-MM-DD');
        
        await pool.query(`
            UPDATE borrowings 
            SET due_date = $1, renewed_count = $2
            WHERE id = $3
        `, [newDueDate, renewedCount, id]);
        
        res.json({ message: 'Book renewed successfully', due_date: newDueDate });
    } catch (error) {
        console.error('Error renewing book:', error);
        res.status(500).json({ error: 'Error renewing book' });
    }
}

async function sendOverdueReminder(req, res) {
    const { id } = req.params;
    
    try {
        const borrowing = await pool.query(`
            SELECT b.*, u.email, u.phone, u.first_name, u.last_name, bk.title
            FROM borrowings b
            JOIN users u ON b.user_id = u.id
            JOIN book_copies bc ON b.copy_id = bc.id
            JOIN books bk ON bc.book_id = bk.id
            WHERE b.id = $1
        `, [id]);
        
        if (borrowing.rows.length === 0) {
            return res.status(404).json({ error: 'Borrowing record not found' });
        }
        
        const daysOverdue = moment().diff(moment(borrowing.rows[0].due_date), 'days');
        
        res.json({ message: 'Reminder sent successfully', days_overdue: daysOverdue });
    } catch (error) {
        console.error('Error sending reminder:', error);
        res.status(500).json({ error: 'Error sending reminder' });
    }
}

module.exports = {
    getCategories,
    createCategory,
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
    getLibrarianDashboard,
    getLibraryMembers,
    getBorrowings,
    renewBook,
    sendOverdueReminder
};