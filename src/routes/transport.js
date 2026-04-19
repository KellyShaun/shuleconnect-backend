const express = require('express');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const {
    getDrivers,
    createDriver,
    getVehicles,
    createVehicle,
    assignDriver,
    getRoutes,
    createRoute,
    getRouteStops,
    addRouteStop,
    assignStudentToRoute,
    getStudentTransportInfo,
    updateVehicleLocation,
    getVehicleLocation,
    addMaintenanceRecord,
    getTransportDashboard
} = require('../controllers/transportController');

const router = express.Router();

// Dashboard
router.get('/dashboard', authenticateToken, getTransportDashboard);

// Comment out the manager dashboard for now
// router.get('/manager/dashboard', authenticateToken, getTransportManagerDashboard);

// Drivers
router.get('/drivers', authenticateToken, getDrivers);
router.post('/drivers', authenticateToken, authorizeRole('school_admin'), createDriver);

// Vehicles
router.get('/vehicles', authenticateToken, getVehicles);
router.post('/vehicles', authenticateToken, authorizeRole('school_admin'), createVehicle);
router.post('/vehicles/assign-driver', authenticateToken, authorizeRole('school_admin'), assignDriver);

// Routes
router.get('/routes', authenticateToken, getRoutes);
router.post('/routes', authenticateToken, authorizeRole('school_admin'), createRoute);
router.get('/route-stops', authenticateToken, getRouteStops);
router.post('/route-stops', authenticateToken, authorizeRole('school_admin'), addRouteStop);

// Student assignments
router.post('/assign-student', authenticateToken, authorizeRole('school_admin'), assignStudentToRoute);
router.get('/student/:student_id/transport', authenticateToken, getStudentTransportInfo);

// GPS Tracking
router.post('/gps/update', authenticateToken, updateVehicleLocation);
router.get('/gps/vehicle/:vehicle_id', authenticateToken, getVehicleLocation);

// Maintenance
router.post('/maintenance', authenticateToken, authorizeRole('school_admin'), addMaintenanceRecord);

module.exports = router;