require('dotenv').config({ path: '.env.production' });

console.log('\n========================================');
console.log('🔍 Testing Production Configuration');
console.log('========================================\n');

// Check required environment variables
const requiredVars = [
  'DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME',
  'JWT_SECRET', 'JWT_REFRESH_SECRET', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'
];

let missingVars = [];
requiredVars.forEach(varName => {
  if (!process.env[varName]) {
    missingVars.push(varName);
  }
});

if (missingVars.length > 0) {
  console.error('❌ Missing environment variables:', missingVars.join(', '));
  process.exit(1);
}

console.log('✅ All required environment variables are set\n');

// Test database connection
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

async function testDatabase() {
  console.log('📡 Testing database connection...');
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as time, current_database() as db_name');
    console.log('✅ Database connected successfully!');
    console.log(`   Database: ${result.rows[0].db_name}`);
    console.log(`   Server time: ${result.rows[0].time}`);
    client.release();
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
}

// Test Cloudinary (if configured)
async function testCloudinary() {
  if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY) {
    console.log('\n📁 Testing Cloudinary connection...');
    try {
      const cloudinary = require('cloudinary').v2;
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
      });
      const result = await cloudinary.api.ping();
      console.log('✅ Cloudinary connected successfully!');
      return true;
    } catch (error) {
      console.log('⚠️ Cloudinary not configured or connection failed');
      return false;
    }
  }
  return false;
}

// Test Resend email (if configured)
async function testResend() {
  if (process.env.RESEND_API_KEY) {
    console.log('\n📧 Testing Resend email service...');
    try {
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      console.log('✅ Resend API key configured');
      return true;
    } catch (error) {
      console.log('⚠️ Resend not configured');
      return false;
    }
  }
  return false;
}

async function runTests() {
  const dbOk = await testDatabase();
  await testCloudinary();
  await testResend();
  
  console.log('\n========================================');
  if (dbOk) {
    console.log('✅ PRODUCTION CONFIGURATION IS READY!');
    console.log('========================================\n');
    process.exit(0);
  } else {
    console.log('❌ Please fix the database connection issues');
    console.log('========================================\n');
    process.exit(1);
  }
}

runTests();