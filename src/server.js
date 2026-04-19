// backend/src/server.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

// Route imports
const librarianRoutes = require('./routes/librarian');
const accountantRoutes = require('./routes/accountant');

// Load environment variables
dotenv.config();

const app = express();
const server = http.createServer(app);

// Allowed origins for CORS
const allowedOrigins = [
  'http://localhost:3000',
  'https://shuleconnect-frontend.onrender.com',
  process.env.FRONTEND_URL
].filter(Boolean);

// Socket.io with CORS
const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
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
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
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

// ==================== MIDDLEWARE ====================

// Helmet for security (configured for production)
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" }
}));

// CORS middleware - Allow multiple origins
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('Blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
app.use('/api/students', require('./routes/students'));
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
    environment: process.env.NODE_ENV || 'development',
    cors: allowedOrigins
  });
});

// Simple root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'ShuleConnect API Server',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      users: '/api/users',
      students: '/api/students',
      classes: '/api/classes'
    }
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
  
  // Handle CORS errors
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ 
      error: 'CORS error: Origin not allowed',
      allowedOrigins: allowedOrigins
    });
  }
  
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
║   🔗 CORS Allowed Origins: ${allowedOrigins.join(', ')}║
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