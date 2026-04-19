const axios = require('axios');
const baseURL = 'http://localhost:5000/api/auth/login';

const testCredentials = [
  { email: 'superadmin@shuleconnect.com', password: 'admin123', role: 'Super Admin' },
  { email: 'schooladmin@shuleconnect.com', password: 'admin123', role: 'School Admin' },
  { email: 'john.odhiambo@shuleconnect.com', password: 'teacher123', role: 'Teacher' },
  { email: 'james.kamau@student.com', password: 'student123', role: 'Student' },
  { email: 'robert.kamau@parent.com', password: 'parent123', role: 'Parent' },
  { email: 'accountant@shuleconnect.com', password: 'admin123', role: 'Accountant' },
  { email: 'reception@shuleconnect.com', password: 'staff123', role: 'Receptionist' }
];

async function testAllLogins() {
  console.log('Testing all user logins...\n');
  
  for (const cred of testCredentials) {
    try {
      const response = await axios.post(baseURL, cred, {
        headers: { 'Content-Type': 'application/json' }
      });
      
      console.log(`✅ ${cred.role}: ${cred.email}`);
      console.log(`   Token received: ${response.data.accessToken.substring(0, 50)}...\n`);
      
    } catch (error) {
      console.log(`❌ ${cred.role}: ${cred.email}`);
      console.log(`   Error: ${error.response?.data?.error || error.message}\n`);
    }
  }
}

testAllLogins();