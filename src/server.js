// backend/src/server.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
// Add this line with the other route imports
const librarianRoutes = require('./routes/librarian');
const accountantRoutes = require('./routes/accountant');

// Load environment variables
dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
  }
});

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'shuleconnect002',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Test database connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to database:', err.message);
  } else {
    console.log('Connected to PostgreSQL database');
    release();
  }
});

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Make db pool available to routes
app.use((req, res, next) => {
  req.db = pool;
  next();
});

// Make io available to routes
app.use((req, res, next) => {
  req.io = io;
  next();
});

// ==================== ROUTES ====================
// Authentication & Users
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));

// Core Modules
app.use('/api/students', require('./routes/students'));  // Changed from unifiedStudents
app.use('/api/classes', require('./routes/classes'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/results', require('./routes/results'));
app.use('/api/fees', require('./routes/fees'));
app.use('/api/timetable', require('./routes/timetable'));
app.use('/api/library', require('./routes/library'));
app.use('/api/communication', require('./routes/communication'));
app.use('/api/debug', require('./routes/debug'));
app.use('/api/portal', require('./routes/portal'));
app.use('/api/messaging', require('./routes/messaging'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/hr', require('./routes/hr'));
app.use('/api/hostel', require('./routes/hostel'));
app.use('/api/system', require('./routes/systemAdmin'));
app.use('/api/transport', require('./routes/transport'));
app.use('/api/student', require('./routes/studentPortal'));
app.use('/api/parent', require('./routes/parentPortal'));
app.use('/api/teacher', require('./routes/teacher'));
app.use('/api/librarian', librarianRoutes);
app.use('/api/accountant', accountantRoutes);

// ==================== HEALTH CHECK ====================
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// ==================== ERROR HANDLING ====================
// 404 handler for undefined routes
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    path: req.originalUrl,
    method: req.method
  });
});

// Global error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(500).json({ 
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// ==================== SOCKET.IO ====================
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  socket.on('join_user', (userId) => {
    socket.join(`user_${userId}`);
    console.log(`User ${userId} joined their room`);
  });
  
  socket.on('join_school', (schoolId) => {
    socket.join(`school_${schoolId}`);
    console.log(`Joined school room: ${schoolId}`);
  });
  
  socket.on('send_notification', (data) => {
    io.to(`user_${data.userId}`).emit('new_notification', data.notification);
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// ==================== START SERVER ====================
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║   🚀 ShuleConnect Backend Server Running              ║
║                                                       ║
║   📡 Port: ${PORT}                                       ║
║   🌍 Environment: ${process.env.NODE_ENV || 'development'}                  ║
║   🗄️  Database: ${process.env.DB_NAME || 'shuleconnect002'}               ║
║                                                       ║
║   ✅ API Ready at: http://localhost:${PORT}/api        ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
  `);
});

// ==================== GRACEFUL SHUTDOWN ====================
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    pool.end(() => {
      console.log('Database pool closed');
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    pool.end(() => {
      console.log('Database pool closed');
      process.exit(0);
    });
  });
});