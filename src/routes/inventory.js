const express = require('express');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const {
    getAssetCategories,
    createAssetCategory,
    getAssets,
    getAssetById,
    createAsset,
    updateAsset,
    deleteAsset,
    assignAsset,
    returnAsset,
    addMaintenanceRecord,
    createRepairRequest,
    getStockItems,
    createStockItem,
    updateStockQuantity,
    getInventoryDashboard
} = require('../controllers/inventoryController');

const router = express.Router();

// Categories
router.get('/categories', authenticateToken, getAssetCategories);
router.post('/categories', authenticateToken, authorizeRole('school_admin'), createAssetCategory);

// Assets
router.get('/assets', authenticateToken, getAssets);
router.get('/assets/:id', authenticateToken, getAssetById);
router.post('/assets', authenticateToken, authorizeRole('school_admin'), createAsset);
router.put('/assets/:id', authenticateToken, authorizeRole('school_admin'), updateAsset);
router.delete('/assets/:id', authenticateToken, authorizeRole('school_admin'), deleteAsset);

// Asset Assignments
router.post('/assignments', authenticateToken, authorizeRole('school_admin'), assignAsset);
router.post('/assignments/return', authenticateToken, authorizeRole('school_admin'), returnAsset);

// Maintenance
router.post('/maintenance', authenticateToken, authorizeRole('school_admin'), addMaintenanceRecord);
router.post('/repair-requests', authenticateToken, createRepairRequest);

// Stock Management
router.get('/stock', authenticateToken, getStockItems);
router.post('/stock', authenticateToken, authorizeRole('school_admin'), createStockItem);
router.put('/stock/:id/quantity', authenticateToken, authorizeRole('school_admin'), updateStockQuantity);

// Dashboard
router.get('/dashboard', authenticateToken, getInventoryDashboard);

module.exports = router;