const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'shuleconnect002',
});

async function setupComplete() {
  const email = 'admin@shuleconnect.com';
  const password = 'admin123';
  const hashedPassword = await bcrypt.hash(password, 10);
  
  try {
    console.log('Setting up ShuleConnect database...');
    console.log(`Database: ${process.env.DB_NAME}`);
    
    // Insert school
    let schoolId;
    const schoolResult = await pool.query(`
      INSERT INTO schools (name, code, curriculum, address, phone, email, is_active) 
      VALUES ($1, $2, $3, $4, $5, $6, true)
      ON CONFLICT (code) DO NOTHING
      RETURNING id
    `, ['ShuleConnect Demo School', 'DEMO001', '844', 'Nairobi, Kenya', '+254700000000', 'admin@shuleconnect.com']);
    
    if (schoolResult.rows.length > 0) {
      schoolId = schoolResult.rows[0].id;
      console.log('✅ School created with ID:', schoolId);
    } else {
      const existingSchool = await pool.query('SELECT id FROM schools WHERE code = $1', ['DEMO001']);
      schoolId = existingSchool.rows[0].id;
      console.log('✅ School already exists with ID:', schoolId);
    }
    
    // Insert admin user with email as primary login
    const userResult = await pool.query(`
      INSERT INTO users (school_id, username, email, phone, first_name, last_name, role, password_hash, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
      ON CONFLICT (email) DO UPDATE 
      SET password_hash = EXCLUDED.password_hash, 
          is_active = true,
          school_id = EXCLUDED.school_id
      RETURNING id, email, username, role
    `, [schoolId, 'admin', email, '+254700000000', 'School', 'Admin', 'school_admin', hashedPassword]);
    
    console.log('\n✅ Admin user created/updated:');
    console.log(`   ID: ${userResult.rows[0].id}`);
    console.log(`   Email: ${userResult.rows[0].email}`);
    console.log(`   Username: ${userResult.rows[0].username}`);
    console.log(`   Role: ${userResult.rows[0].role}`);
    console.log(`\n📝 Login credentials:`);
    console.log(`   Email: admin@shuleconnect.com`);
    console.log(`   Password: admin123`);
    console.log(`\n🌐 Frontend URL: http://localhost:3000`);
    console.log(`🔧 Backend API: http://localhost:5000`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

setupComplete();