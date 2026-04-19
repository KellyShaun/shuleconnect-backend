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

async function fixPasswords() {
  try {
    console.log('\n🔐 Generating correct password hashes...\n');
    
    // Generate correct hashes
    const adminHash = bcrypt.hashSync('admin123', 10);
    const teacherHash = bcrypt.hashSync('teacher123', 10);
    const studentHash = bcrypt.hashSync('student123', 10);
    const parentHash = bcrypt.hashSync('parent123', 10);
    const staffHash = bcrypt.hashSync('staff123', 10);
    
    console.log('✅ Hashes generated:');
    console.log(`   admin123: ${adminHash.substring(0, 30)}...`);
    console.log(`   teacher123: ${teacherHash.substring(0, 30)}...`);
    console.log(`   student123: ${studentHash.substring(0, 30)}...`);
    console.log(`   parent123: ${parentHash.substring(0, 30)}...`);
    console.log(`   staff123: ${staffHash.substring(0, 30)}...\n`);
    
    // Update all users based on role
    console.log('📝 Updating passwords...\n');
    
    // Update admin roles
    const adminResult = await pool.query(`
      UPDATE users 
      SET password_hash = $1 
      WHERE role IN ('super_admin', 'school_admin', 'accountant', 'librarian', 'transport_manager', 'hostel_manager')
      RETURNING email, role
    `, [adminHash]);
    console.log(`✓ Updated ${adminResult.rowCount} admin accounts (password: admin123)`);
    
    // Update teachers
    const teacherResult = await pool.query(`
      UPDATE users 
      SET password_hash = $1 
      WHERE role = 'teacher'
      RETURNING email, role
    `, [teacherHash]);
    console.log(`✓ Updated ${teacherResult.rowCount} teacher accounts (password: teacher123)`);
    
    // Update students
    const studentResult = await pool.query(`
      UPDATE users 
      SET password_hash = $1 
      WHERE role = 'student'
      RETURNING email, role
    `, [studentHash]);
    console.log(`✓ Updated ${studentResult.rowCount} student accounts (password: student123)`);
    
    // Update parents
    const parentResult = await pool.query(`
      UPDATE users 
      SET password_hash = $1 
      WHERE role = 'parent'
      RETURNING email, role
    `, [parentHash]);
    console.log(`✓ Updated ${parentResult.rowCount} parent accounts (password: parent123)`);
    
    // Update non-teaching staff
    const staffResult = await pool.query(`
      UPDATE users 
      SET password_hash = $1 
      WHERE role = 'non_teaching_staff'
      RETURNING email, role
    `, [staffHash]);
    console.log(`✓ Updated ${staffResult.rowCount} staff accounts (password: staff123)`);
    
    // Verify a few users
    console.log('\n🔍 Verifying updates...\n');
    
    const testUsers = await pool.query(`
      SELECT email, role, 
             CASE 
               WHEN password_hash IS NOT NULL THEN 'Hashed'
               ELSE 'Missing'
             END as status,
             LEFT(password_hash, 25) as hash_start
      FROM users 
      WHERE email IN (
        'admin@shuleconnect.com',
        'john.teacher@shuleconnect.com', 
        'james.student@shuleconnect.com',
        'robert.parent@shuleconnect.com'
      )
    `);
    
    testUsers.rows.forEach(user => {
      console.log(`  ✓ ${user.email} (${user.role}) - ${user.status}`);
    });
    
    console.log('\n========================================');
    console.log('✅ PASSWORDS FIXED SUCCESSFULLY!');
    console.log('========================================');
    console.log('\n📋 WORKING CREDENTIALS:');
    console.log('========================================\n');
    console.log('🔑 ADMIN ACCOUNTS (Password: admin123):');
    console.log('   • admin@shuleconnect.com (Super Admin)');
    console.log('   • schooladmin@shuleconnect.com (School Admin)');
    console.log('   • accountant@shuleconnect.com (Accountant)');
    console.log('   • librarian@shuleconnect.com (Librarian)');
    
    console.log('\n👨‍🏫 TEACHER ACCOUNTS (Password: teacher123):');
    console.log('   • john.teacher@shuleconnect.com');
    console.log('   • mary.teacher@shuleconnect.com');
    console.log('   • peter.teacher@shuleconnect.com');
    
    console.log('\n👨‍🎓 STUDENT ACCOUNTS (Password: student123):');
    console.log('   • james.student@shuleconnect.com');
    console.log('   • sarah.student@shuleconnect.com');
    console.log('   • michael.student@shuleconnect.com');
    
    console.log('\n👪 PARENT ACCOUNTS (Password: parent123):');
    console.log('   • robert.parent@shuleconnect.com');
    console.log('   • ann.parent@shuleconnect.com');
    
    console.log('\n========================================\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

fixPasswords();