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

async function verifyLogin() {
  try {
    const email = 'admin@shuleconnect.com';
    const password = 'admin123';
    
    console.log(`Testing login for: ${email}`);
    console.log(`Password: ${password}\n`);
    
    // Get user from database
    const result = await pool.query(
      'SELECT id, email, password_hash, role FROM users WHERE email = $1',
      [email]
    );
    
    if (result.rows.length === 0) {
      console.log('❌ User not found in database');
      return;
    }
    
    const user = result.rows[0];
    console.log('✓ User found in database');
    console.log(`  Email: ${user.email}`);
    console.log(`  Role: ${user.role}`);
    console.log(`  Password hash: ${user.password_hash.substring(0, 30)}...`);
    console.log(`  Hash length: ${user.password_hash.length}\n`);
    
    // Verify password
    const isValid = await bcrypt.compare(password, user.password_hash);
    
    if (isValid) {
      console.log('✅ Password is VALID! Login would succeed.');
    } else {
      console.log('❌ Password is INVALID!');
      console.log('\n💡 Possible issues:');
      console.log('   1. Wrong password hash in database');
      console.log('   2. Password encoding issue');
      console.log('   3. Hash was generated differently');
      
      // Try to generate a new hash for comparison
      const newHash = bcrypt.hashSync(password, 10);
      console.log(`\nNew hash for "${password}": ${newHash}`);
      console.log(`Current hash in DB: ${user.password_hash}`);
      
      if (newHash === user.password_hash) {
        console.log('\n❌ Hashes match but bcrypt.compare failed - this indicates a bcrypt version issue');
      } else {
        console.log('\n❌ Hashes are different - password hash in database is incorrect');
      }
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

verifyLogin();