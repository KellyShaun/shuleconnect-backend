const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'shuleconnect002',
  connectionTimeoutMillis: 10000,
});

async function testConnection() {
  console.log('Testing database connection...');
  console.log(`Host: ${process.env.DB_HOST}`);
  console.log(`Port: ${process.env.DB_PORT}`);
  console.log(`User: ${process.env.DB_USER}`);
  console.log(`Database: ${process.env.DB_NAME}`);
  
  try {
    const client = await pool.connect();
    console.log('✅ Successfully connected to database!');
    
    const result = await client.query('SELECT NOW() as current_time');
    console.log(`📅 Database time: ${result.rows[0].current_time}`);
    
    client.release();
    process.exit(0);
  } catch (err) {
    console.error('❌ Connection failed:', err.message);
    console.log('\nCheck your .env file password');
    process.exit(1);
  }
}

testConnection();