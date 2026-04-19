const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Login with email - ADDED DEBUGGING
router.post('/login', async (req, res, next) => {
  // Debug logging
  console.log('=== Login Request Debug ===');
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  console.log('Content-Type:', req.headers['content-type']);
  next();
}, [
  body('email').isEmail().withMessage('Valid email address is required'),
  body('password').notEmpty().withMessage('Password is required'),
], async (req, res) => {
  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.log('Validation errors:', errors.array());
    return res.status(400).json({ errors: errors.array() });
  }
  
  const { email, password } = req.body;
  
  try {
    const result = await req.db.query(
      `SELECT u.*, s.name as school_name 
       FROM users u 
       LEFT JOIN schools s ON u.school_id = s.id 
       WHERE u.email = $1 AND u.is_active = true`,
      [email]
    );
    
    if (result.rows.length === 0) {
      console.log(`User not found with email: ${email}`);
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    const user = result.rows[0];
    console.log(`User found: ${user.email}, role: ${user.role}`);
    
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!isValidPassword) {
      console.log(`Invalid password for user: ${email}`);
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    // Update last login
    await req.db.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );
    
    // Generate tokens
    const accessToken = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, schoolId: user.school_id },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    const refreshToken = jwt.sign(
      { userId: user.id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );
    
    // Log activity - with error handling so login doesn't fail if table missing
    try {
      await req.db.query(
        'INSERT INTO activity_logs (user_id, action, ip_address) VALUES ($1, $2, $3)',
        [user.id, 'user_login', req.ip || req.socket.remoteAddress]
      );
      console.log(`Activity logged for user: ${email}`);
    } catch (logError) {
      // Don't fail login if logging fails (table might not exist)
      console.log('Note: Could not log activity (activity_logs table may not exist):', logError.message);
    }
    
    console.log(`Login successful for user: ${email}`);
    
    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        schoolId: user.school_id,
        schoolName: user.school_name
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login: ' + error.message });
  }
});

// Refresh token endpoint
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  
  if (!refreshToken) {
    return res.status(401).json({ error: 'Refresh token required' });
  }
  
  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    
    const result = await req.db.query(
      'SELECT id, email, role, school_id FROM users WHERE id = $1 AND is_active = true',
      [decoded.userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    const user = result.rows[0];
    const newAccessToken = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, schoolId: user.school_id },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.json({ accessToken: newAccessToken });
  } catch (error) {
    console.error('Refresh token error:', error);
    return res.status(403).json({ error: 'Invalid refresh token' });
  }
});

// Change password
router.post('/change-password', authenticateToken, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  
  const { currentPassword, newPassword } = req.body;
  
  try {
    const result = await req.db.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const isValid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await req.db.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [hashedPassword, req.user.id]
    );
    
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Logout
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    try {
      await req.db.query(
        'INSERT INTO activity_logs (user_id, action, ip_address) VALUES ($1, $2, $3)',
        [req.user.id, 'user_logout', req.ip || req.socket.remoteAddress]
      );
    } catch (logError) {
      console.log('Note: Could not log activity (activity_logs table may not exist):', logError.message);
    }
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Forgot password - send reset email
router.post('/forgot-password', [
  body('email').isEmail().withMessage('Valid email is required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  
  const { email } = req.body;
  
  try {
    const user = await req.db.query(
      'SELECT id, email FROM users WHERE email = $1 AND is_active = true',
      [email]
    );
    
    if (user.rows.length === 0) {
      // Don't reveal that user doesn't exist for security
      return res.json({ message: 'If your email is registered, you will receive a reset link' });
    }
    
    // Generate reset token
    const resetToken = jwt.sign(
      { userId: user.rows[0].id },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    
    // Here you would send an email with the reset link
    // For now, just return the token (in production, email it)
    console.log(`Reset token for ${email}: ${resetToken}`);
    
    res.json({ message: 'Password reset link sent to your email' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Test endpoint to check database connection
router.get('/test-db', async (req, res) => {
  try {
    const result = await req.db.query('SELECT NOW() as time, current_database() as db');
    res.json({
      success: true,
      time: result.rows[0].time,
      database: result.rows[0].db,
      message: 'Database connection successful'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test endpoint to check users
router.get('/test-users', async (req, res) => {
  try {
    const result = await req.db.query('SELECT id, email, role FROM users LIMIT 10');
    res.json({
      success: true,
      count: result.rows.length,
      users: result.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;