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

async function fixStoreKeeper() {
  try {
    console.log('🔐 Fixing Store Keeper password...\n');
    
    // Generate correct hash for 'admin123'
    const adminHash = bcrypt.hashSync('admin123', 10);
    console.log('Generated hash:', adminHash);
    
    // First, add role to enum if not exists
    await pool.query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'store_keeper'`);
    
    // Check if user exists
    const checkUser = await pool.query(
      "SELECT id, email, role FROM users WHERE email = 'store.keeper@shuleconnect.com'"
    );
    
    if (checkUser.rows.length > 0) {
      // Update existing user
      await pool.query(
        "UPDATE users SET password_hash = $1 WHERE email = 'store.keeper@shuleconnect.com'",
        [adminHash]
      );
      console.log('✅ Updated existing store keeper password');
    } else {
      // Insert new user
      await pool.query(`
        INSERT INTO users (email, username, password_hash, role, first_name, last_name, phone, is_active, school_id) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, true, 1)
      `, ['store.keeper@shuleconnect.com', 'store.keeper', adminHash, 'store_keeper', 'Store', 'Keeper', '0712345678']);
      console.log('✅ Created new store keeper user');
    }
    
    // Verify the user
    const verify = await pool.query(
      "SELECT id, email, role FROM users WHERE email = 'store.keeper@shuleconnect.com'"
    );
    
    if (verify.rows.length > 0) {
      console.log('\n📋 Store Keeper Credentials:');
      console.log('   Email: store.keeper@shuleconnect.com');
      console.log('   Password: admin123');
      console.log('   Role:', verify.rows[0].role);
    } else {
      console.log('\n❌ User not found!');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

fixStoreKeeper();