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

// Generate password hashes
const hashes = {
  admin123: bcrypt.hashSync('admin123', 10),
  teacher123: bcrypt.hashSync('teacher123', 10),
  student123: bcrypt.hashSync('student123', 10),
  parent123: bcrypt.hashSync('parent123', 10),
  staff123: bcrypt.hashSync('staff123', 10),
};

async function resetAllUsers() {
  const client = await pool.connect();
  
  try {
    console.log('\n========================================');
    console.log('🚀 STARTING DATABASE RESET');
    console.log('========================================\n');
    
    await client.query('BEGIN');
    
    // 1. Delete all data from related tables (order matters for foreign keys)
    console.log('📝 Clearing existing data...');
    
    const tablesToClear = [
      'exam_marks',
      'exam_results', 
      'results',
      'attendance',
      'student_parents',
      'class_subjects',
      'exams',
      'term_performance',
      'activity_logs',
      'refresh_tokens',
      'user_sessions',
      'password_resets',
      'students',
      'users'
    ];
    
    for (const table of tablesToClear) {
      try {
        await client.query(`DELETE FROM ${table}`);
        console.log(`  ✓ Cleared ${table}`);
      } catch (err) {
        console.log(`  ⚠️ Skipped ${table}: ${err.message}`);
      }
    }
    
    // Reset sequences
    await client.query(`ALTER SEQUENCE IF EXISTS users_id_seq RESTART WITH 1`);
    await client.query(`ALTER SEQUENCE IF EXISTS students_id_seq RESTART WITH 1`);
    
    console.log('\n✅ All data cleared successfully!\n');
    
    // 2. Insert fresh users
    console.log('👥 Creating new users with working credentials...\n');
    
    const users = [
      // ============ SUPER ADMIN ============
      {
        email: 'admin@shuleconnect.com',
        username: 'superadmin',
        password_hash: hashes.admin123,
        role: 'super_admin',
        first_name: 'Super',
        last_name: 'Admin',
        phone: '0711111111',
        is_active: true,
        school_id: 1
      },
      // ============ SCHOOL ADMIN ============
      {
        email: 'schooladmin@shuleconnect.com',
        username: 'schooladmin',
        password_hash: hashes.admin123,
        role: 'school_admin',
        first_name: 'School',
        last_name: 'Admin',
        phone: '0722222222',
        is_active: true,
        school_id: 1
      },
      // ============ TEACHERS ============
      {
        email: 'john.teacher@shuleconnect.com',
        username: 'john.teacher',
        password_hash: hashes.teacher123,
        role: 'teacher',
        first_name: 'John',
        last_name: 'Odhiambo',
        phone: '0733333333',
        is_active: true,
        school_id: 1
      },
      {
        email: 'mary.teacher@shuleconnect.com',
        username: 'mary.teacher',
        password_hash: hashes.teacher123,
        role: 'teacher',
        first_name: 'Mary',
        last_name: 'Wanjiku',
        phone: '0744444444',
        is_active: true,
        school_id: 1
      },
      {
        email: 'peter.teacher@shuleconnect.com',
        username: 'peter.teacher',
        password_hash: hashes.teacher123,
        role: 'teacher',
        first_name: 'Peter',
        last_name: 'Otieno',
        phone: '0755555555',
        is_active: true,
        school_id: 1
      },
      {
        email: 'grace.teacher@shuleconnect.com',
        username: 'grace.teacher',
        password_hash: hashes.teacher123,
        role: 'teacher',
        first_name: 'Grace',
        last_name: 'Muthoni',
        phone: '0766666666',
        is_active: true,
        school_id: 1
      },
      // ============ STUDENTS ============
      {
        email: 'james.student@shuleconnect.com',
        username: 'james.student',
        password_hash: hashes.student123,
        role: 'student',
        first_name: 'James',
        last_name: 'Kamau',
        phone: '0712345678',
        is_active: true,
        school_id: 1
      },
      {
        email: 'sarah.student@shuleconnect.com',
        username: 'sarah.student',
        password_hash: hashes.student123,
        role: 'student',
        first_name: 'Sarah',
        last_name: 'Wambui',
        phone: '0723456789',
        is_active: true,
        school_id: 1
      },
      {
        email: 'michael.student@shuleconnect.com',
        username: 'michael.student',
        password_hash: hashes.student123,
        role: 'student',
        first_name: 'Michael',
        last_name: 'Otieno',
        phone: '0734567890',
        is_active: true,
        school_id: 1
      },
      {
        email: 'esther.student@shuleconnect.com',
        username: 'esther.student',
        password_hash: hashes.student123,
        role: 'student',
        first_name: 'Esther',
        last_name: 'Chebet',
        phone: '0745678901',
        is_active: true,
        school_id: 1
      },
      // ============ PARENTS ============
      {
        email: 'robert.parent@shuleconnect.com',
        username: 'robert.parent',
        password_hash: hashes.parent123,
        role: 'parent',
        first_name: 'Robert',
        last_name: 'Kamau',
        phone: '0711111111',
        is_active: true,
        school_id: 1
      },
      {
        email: 'ann.parent@shuleconnect.com',
        username: 'ann.parent',
        password_hash: hashes.parent123,
        role: 'parent',
        first_name: 'Ann',
        last_name: 'Wambui',
        phone: '0722222222',
        is_active: true,
        school_id: 1
      },
      {
        email: 'john.parent@shuleconnect.com',
        username: 'john.parent',
        password_hash: hashes.parent123,
        role: 'parent',
        first_name: 'John',
        last_name: 'Otieno',
        phone: '0733333333',
        is_active: true,
        school_id: 1
      },
      // ============ ACCOUNTANT ============
      {
        email: 'accountant@shuleconnect.com',
        username: 'accountant',
        password_hash: hashes.admin123,
        role: 'accountant',
        first_name: 'Finance',
        last_name: 'Officer',
        phone: '0766666666',
        is_active: true,
        school_id: 1
      },
      // ============ LIBRARIAN ============
      {
        email: 'librarian@shuleconnect.com',
        username: 'librarian',
        password_hash: hashes.admin123,
        role: 'librarian',
        first_name: 'Library',
        last_name: 'Manager',
        phone: '0777777777',
        is_active: true,
        school_id: 1
      },
      // ============ TRANSPORT MANAGER ============
      {
        email: 'transport@shuleconnect.com',
        username: 'transport',
        password_hash: hashes.admin123,
        role: 'transport_manager',
        first_name: 'Transport',
        last_name: 'Manager',
        phone: '0788888888',
        is_active: true,
        school_id: 1
      },
      // ============ HOSTEL MANAGER ============
      {
        email: 'hostel@shuleconnect.com',
        username: 'hostel',
        password_hash: hashes.admin123,
        role: 'hostel_manager',
        first_name: 'Hostel',
        last_name: 'Manager',
        phone: '0799999999',
        is_active: true,
        school_id: 1
      },
      // ============ NON-TEACHING STAFF ============
      {
        email: 'reception@shuleconnect.com',
        username: 'reception',
        password_hash: hashes.staff123,
        role: 'non_teaching_staff',
        first_name: 'Alice',
        last_name: 'Wanjiku',
        phone: '0711111111',
        is_active: true,
        school_id: 1
      },
      {
        email: 'nurse@shuleconnect.com',
        username: 'nurse',
        password_hash: hashes.staff123,
        role: 'non_teaching_staff',
        first_name: 'Grace',
        last_name: 'Muthoni',
        phone: '0722222222',
        is_active: true,
        school_id: 1
      },
      {
        email: 'security@shuleconnect.com',
        username: 'security',
        password_hash: hashes.staff123,
        role: 'non_teaching_staff',
        first_name: 'John',
        last_name: 'Kimani',
        phone: '0733333333',
        is_active: true,
        school_id: 1
      }
    ];
    
    // Insert all users
    let insertedCount = 0;
    for (const user of users) {
      try {
        const result = await client.query(`
          INSERT INTO users (
            email, username, password_hash, role, first_name, last_name, 
            phone, is_active, school_id, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING id, email, role
        `, [user.email, user.username, user.password_hash, user.role, 
            user.first_name, user.last_name, user.phone, user.is_active, user.school_id]);
        
        console.log(`  ✓ Created: ${user.email} (${user.role})`);
        insertedCount++;
      } catch (err) {
        console.log(`  ✗ Failed: ${user.email} - ${err.message}`);
      }
    }
    
    // 3. Create student records for student users
    console.log('\n📚 Creating student records...');
    
    const studentUsers = await client.query(`
      SELECT id, email FROM users WHERE role = 'student'
    `);
    
    for (const student of studentUsers.rows) {
      const admissionNumber = `STU${Date.now()}${Math.floor(Math.random() * 1000)}`;
      await client.query(`
        INSERT INTO students (user_id, admission_number, enrollment_status, created_at, updated_at)
        VALUES ($1, $2, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [student.id, admissionNumber]);
      console.log(`  ✓ Created student record for: ${student.email} (Admission: ${admissionNumber})`);
    }
    
    await client.query('COMMIT');
    
    console.log('\n========================================');
    console.log('✅ DATABASE RESET COMPLETED SUCCESSFULLY!');
    console.log('========================================');
    console.log(`📊 Total users created: ${insertedCount}`);
    console.log(`👥 Total students: ${studentUsers.rows.length}`);
    
    console.log('\n========================================');
    console.log('📋 WORKING CREDENTIALS:');
    console.log('========================================\n');
    
    console.log('🔑 ADMIN ACCOUNTS (Password: admin123):');
    console.log('   • admin@shuleconnect.com (Super Admin)');
    console.log('   • schooladmin@shuleconnect.com (School Admin)');
    console.log('   • accountant@shuleconnect.com (Accountant)');
    console.log('   • librarian@shuleconnect.com (Librarian)');
    console.log('   • transport@shuleconnect.com (Transport Manager)');
    console.log('   • hostel@shuleconnect.com (Hostel Manager)');
    
    console.log('\n👨‍🏫 TEACHER ACCOUNTS (Password: teacher123):');
    console.log('   • john.teacher@shuleconnect.com');
    console.log('   • mary.teacher@shuleconnect.com');
    console.log('   • peter.teacher@shuleconnect.com');
    console.log('   • grace.teacher@shuleconnect.com');
    
    console.log('\n👨‍🎓 STUDENT ACCOUNTS (Password: student123):');
    console.log('   • james.student@shuleconnect.com');
    console.log('   • sarah.student@shuleconnect.com');
    console.log('   • michael.student@shuleconnect.com');
    console.log('   • esther.student@shuleconnect.com');
    
    console.log('\n👪 PARENT ACCOUNTS (Password: parent123):');
    console.log('   • robert.parent@shuleconnect.com');
    console.log('   • ann.parent@shuleconnect.com');
    console.log('   • john.parent@shuleconnect.com');
    
    console.log('\n👔 NON-TEACHING STAFF (Password: staff123):');
    console.log('   • reception@shuleconnect.com');
    console.log('   • nurse@shuleconnect.com');
    console.log('   • security@shuleconnect.com');
    
    console.log('\n========================================');
    console.log('🎯 You can now login with any of these credentials');
    console.log('========================================\n');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\n❌ Error during database reset:', error.message);
    console.error(error);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the reset
resetAllUsers();