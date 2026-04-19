const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'shuleconnect002',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});

async function simpleReset() {
  try {
    // Simple password - 'password123'
    const password = 'password123';
    const hash = bcrypt.hashSync(password, 10);
    
    console.log(`Setting password to: ${password}`);
    console.log(`Hash: ${hash}\n`);
    
    // Update all admin users
    await pool.query(
      `UPDATE users 
       SET password_hash = $1 
       WHERE role IN ('super_admin', 'school_admin') OR email = $2`,
      [hash, 'admin@shuleconnect.com']
    );
    
    console.log('✅ Updated admin passwords');
    
    // Verify
    const result = await pool.query(
      'SELECT email, role FROM users WHERE role IN ($1, $2) LIMIT 5',
      ['super_admin', 'school_admin']
    );
    
    console.log('\nUpdated users:');
    result.rows.forEach(user => {
      console.log(`  ${user.email} (${user.role})`);
    });
    
    console.log(`\n🎯 Try logging in with: admin@shuleconnect.com / ${password}`);
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

simpleReset();