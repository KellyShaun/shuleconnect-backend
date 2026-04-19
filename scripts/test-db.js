const { Pool } = require('pg');
const path = require('path');

// Load .env from the backend root folder
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

console.log('Testing database connection...');
console.log('Current directory:', __dirname);
console.log('Loading .env from:', path.join(__dirname, '..', '.env'));
console.log('\nDB Config:', {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD ? '***provided***' : 'MISSING!'
});

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'shuleconnect002',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});

async function testConnection() {
  try {
    const result = await pool.query('SELECT NOW() as time, current_database() as db');
    console.log('\n✅ Database connected successfully!');
    console.log('   Database:', result.rows[0].db);
    console.log('   Time:', result.rows[0].time);
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Database connection failed:', error.message);
    console.error('\n💡 Troubleshooting:');
    console.error('   1. Is PostgreSQL running?');
    console.error('   2. Check your password in .env file');
    console.error('   3. Verify the database "shuleconnect002" exists');
    process.exit(1);
  }
}

testConnection();