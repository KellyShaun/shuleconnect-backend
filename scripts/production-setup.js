const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('\n========================================');
console.log('🔧 ShuleConnect Production Setup');
console.log('========================================\n');

// Check Node.js version
const nodeVersion = process.version;
console.log(`📦 Node.js version: ${nodeVersion}`);
if (parseInt(nodeVersion.slice(1)) < 18) {
  console.error('❌ Node.js 18+ is required for production');
  process.exit(1);
}

// Generate secure secrets
const generateSecret = (length = 32) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

console.log('\n🔐 Generating secure configuration...\n');

const productionEnv = `# Server Configuration
NODE_ENV=production
PORT=5000

# Database Configuration (UPDATE THESE!)
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=CHANGE_THIS_TO_YOUR_DATABASE_PASSWORD
DB_NAME=shuleconnect_prod

# JWT Secrets (Auto-generated - Save these!)
JWT_SECRET=${generateSecret(64)}
JWT_REFRESH_SECRET=${generateSecret(64)}

# Frontend URL (UPDATE THIS!)
FRONTEND_URL=https://yourdomain.com

# Email Configuration (UPDATE THIS!)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASSWORD=your_app_password
SMTP_FROM=noreply@shuleconnect.com

# Security
BCRYPT_ROUNDS=12
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Session
SESSION_SECRET=${generateSecret(32)}

# Logging
LOG_LEVEL=info
LOG_DIR=logs

# CORS
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
`;

fs.writeFileSync('.env.production', productionEnv);
console.log('✅ Created .env.production file');
console.log('⚠️  IMPORTANT: Update database credentials and domain in .env.production\n');

// Install production dependencies
console.log('📦 Installing production dependencies...');
try {
  execSync('npm ci --production', { stdio: 'inherit' });
  console.log('✅ Dependencies installed\n');
} catch (error) {
  console.error('❌ Failed to install dependencies:', error.message);
}

// Create logs directory
if (!fs.existsSync('logs')) {
  fs.mkdirSync('logs');
  console.log('✅ Created logs directory\n');
}

console.log('========================================');
console.log('✅ Production setup complete!');
console.log('========================================\n');
console.log('Next steps:');
console.log('1. Update .env.production with your database credentials');
console.log('2. Update FRONTEND_URL to your domain');
console.log('3. Configure email settings');
console.log('4. Run: npm run prod\n');

rl.close();