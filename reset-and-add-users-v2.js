const { Pool } = require('pg');
require('dotenv').config();
const bcrypt = require('bcryptjs');

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'shuleconnect002',
});

// Helper function to generate admission number
function generateAdmissionNumber() {
    const year = new Date().getFullYear();
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `${year}${random}`;
}

async function resetAndAddUsers() {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        console.log('=' .repeat(70));
        console.log('🔄 RESETTING AND ADDING ALL USERS TO SHULECONNECT');
        console.log('=' .repeat(70));
        
        // =====================================================
        // DELETE ALL EXISTING USERS AND RELATED DATA
        // =====================================================
        console.log('\n🗑️  Deleting existing users and related data...');
        
        // Delete in correct order to avoid foreign key constraints
        await client.query('DELETE FROM student_parents');
        await client.query('DELETE FROM students');
        await client.query('DELETE FROM user_sessions');
        await client.query('DELETE FROM user_preferences');
        await client.query('DELETE FROM activity_logs');
        await client.query('DELETE FROM notifications');
        await client.query('DELETE FROM leave_requests');
        await client.query('DELETE FROM attendance');
        await client.query('DELETE FROM borrowings');
        await client.query('DELETE FROM results');
        await client.query('DELETE FROM payments');
        await client.query('DELETE FROM student_fees');
        await client.query('DELETE FROM users');
        
        console.log('✅ All existing users deleted');
        
        // Reset sequences (only if they exist)
        try {
            await client.query('ALTER SEQUENCE IF EXISTS users_id_seq RESTART WITH 1');
            await client.query('ALTER SEQUENCE IF EXISTS students_id_seq RESTART WITH 1');
            await client.query('ALTER SEQUENCE IF EXISTS student_parents_id_seq RESTART WITH 1');
            console.log('✅ Sequences reset');
        } catch (err) {
            console.log('⚠️ Sequences reset skipped (some sequences may not exist)');
        }
        
        // Ensure school exists
        await client.query(`
            INSERT INTO schools (id, name, code, curriculum, address, phone, email, is_active)
            VALUES (1, 'ShuleConnect Demo School', 'DEMO001', '844', 'Nairobi, Kenya', '+254700000000', 'info@shuleconnect.com', true)
            ON CONFLICT (id) DO NOTHING
        `);
        console.log('✅ School verified/created');
        
        // =====================================================
        // CREATE CLASSES
        // =====================================================
        console.log('\n📖 Creating Classes...');
        
        const classes = [
            { id: 1, name: 'Form 1 East', class_level: 1, capacity: 45 },
            { id: 2, name: 'Form 1 West', class_level: 1, capacity: 45 },
            { id: 3, name: 'Form 2 East', class_level: 2, capacity: 45 },
            { id: 4, name: 'Form 2 West', class_level: 2, capacity: 45 },
            { id: 5, name: 'Form 3 East', class_level: 3, capacity: 45 },
            { id: 6, name: 'Form 3 West', class_level: 3, capacity: 45 },
            { id: 7, name: 'Form 4 East', class_level: 4, capacity: 45 },
            { id: 8, name: 'Form 4 West', class_level: 4, capacity: 45 }
        ];
        
        for (const cls of classes) {
            await client.query(`
                INSERT INTO classes (id, school_id, name, class_level, capacity, is_active)
                VALUES ($1, 1, $2, $3, $4, true)
                ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
            `, [cls.id, cls.name, cls.class_level, cls.capacity]);
        }
        console.log('  ✓ Classes created/verified');
        
        // =====================================================
        // CREATE SUBJECTS
        // =====================================================
        console.log('\n📚 Creating Subjects...');
        
        const subjects = [
            'Mathematics', 'English', 'Kiswahili', 'Biology', 'Chemistry', 'Physics',
            'History', 'Geography', 'CRE', 'Business Studies', 'Agriculture', 'Computer Studies'
        ];
        
        for (const subject of subjects) {
            const existing = await client.query(`
                SELECT id FROM subjects WHERE name = $1 AND school_id = 1
            `, [subject]);
            
            if (existing.rows.length === 0) {
                await client.query(`
                    INSERT INTO subjects (school_id, name, code, is_active)
                    VALUES (1, $1, $2, true)
                `, [subject, subject.substring(0, 3).toUpperCase()]);
                console.log(`  ✓ Created subject: ${subject}`);
            } else {
                console.log(`  ⚠️ Subject already exists: ${subject}`);
            }
        }
        
        const defaultPassword = 'admin123';
        const hashedPassword = await bcrypt.hash(defaultPassword, 10);
        
        // =====================================================
        // 1. ADMIN USERS
        // =====================================================
        console.log('\n👑 Adding Admin Users...');
        
        const admins = [
            { username: 'superadmin', email: 'superadmin@shuleconnect.com', phone: '0711111111', first_name: 'Super', last_name: 'Admin', role: 'super_admin' },
            { username: 'schooladmin', email: 'schooladmin@shuleconnect.com', phone: '0722222222', first_name: 'School', last_name: 'Admin', role: 'school_admin' }
        ];
        
        for (const admin of admins) {
            await client.query(`
                INSERT INTO users (school_id, username, email, phone, first_name, last_name, password_hash, role, is_active)
                VALUES (1, $1, $2, $3, $4, $5, $6, $7, true)
            `, [admin.username, admin.email, admin.phone, admin.first_name, admin.last_name, hashedPassword, admin.role]);
            console.log(`  ✓ Created ${admin.role}: ${admin.email}`);
        }
        
        // =====================================================
        // 2. TEACHERS
        // =====================================================
        console.log('\n👨‍🏫 Adding Teachers...');
        
        const teachers = [
            { username: 'john.odhiambo', email: 'john.odhiambo@shuleconnect.com', phone: '0733333333', first_name: 'John', last_name: 'Odhiambo', subject: 'Mathematics' },
            { username: 'mary.wanjiku', email: 'mary.wanjiku@shuleconnect.com', phone: '0744444444', first_name: 'Mary', last_name: 'Wanjiku', subject: 'English' },
            { username: 'peter.otieno', email: 'peter.otieno@shuleconnect.com', phone: '0755555555', first_name: 'Peter', last_name: 'Otieno', subject: 'Kiswahili' },
            { username: 'grace.muthoni', email: 'grace.muthoni@shuleconnect.com', phone: '0766666666', first_name: 'Grace', last_name: 'Muthoni', subject: 'Biology' },
            { username: 'james.kariuki', email: 'james.kariuki@shuleconnect.com', phone: '0777777777', first_name: 'James', last_name: 'Kariuki', subject: 'Chemistry' },
            { username: 'lucia.akinyi', email: 'lucia.akinyi@shuleconnect.com', phone: '0788888888', first_name: 'Lucia', last_name: 'Akinyi', subject: 'Physics' },
            { username: 'daniel.mwangi', email: 'daniel.mwangi@shuleconnect.com', phone: '0799999999', first_name: 'Daniel', last_name: 'Mwangi', subject: 'History' },
            { username: 'sarah.chebet', email: 'sarah.chebet@shuleconnect.com', phone: '0700000000', first_name: 'Sarah', last_name: 'Chebet', subject: 'Geography' }
        ];
        
        for (const teacher of teachers) {
            await client.query(`
                INSERT INTO users (school_id, username, email, phone, first_name, last_name, password_hash, role, is_active)
                VALUES (1, $1, $2, $3, $4, $5, $6, 'teacher', true)
            `, [teacher.username, teacher.email, teacher.phone, teacher.first_name, teacher.last_name, hashedPassword]);
            console.log(`  ✓ Created teacher: ${teacher.first_name} ${teacher.last_name} (${teacher.subject})`);
        }
        
        // =====================================================
        // 3. STUDENTS
        // =====================================================
        console.log('\n🎓 Adding Students...');
        
        const students = [
            { username: 'james.kamau', email: 'james.kamau@student.com', phone: '0712345678', first_name: 'James', last_name: 'Kamau', class_id: 1, stream: 'East' },
            { username: 'sarah.wambui', email: 'sarah.wambui@student.com', phone: '0723456789', first_name: 'Sarah', last_name: 'Wambui', class_id: 1, stream: 'East' },
            { username: 'michael.otieno', email: 'michael.otieno@student.com', phone: '0734567890', first_name: 'Michael', last_name: 'Otieno', class_id: 2, stream: 'West' },
            { username: 'esther.chebet', email: 'esther.chebet@student.com', phone: '0745678901', first_name: 'Esther', last_name: 'Chebet', class_id: 2, stream: 'West' },
            { username: 'david.maina', email: 'david.maina@student.com', phone: '0756789012', first_name: 'David', last_name: 'Maina', class_id: 3, stream: 'East' },
            { username: 'lilian.akoth', email: 'lilian.akoth@student.com', phone: '0767890123', first_name: 'Lilian', last_name: 'Akoth', class_id: 3, stream: 'East' },
            { username: 'brian.odero', email: 'brian.odero@student.com', phone: '0778901234', first_name: 'Brian', last_name: 'Odero', class_id: 4, stream: 'West' },
            { username: 'faith.nduta', email: 'faith.nduta@student.com', phone: '0789012345', first_name: 'Faith', last_name: 'Nduta', class_id: 4, stream: 'West' },
            { username: 'kelvin.mbugua', email: 'kelvin.mbugua@student.com', phone: '0790123456', first_name: 'Kelvin', last_name: 'Mbugua', class_id: 5, stream: 'East' },
            { username: 'joyce.wanjiru', email: 'joyce.wanjiru@student.com', phone: '0701234567', first_name: 'Joyce', last_name: 'Wanjiru', class_id: 5, stream: 'East' }
        ];
        
        for (const student of students) {
            // Create user
            const result = await client.query(`
                INSERT INTO users (school_id, username, email, phone, first_name, last_name, password_hash, role, is_active)
                VALUES (1, $1, $2, $3, $4, $5, $6, 'student', true)
                RETURNING id
            `, [student.username, student.email, student.phone, student.first_name, student.last_name, hashedPassword]);
            
            const userId = result.rows[0].id;
            const admissionNumber = generateAdmissionNumber();
            
            // Create student record
            await client.query(`
                INSERT INTO students (user_id, admission_number, class_id, stream, admission_date, enrollment_status)
                VALUES ($1, $2, $3, $4, CURRENT_DATE, 'active')
            `, [userId, admissionNumber, student.class_id, student.stream]);
            
            console.log(`  ✓ Created student: ${student.first_name} ${student.last_name} (${admissionNumber})`);
        }
        
        // =====================================================
        // 4. PARENTS
        // =====================================================
        console.log('\n👪 Adding Parents...');
        
        const parents = [
            { username: 'robert.kamau', email: 'robert.kamau@parent.com', phone: '0711111111', first_name: 'Robert', last_name: 'Kamau', student_username: 'james.kamau', relationship: 'Father' },
            { username: 'ann.wambui', email: 'ann.wambui@parent.com', phone: '0722222222', first_name: 'Ann', last_name: 'Wambui', student_username: 'sarah.wambui', relationship: 'Mother' },
            { username: 'john.otieno', email: 'john.otieno@parent.com', phone: '0733333333', first_name: 'John', last_name: 'Otieno', student_username: 'michael.otieno', relationship: 'Father' },
            { username: 'mary.chebet', email: 'mary.chebet@parent.com', phone: '0744444444', first_name: 'Mary', last_name: 'Chebet', student_username: 'esther.chebet', relationship: 'Mother' },
            { username: 'peter.maina', email: 'peter.maina@parent.com', phone: '0755555555', first_name: 'Peter', last_name: 'Maina', student_username: 'david.maina', relationship: 'Father' }
        ];
        
        for (const parent of parents) {
            // Create parent user
            const result = await client.query(`
                INSERT INTO users (school_id, username, email, phone, first_name, last_name, password_hash, role, is_active)
                VALUES (1, $1, $2, $3, $4, $5, $6, 'parent', true)
                RETURNING id
            `, [parent.username, parent.email, parent.phone, parent.first_name, parent.last_name, hashedPassword]);
            
            const parentId = result.rows[0].id;
            
            // Get student ID
            const studentResult = await client.query(`
                SELECT s.id FROM students s
                JOIN users u ON s.user_id = u.id
                WHERE u.username = $1
            `, [parent.student_username]);
            
            if (studentResult.rows.length > 0) {
                const studentId = studentResult.rows[0].id;
                
                await client.query(`
                    INSERT INTO student_parents (student_id, parent_id, relationship, is_primary)
                    VALUES ($1, $2, $3, true)
                `, [studentId, parentId, parent.relationship]);
                console.log(`  ✓ Created parent: ${parent.first_name} ${parent.last_name} → ${parent.student_username}`);
            }
        }
        
        // =====================================================
        // 5. ACCOUNTANT
        // =====================================================
        console.log('\n💰 Adding Accountant...');
        
        await client.query(`
            INSERT INTO users (school_id, username, email, phone, first_name, last_name, password_hash, role, is_active)
            VALUES (1, 'accountant', 'accountant@shuleconnect.com', '0766666666', 'Finance', 'Officer', $1, 'accountant', true)
        `, [hashedPassword]);
        console.log('  ✓ Created Accountant: accountant@shuleconnect.com');
        
        // =====================================================
        // 6. LIBRARIAN
        // =====================================================
        console.log('\n📚 Adding Librarian...');
        
        await client.query(`
            INSERT INTO users (school_id, username, email, phone, first_name, last_name, password_hash, role, is_active)
            VALUES (1, 'librarian', 'librarian@shuleconnect.com', '0777777777', 'Library', 'Manager', $1, 'librarian', true)
        `, [hashedPassword]);
        console.log('  ✓ Created Librarian: librarian@shuleconnect.com');
        
        // =====================================================
        // 7. TRANSPORT MANAGER
        // =====================================================
        console.log('\n🚌 Adding Transport Manager...');
        
        await client.query(`
            INSERT INTO users (school_id, username, email, phone, first_name, last_name, password_hash, role, is_active)
            VALUES (1, 'transport.manager', 'transport@shuleconnect.com', '0788888888', 'Transport', 'Manager', $1, 'transport_manager', true)
        `, [hashedPassword]);
        console.log('  ✓ Created Transport Manager: transport@shuleconnect.com');
        
        // =====================================================
        // 8. HOSTEL MANAGER
        // =====================================================
        console.log('\n🏠 Adding Hostel Manager...');
        
        await client.query(`
            INSERT INTO users (school_id, username, email, phone, first_name, last_name, password_hash, role, is_active)
            VALUES (1, 'hostel.manager', 'hostel@shuleconnect.com', '0799999999', 'Hostel', 'Manager', $1, 'hostel_manager', true)
        `, [hashedPassword]);
        console.log('  ✓ Created Hostel Manager: hostel@shuleconnect.com');
        
        // =====================================================
        // 9. NON-TEACHING STAFF
        // =====================================================
        console.log('\n👔 Adding Non-Teaching Staff...');
        
        const staff = [
            { username: 'receptionist', email: 'reception@shuleconnect.com', phone: '0711111111', first_name: 'Alice', last_name: 'Wanjiku', position: 'Receptionist' },
            { username: 'nurse', email: 'nurse@shuleconnect.com', phone: '0722222222', first_name: 'Grace', last_name: 'Muthoni', position: 'School Nurse' },
            { username: 'security', email: 'security@shuleconnect.com', phone: '0733333333', first_name: 'John', last_name: 'Kimani', position: 'Security Officer' },
            { username: 'cook', email: 'cook@shuleconnect.com', phone: '0744444444', first_name: 'Mary', last_name: 'Atieno', position: 'Head Cook' },
            { username: 'groundskeeper', email: 'grounds@shuleconnect.com', phone: '0755555555', first_name: 'Peter', last_name: 'Omondi', position: 'Groundskeeper' }
        ];
        
        for (const staffMember of staff) {
            await client.query(`
                INSERT INTO users (school_id, username, email, phone, first_name, last_name, password_hash, role, is_active)
                VALUES (1, $1, $2, $3, $4, $5, $6, 'non_teaching_staff', true)
            `, [staffMember.username, staffMember.email, staffMember.phone, staffMember.first_name, staffMember.last_name, hashedPassword]);
            console.log(`  ✓ Created ${staffMember.position}: ${staffMember.first_name} ${staffMember.last_name}`);
        }
        
        // =====================================================
        // COMMIT AND SUMMARY
        // =====================================================
        await client.query('COMMIT');
        
        // Get summary
        const summary = await pool.query(`
            SELECT role, COUNT(*) as count FROM users WHERE school_id = 1 GROUP BY role ORDER BY count DESC
        `);
        
        const classSummary = await pool.query(`SELECT COUNT(*) as count FROM classes WHERE school_id = 1`);
        const subjectSummary = await pool.query(`SELECT COUNT(*) as count FROM subjects WHERE school_id = 1`);
        const studentSummary = await pool.query(`SELECT COUNT(*) as count FROM students`);
        
        console.log('\n' + '=' .repeat(70));
        console.log('✅ ALL USERS ADDED SUCCESSFULLY!');
        console.log('=' .repeat(70));
        console.log('\n📊 SUMMARY:');
        console.log('-'.repeat(50));
        console.log(`  Classes      : ${classSummary.rows[0].count}`);
        console.log(`  Subjects     : ${subjectSummary.rows[0].count}`);
        console.log(`  Students     : ${studentSummary.rows[0].count}`);
        console.log('-'.repeat(50));
        summary.rows.forEach(row => {
            console.log(`  ${row.role.padEnd(22)} : ${row.count}`);
        });
        console.log('-'.repeat(50));
        
        console.log('\n🔑 DEFAULT PASSWORD FOR ALL USERS: admin123');
        console.log('\n📝 LOGIN CREDENTIALS:');
        console.log('=' .repeat(70));
        console.log('  Role                | Email');
        console.log('=' .repeat(70));
        console.log('  Super Admin         | superadmin@shuleconnect.com');
        console.log('  School Admin        | schooladmin@shuleconnect.com');
        console.log('  Teacher             | john.odhiambo@shuleconnect.com');
        console.log('  Student             | james.kamau@student.com');
        console.log('  Parent              | robert.kamau@parent.com');
        console.log('  Accountant          | accountant@shuleconnect.com');
        console.log('  Librarian           | librarian@shuleconnect.com');
        console.log('  Transport Manager   | transport@shuleconnect.com');
        console.log('  Hostel Manager      | hostel@shuleconnect.com');
        console.log('  Receptionist        | reception@shuleconnect.com');
        console.log('  School Nurse        | nurse@shuleconnect.com');
        console.log('=' .repeat(70));
        
        console.log('\n🌐 ACCESS URLS:');
        console.log('-'.repeat(70));
        console.log('  Frontend: http://localhost:3000');
        console.log('  Backend API: http://localhost:5000');
        console.log('-'.repeat(70));
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error:', error.message);
    } finally {
        client.release();
        process.exit(0);
    }
}

resetAndAddUsers();