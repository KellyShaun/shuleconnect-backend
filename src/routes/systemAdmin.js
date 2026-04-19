const express = require('express');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const {
    getSystemSettings,
    updateSystemSetting,
    getAuditLogs,
    exportAuditLogs,
    createBackup,
    getBackups,
    restoreBackup,
    deleteBackup,
    getSystemHealth,
    getErrorLogs,
    resolveError,
    getGatewayConfigs,
    updateGatewayConfig,
    testGateway,
    getSecuritySettings,
    updateSecuritySettings,
    getRolePermissions,
    updateRolePermission,
    getSystemDashboard
} = require('../controllers/systemAdminController');

const router = express.Router();

// All routes require super_admin or school_admin role
router.use(authenticateToken);
router.use(authorizeRole('super_admin', 'school_admin'));

// Dashboard
router.get('/dashboard', getSystemDashboard);

// System Settings
router.get('/settings', getSystemSettings);
router.put('/settings', updateSystemSetting);

// Audit Logs
router.get('/audit-logs', getAuditLogs);
router.get('/audit-logs/export', exportAuditLogs);

// Backups
router.post('/backups', createBackup);
router.get('/backups', getBackups);
router.post('/backups/:backup_id/restore', restoreBackup);
router.delete('/backups/:backup_id', deleteBackup);

// System Health
router.get('/health', getSystemHealth);

// Error Logs
router.get('/error-logs', getErrorLogs);
router.post('/error-logs/:error_id/resolve', resolveError);

// Gateway Configurations
router.get('/gateways', getGatewayConfigs);
router.put('/gateways/:id', updateGatewayConfig);
router.post('/gateways/:id/test', testGateway);

// Security Settings
router.get('/security', getSecuritySettings);
router.put('/security', updateSecuritySettings);

// Role Permissions
router.get('/permissions', getRolePermissions);
router.post('/permissions', updateRolePermission);

module.exports = router;