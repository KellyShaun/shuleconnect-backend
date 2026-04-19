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

async function setAllPasswords() {
  try {
    console.log('🔐 Setting passwords for all users...\n');
    
    // Generate password hashes for different roles
    const passwords = {
      admin: 'admin123',
      teacher: 'teacher123',
      student: 'student123',
      parent: 'parent123',
      staff: 'staff123'
    };
    
    const hashes = {
      admin: bcrypt.hashSync(passwords.admin, 10),
      teacher: bcrypt.hashSync(passwords.teacher, 10),
      student: bcrypt.hashSync(passwords.student, 10),
      parent: bcrypt.hashSync(passwords.parent, 10),
      staff: bcrypt.hashSync(passwords.staff, 10)
    };
    
    console.log('✅ Password hashes generated');
    console.log(`   Admin password: ${passwords.admin}`);
    console.log(`   Teacher password: ${passwords.teacher}`);
    console.log(`   Student password: ${passwords.student}`);
    console.log(`   Parent password: ${passwords.parent}`);
    console.log(`   Staff password: ${passwords.staff}\n`);
    
    // Update users based on their role
    console.log('📝 Updating user passwords...\n');
    
    // Admin roles (super_admin, school_admin, accountant, librarian, etc.)
    const adminResult = await pool.query(`
      UPDATE users 
      SET password_hash = $1 
      WHERE role IN ('super_admin', 'school_admin', 'accountant', 'librarian', 
                     'transport_manager', 'hostel_manager')
      RETURNING email, role
    `, [hashes.admin]);
    
    console.log(`✓ Admin users (${adminResult.rowCount}):`);
    adminResult.rows.forEach(user => {
      console.log(`   ${user.email} (${user.role}) -> password: ${passwords.admin}`);
    });
    
    // Teachers
    const teacherResult = await pool.query(`
      UPDATE users 
      SET password_hash = $1 
      WHERE role = 'teacher'
      RETURNING email, role
    `, [hashes.teacher]);
    
    console.log(`\n✓ Teachers (${teacherResult.rowCount}):`);
    teacherResult.rows.forEach(user => {
      console.log(`   ${user.email} -> password: ${passwords.teacher}`);
    });
    
    // Students
    const studentResult = await pool.query(`
      UPDATE users 
      SET password_hash = $1 
      WHERE role = 'student'
      RETURNING email, role
    `, [hashes.student]);
    
    console.log(`\n✓ Students (${studentResult.rowCount}):`);
    studentResult.rows.slice(0, 5).forEach(user => {
      console.log(`   ${user.email} -> password: ${passwords.student}`);
    });
    if (studentResult.rowCount > 5) {
      console.log(`   ... and ${studentResult.rowCount - 5} more students`);
    }
    
    // Parents
    const parentResult = await pool.query(`
      UPDATE users 
      SET password_hash = $1 
      WHERE role = 'parent'
      RETURNING email, role
    `, [hashes.parent]);
    
    console.log(`\n✓ Parents (${parentResult.rowCount}):`);
    parentResult.rows.forEach(user => {
      console.log(`   ${user.email} -> password: ${passwords.parent}`);
    });
    
    // Non-teaching staff
    const staffResult = await pool.query(`
      UPDATE users 
      SET password_hash = $1 
      WHERE role = 'non_teaching_staff'
      RETURNING email, role
    `, [hashes.staff]);
    
    console.log(`\n✓ Non-teaching staff (${staffResult.rowCount}):`);
    staffResult.rows.forEach(user => {
      console.log(`   ${user.email} -> password: ${passwords.staff}`);
    });
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ ALL PASSWORDS UPDATED SUCCESSFULLY!');
    console.log('='.repeat(60));
    console.log('\n📋 SUMMARY OF CREDENTIALS:');
    console.log('='.repeat(60));
    console.log('\n🔑 ADMIN ACCOUNTS (Password: admin123):');
    console.log('   • superadmin@shuleconnect.com (Super Admin)');
    console.log('   • schooladmin@shuleconnect.com (School Admin)');
    console.log('   • accountant@shuleconnect.com (Accountant)');
    console.log('   • librarian@shuleconnect.com (Librarian)');
    console.log('   • transport@shuleconnect.com (Transport Manager)');
    console.log('   • hostel@shuleconnect.com (Hostel Manager)');
    
    console.log('\n👨‍🏫 TEACHER ACCOUNTS (Password: teacher123):');
    console.log('   • john.odhiambo@shuleconnect.com');
    console.log('   • mary.wanjiku@shuleconnect.com');
    console.log('   • peter.otieno@shuleconnect.com');
    console.log('   • grace.muthoni@shuleconnect.com');
    console.log('   • james.kariuki@shuleconnect.com');
    console.log('   • lucia.akinyi@shuleconnect.com');
    console.log('   • daniel.mwangi@shuleconnect.com');
    console.log('   • sarah.chebet@shuleconnect.com');
    
    console.log('\n👨‍🎓 STUDENT ACCOUNTS (Password: student123):');
    console.log('   • james.kamau@student.com');
    console.log('   • sarah.wambui@student.com');
    console.log('   • michael.otieno@student.com');
    console.log('   • esther.chebet@student.com');
    console.log('   • david.maina@student.com');
    console.log('   • lilian.akoth@student.com');
    console.log('   • brian.odero@student.com');
    console.log('   • faith.nduta@student.com');
    console.log('   • kelvin.mbugua@student.com');
    console.log('   • joyce.wanjiru@student.com');
    
    console.log('\n👪 PARENT ACCOUNTS (Password: parent123):');
    console.log('   • robert.kamau@parent.com');
    console.log('   • ann.wambui@parent.com');
    console.log('   • john.otieno@parent.com');
    console.log('   • mary.chebet@parent.com');
    console.log('   • peter.maina@parent.com');
    
    console.log('\n👔 NON-TEACHING STAFF (Password: staff123):');
    console.log('   • reception@shuleconnect.com (Receptionist)');
    console.log('   • nurse@shuleconnect.com (Nurse)');
    console.log('   • security@shuleconnect.com (Security)');
    console.log('   • cook@shuleconnect.com (Cook)');
    console.log('   • grounds@shuleconnect.com (Groundskeeper)');
    
    console.log('\n' + '='.repeat(60));
    console.log('🎯 You can now login with any of these credentials');
    console.log('='.repeat(60) + '\n');
    
    // Verify a few users
    const verifyUsers = await pool.query(`
      SELECT email, role, 
             CASE 
               WHEN password_hash IS NOT NULL THEN '✓ Has password'
               ELSE '✗ No password'
             END as status
      FROM users 
      WHERE email IN ('superadmin@shuleconnect.com', 'john.odhiambo@shuleconnect.com', 
                     'james.kamau@student.com', 'robert.kamau@parent.com')
      LIMIT 4
    `);
    
    console.log('🔍 Verification:');
    verifyUsers.rows.forEach(user => {
      console.log(`   ${user.email} (${user.role}): ${user.status}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

// Run the script
setAllPasswords();