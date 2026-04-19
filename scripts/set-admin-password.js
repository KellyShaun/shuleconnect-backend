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

async function setAdminPassword() {
  try {
    const password = 'admin123';
    const hash = bcrypt.hashSync(password, 10);
    
    console.log(`Setting password for admin users...`);
    console.log(`Password: ${password}`);
    console.log(`Hash: ${hash}\n`);
    
    // Update all admin users
    const result = await pool.query(`
      UPDATE users 
      SET password_hash = $1 
      WHERE email IN ('superadmin@shuleconnect.com', 'schooladmin@shuleconnect.com', 'admin@school.com')
      RETURNING email, role
    `, [hash]);
    
    console.log(`✅ Updated ${result.rows.length} users:\n`);
    result.rows.forEach(user => {
      console.log(`   ${user.email} (${user.role})`);
    });
    
    console.log(`\n🎯 Try logging in with:`);
    console.log(`   Email: superadmin@shuleconnect.com`);
    console.log(`   Password: ${password}`);
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

setAdminPassword();