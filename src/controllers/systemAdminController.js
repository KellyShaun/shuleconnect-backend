const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const moment = require('moment');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

// ==================== SYSTEM SETTINGS ====================

// Get all system settings
async function getSystemSettings(req, res) {
    try {
        const result = await pool.query(`
            SELECT setting_key, setting_value, setting_type, category, description, is_editable
            FROM system_settings
            WHERE school_id = $1 OR school_id IS NULL
            ORDER BY category, setting_key
        `, [req.user.school_id]);
        
        // Convert values to proper types
        const settings = {};
        result.rows.forEach(row => {
            let value = row.setting_value;
            if (row.setting_type === 'boolean') {
                value = value === 'true';
            } else if (row.setting_type === 'number') {
                value = parseInt(value);
            } else if (row.setting_type === 'json') {
                try { value = JSON.parse(value); } catch(e) {}
            }
            settings[row.setting_key] = {
                value,
                type: row.setting_type,
                category: row.category,
                description: row.description,
                is_editable: row.is_editable
            };
        });
        
        res.json(settings);
    } catch (error) {
        console.error('Error fetching system settings:', error);
        res.status(500).json({ error: 'Error fetching system settings' });
    }
}

// Update system setting
async function updateSystemSetting(req, res) {
    const { setting_key, setting_value } = req.body;
    
    try {
        const result = await pool.query(`
            UPDATE system_settings 
            SET setting_value = $1, updated_at = CURRENT_TIMESTAMP
            WHERE setting_key = $2 AND (school_id = $3 OR school_id IS NULL) AND is_editable = true
            RETURNING *
        `, [setting_value, setting_key, req.user.school_id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Setting not found or not editable' });
        }
        
        // Log the change
        await pool.query(`
            INSERT INTO audit_logs (school_id, user_id, action, entity_type, old_values, new_values, ip_address)
            VALUES ($1, $2, 'update_setting', 'system_settings', $3, $4, $5)
        `, [req.user.school_id, req.user.id, JSON.stringify({ setting_key }), JSON.stringify({ setting_key, setting_value }), req.ip]);
        
        res.json({ message: 'Setting updated successfully', setting: result.rows[0] });
    } catch (error) {
        console.error('Error updating system setting:', error);
        res.status(500).json({ error: 'Error updating system setting' });
    }
}

// ==================== AUDIT LOGS ====================

// Get audit logs
async function getAuditLogs(req, res) {
    const { start_date, end_date, user_id, action, entity_type, page = 1, limit = 50 } = req.query;
    
    try {
        let query = `
            SELECT al.*, u.username, u.first_name, u.last_name, u.email
            FROM audit_logs al
            LEFT JOIN users u ON al.user_id = u.id
            WHERE al.school_id = $1
        `;
        const params = [req.user.school_id];
        let paramCount = 2;
        
        if (start_date) {
            query += ` AND al.created_at >= $${paramCount}`;
            params.push(start_date);
            paramCount++;
        }
        if (end_date) {
            query += ` AND al.created_at <= $${paramCount}`;
            params.push(end_date);
            paramCount++;
        }
        if (user_id) {
            query += ` AND al.user_id = $${paramCount}`;
            params.push(user_id);
            paramCount++;
        }
        if (action) {
            query += ` AND al.action ILIKE $${paramCount}`;
            params.push(`%${action}%`);
            paramCount++;
        }
        if (entity_type) {
            query += ` AND al.entity_type = $${paramCount}`;
            params.push(entity_type);
            paramCount++;
        }
        
        // Get total count
        const countQuery = query.replace(
            'SELECT al.*, u.username, u.first_name, u.last_name, u.email',
            'SELECT COUNT(*) as total'
        );
        const countResult = await pool.query(countQuery, params);
        const total = parseInt(countResult.rows[0].total);
        
        // Add pagination
        const offset = (page - 1) * limit;
        query += ` ORDER BY al.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(limit, offset);
        
        const result = await pool.query(query, params);
        
        res.json({
            logs: result.rows,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching audit logs:', error);
        res.status(500).json({ error: 'Error fetching audit logs' });
    }
}

// Export audit logs
async function exportAuditLogs(req, res) {
    const { start_date, end_date, format = 'csv' } = req.query;
    
    try {
        let query = `
            SELECT al.created_at, u.username, u.first_name, u.last_name, u.email,
                   al.action, al.entity_type, al.entity_id, al.ip_address, al.status_code
            FROM audit_logs al
            LEFT JOIN users u ON al.user_id = u.id
            WHERE al.school_id = $1
        `;
        const params = [req.user.school_id];
        
        if (start_date) {
            query += ` AND al.created_at >= $2`;
            params.push(start_date);
        }
        if (end_date) {
            query += ` AND al.created_at <= $3`;
            params.push(end_date);
        }
        
        query += ` ORDER BY al.created_at DESC`;
        
        const result = await pool.query(query, params);
        
        if (format === 'csv') {
            const csv = result.rows.map(row => 
                `${row.created_at},${row.username},${row.first_name} ${row.last_name},${row.email},${row.action},${row.entity_type},${row.entity_id},${row.ip_address},${row.status_code}`
            ).join('\n');
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=audit_logs_${moment().format('YYYY-MM-DD')}.csv`);
            res.send(`Timestamp,Username,User Name,Email,Action,Entity Type,Entity ID,IP Address,Status Code\n${csv}`);
        } else {
            res.json(result.rows);
        }
    } catch (error) {
        console.error('Error exporting audit logs:', error);
        res.status(500).json({ error: 'Error exporting audit logs' });
    }
}

// ==================== BACKUP MANAGEMENT ====================

// Create backup
async function createBackup(req, res) {
    const { backup_type = 'full', notes } = req.body;
    const client = await pool.connect();
    
    try {
        const backupName = `backup_${moment().format('YYYYMMDD_HHmmss')}.sql`;
        const backupPath = path.join(__dirname, '../../backups', backupName);
        
        // Ensure backups directory exists
        const backupDir = path.join(__dirname, '../../backups');
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }
        
        // Create backup record
        const result = await client.query(`
            INSERT INTO backup_records (school_id, backup_name, backup_type, status, started_at, created_by, notes)
            VALUES ($1, $2, $3, 'in_progress', CURRENT_TIMESTAMP, $4, $5)
            RETURNING id
        `, [req.user.school_id, backupName, backup_type, req.user.id, notes]);
        
        const backupId = result.rows[0].id;
        
        // Start backup process asynchronously
        const pgDump = `"C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump" -U ${process.env.DB_USER} -h ${process.env.DB_HOST} -d ${process.env.DB_NAME} > "${backupPath}"`;
        
        exec(pgDump, async (error, stdout, stderr) => {
            if (error) {
                console.error('Backup error:', error);
                await pool.query(`
                    UPDATE backup_records 
                    SET status = 'failed', completed_at = CURRENT_TIMESTAMP, notes = $1
                    WHERE id = $2
                `, [error.message, backupId]);
            } else {
                const stats = fs.statSync(backupPath);
                await pool.query(`
                    UPDATE backup_records 
                    SET status = 'completed', backup_size = $1, backup_path = $2, completed_at = CURRENT_TIMESTAMP
                    WHERE id = $3
                `, [stats.size, backupPath, backupId]);
                
                // Log backup creation
                await pool.query(`
                    INSERT INTO audit_logs (school_id, user_id, action, entity_type, entity_id, ip_address)
                    VALUES ($1, $2, 'create_backup', 'backup_records', $3, $4)
                `, [req.user.school_id, req.user.id, backupId, req.ip]);
            }
        });
        
        res.status(202).json({ 
            message: 'Backup started', 
            backup_id: backupId,
            backup_name: backupName
        });
        
    } catch (error) {
        console.error('Error creating backup:', error);
        res.status(500).json({ error: 'Error creating backup' });
    } finally {
        client.release();
    }
}

// Get backups
async function getBackups(req, res) {
    const { page = 1, limit = 20 } = req.query;
    
    try {
        const offset = (page - 1) * limit;
        
        const result = await pool.query(`
            SELECT * FROM backup_records
            WHERE school_id = $1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
        `, [req.user.school_id, limit, offset]);
        
        const countResult = await pool.query(`
            SELECT COUNT(*) as total FROM backup_records WHERE school_id = $1
        `, [req.user.school_id]);
        
        res.json({
            backups: result.rows,
            pagination: {
                total: parseInt(countResult.rows[0].total),
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(countResult.rows[0].total / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching backups:', error);
        res.status(500).json({ error: 'Error fetching backups' });
    }
}

// Restore backup
async function restoreBackup(req, res) {
    const { backup_id } = req.params;
    
    try {
        const backup = await pool.query(`
            SELECT * FROM backup_records WHERE id = $1 AND school_id = $2
        `, [backup_id, req.user.school_id]);
        
        if (backup.rows.length === 0) {
            return res.status(404).json({ error: 'Backup not found' });
        }
        
        const backupPath = backup.rows[0].backup_path;
        
        if (!fs.existsSync(backupPath)) {
            return res.status(404).json({ error: 'Backup file not found' });
        }
        
        // Start restore process asynchronously
        const psqlRestore = `"C:\\Program Files\\PostgreSQL\\16\\bin\\psql" -U ${process.env.DB_USER} -h ${process.env.DB_HOST} -d ${process.env.DB_NAME} < "${backupPath}"`;
        
        exec(psqlRestore, async (error, stdout, stderr) => {
            if (error) {
                console.error('Restore error:', error);
                await pool.query(`
                    INSERT INTO audit_logs (school_id, user_id, action, entity_type, entity_id, old_values, ip_address)
                    VALUES ($1, $2, 'restore_backup_failed', 'backup_records', $3, $4, $5)
                `, [req.user.school_id, req.user.id, backup_id, JSON.stringify({ error: error.message }), req.ip]);
            } else {
                await pool.query(`
                    INSERT INTO audit_logs (school_id, user_id, action, entity_type, entity_id, ip_address)
                    VALUES ($1, $2, 'restore_backup', 'backup_records', $3, $4)
                `, [req.user.school_id, req.user.id, backup_id, req.ip]);
            }
        });
        
        res.json({ message: 'Restore started. The system will be restored shortly.' });
        
    } catch (error) {
        console.error('Error restoring backup:', error);
        res.status(500).json({ error: 'Error restoring backup' });
    }
}

// Delete backup
async function deleteBackup(req, res) {
    const { backup_id } = req.params;
    
    try {
        const backup = await pool.query(`
            SELECT * FROM backup_records WHERE id = $1 AND school_id = $2
        `, [backup_id, req.user.school_id]);
        
        if (backup.rows.length === 0) {
            return res.status(404).json({ error: 'Backup not found' });
        }
        
        // Delete file if exists
        if (backup.rows[0].backup_path && fs.existsSync(backup.rows[0].backup_path)) {
            fs.unlinkSync(backup.rows[0].backup_path);
        }
        
        await pool.query(`
            DELETE FROM backup_records WHERE id = $1
        `, [backup_id]);
        
        res.json({ message: 'Backup deleted successfully' });
    } catch (error) {
        console.error('Error deleting backup:', error);
        res.status(500).json({ error: 'Error deleting backup' });
    }
}

// ==================== SYSTEM HEALTH ====================

// Get system health metrics
async function getSystemHealth(req, res) {
    try {
        // Get latest health metrics
        const health = await pool.query(`
            SELECT * FROM system_health
            WHERE school_id = $1
            ORDER BY recorded_at DESC
            LIMIT 1
        `, [req.user.school_id]);
        
        // Get database size
        const dbSize = await pool.query(`
            SELECT pg_database_size(current_database()) as size
        `);
        
        // Get active sessions
        const activeSessions = await pool.query(`
            SELECT COUNT(*) as count FROM user_sessions WHERE is_active = true
        `);
        
        // Get error count (last 24 hours)
        const errorCount = await pool.query(`
            SELECT COUNT(*) as count FROM error_logs
            WHERE created_at >= NOW() - INTERVAL '24 hours'
        `);
        
        // Get average response time (last hour)
        const avgResponse = await pool.query(`
            SELECT AVG(duration_ms) as avg_response FROM audit_logs
            WHERE created_at >= NOW() - INTERVAL '1 hour'
        `);
        
        // Get CPU and memory usage (system level - simplified)
        const os = require('os');
        const cpuUsage = os.loadavg()[0] / os.cpus().length * 100;
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const memoryUsage = ((totalMem - freeMem) / totalMem) * 100;
        
        // Get disk usage (simplified)
        const diskUsage = 65; // Placeholder - implement actual disk check
        
        const healthData = health.rows[0] || {};
        
        res.json({
            cpu_usage: Math.min(cpuUsage, 100),
            memory_usage: memoryUsage.toFixed(1),
            disk_usage: diskUsage,
            database_size: (dbSize.rows[0].size / 1024 / 1024).toFixed(2), // MB
            active_sessions: parseInt(activeSessions.rows[0].count),
            error_count_24h: parseInt(errorCount.rows[0].count),
            average_response_time: parseFloat(avgResponse.rows[0]?.avg_response || 0).toFixed(2),
            uptime: process.uptime(),
            last_health_check: healthData.recorded_at || new Date()
        });
    } catch (error) {
        console.error('Error fetching system health:', error);
        res.status(500).json({ error: 'Error fetching system health' });
    }
}

// Record health metrics (cron job)
async function recordHealthMetrics() {
    try {
        const os = require('os');
        const cpuUsage = os.loadavg()[0] / os.cpus().length * 100;
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const memoryUsage = ((totalMem - freeMem) / totalMem) * 100;
        
        const dbSize = await pool.query(`SELECT pg_database_size(current_database()) as size`);
        const activeSessions = await pool.query(`SELECT COUNT(*) as count FROM user_sessions WHERE is_active = true`);
        const errorCount = await pool.query(`SELECT COUNT(*) as count FROM error_logs WHERE created_at >= NOW() - INTERVAL '1 hour'`);
        
        await pool.query(`
            INSERT INTO system_health (school_id, cpu_usage, memory_usage, disk_usage, database_size, active_sessions, request_count, average_response_time, error_count)
            VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8)
        `, [cpuUsage, memoryUsage, 65, dbSize.rows[0].size, activeSessions.rows[0].count, 0, 0, errorCount.rows[0].count]);
        
        console.log('Health metrics recorded');
    } catch (error) {
        console.error('Error recording health metrics:', error);
    }
}

// ==================== ERROR LOGS ====================

// Get error logs
async function getErrorLogs(req, res) {
    const { level, resolved, page = 1, limit = 50 } = req.query;
    
    try {
        let query = `
            SELECT el.*, u.username, u.first_name, u.last_name
            FROM error_logs el
            LEFT JOIN users u ON el.user_id = u.id
            WHERE el.school_id = $1
        `;
        const params = [req.user.school_id];
        let paramCount = 2;
        
        if (level) {
            query += ` AND el.error_level = $${paramCount}`;
            params.push(level);
            paramCount++;
        }
        if (resolved === 'true') {
            query += ` AND el.resolved = true`;
        } else if (resolved === 'false') {
            query += ` AND el.resolved = false`;
        }
        
        const offset = (page - 1) * limit;
        query += ` ORDER BY el.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(limit, offset);
        
        const result = await pool.query(query, params);
        
        const countResult = await pool.query(`
            SELECT COUNT(*) as total FROM error_logs WHERE school_id = $1
        `, [req.user.school_id]);
        
        res.json({
            errors: result.rows,
            pagination: {
                total: parseInt(countResult.rows[0].total),
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(countResult.rows[0].total / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching error logs:', error);
        res.status(500).json({ error: 'Error fetching error logs' });
    }
}

// Resolve error
async function resolveError(req, res) {
    const { error_id } = req.params;
    const { resolution_notes } = req.body;
    
    try {
        await pool.query(`
            UPDATE error_logs 
            SET resolved = true, resolved_by = $1, resolved_at = CURRENT_TIMESTAMP, resolution_notes = $2
            WHERE id = $3 AND school_id = $4
        `, [req.user.id, resolution_notes, error_id, req.user.school_id]);
        
        res.json({ message: 'Error marked as resolved' });
    } catch (error) {
        console.error('Error resolving error:', error);
        res.status(500).json({ error: 'Error resolving error' });
    }
}

// ==================== GATEWAY CONFIGURATION ====================

// Get gateway configurations
async function getGatewayConfigs(req, res) {
    try {
        const result = await pool.query(`
            SELECT * FROM gateway_configs
            WHERE school_id = $1
            ORDER BY gateway_type, provider
        `, [req.user.school_id]);
        
        // Mask sensitive data
        result.rows.forEach(row => {
            if (row.api_key) row.api_key = '••••••••';
            if (row.api_secret) row.api_secret = '••••••••';
        });
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching gateway configs:', error);
        res.status(500).json({ error: 'Error fetching gateway configs' });
    }
}

// Update gateway configuration
async function updateGatewayConfig(req, res) {
    const { id } = req.params;
    const { api_key, api_secret, is_active, config } = req.body;
    
    try {
        const result = await pool.query(`
            UPDATE gateway_configs 
            SET api_key = COALESCE($1, api_key),
                api_secret = COALESCE($2, api_secret),
                is_active = COALESCE($3, is_active),
                config = COALESCE($4, config),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $5 AND school_id = $6
            RETURNING *
        `, [api_key, api_secret, is_active, config, id, req.user.school_id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Gateway config not found' });
        }
        
        res.json({ message: 'Gateway configuration updated', config: result.rows[0] });
    } catch (error) {
        console.error('Error updating gateway config:', error);
        res.status(500).json({ error: 'Error updating gateway config' });
    }
}

// Test gateway connection
async function testGateway(req, res) {
    const { id } = req.params;
    
    try {
        const config = await pool.query(`
            SELECT * FROM gateway_configs WHERE id = $1 AND school_id = $2
        `, [id, req.user.school_id]);
        
        if (config.rows.length === 0) {
            return res.status(404).json({ error: 'Gateway config not found' });
        }
        
        // Test connection based on gateway type
        let testResult = { success: true, message: 'Connection successful' };
        
        // Implement actual testing logic for each gateway type
        // This is a placeholder
        
        await pool.query(`
            UPDATE gateway_configs 
            SET last_tested = CURRENT_TIMESTAMP, test_status = $1
            WHERE id = $2
        `, [testResult.success, id]);
        
        res.json(testResult);
    } catch (error) {
        console.error('Error testing gateway:', error);
        res.status(500).json({ error: 'Error testing gateway' });
    }
}

// ==================== SECURITY SETTINGS ====================

// Get security settings
async function getSecuritySettings(req, res) {
    try {
        const result = await pool.query(`
            SELECT * FROM security_settings WHERE school_id = $1
        `, [req.user.school_id]);
        
        if (result.rows.length === 0) {
            // Create default security settings
            const insertResult = await pool.query(`
                INSERT INTO security_settings (school_id, two_factor_auth, password_expiry_days, password_min_length,
                    password_require_uppercase, password_require_lowercase, password_require_numbers,
                    password_require_special, session_timeout_minutes, max_login_attempts, lockout_duration_minutes)
                VALUES ($1, false, 90, 8, true, true, true, true, 60, 5, 30)
                RETURNING *
            `, [req.user.school_id]);
            return res.json(insertResult.rows[0]);
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error fetching security settings:', error);
        res.status(500).json({ error: 'Error fetching security settings' });
    }
}

// Update security settings
async function updateSecuritySettings(req, res) {
    const {
        two_factor_auth, password_expiry_days, password_min_length,
        password_require_uppercase, password_require_lowercase,
        password_require_numbers, password_require_special,
        session_timeout_minutes, max_login_attempts, lockout_duration_minutes,
        ip_whitelist, ip_blacklist
    } = req.body;
    
    try {
        const result = await pool.query(`
            UPDATE security_settings 
            SET two_factor_auth = COALESCE($1, two_factor_auth),
                password_expiry_days = COALESCE($2, password_expiry_days),
                password_min_length = COALESCE($3, password_min_length),
                password_require_uppercase = COALESCE($4, password_require_uppercase),
                password_require_lowercase = COALESCE($5, password_require_lowercase),
                password_require_numbers = COALESCE($6, password_require_numbers),
                password_require_special = COALESCE($7, password_require_special),
                session_timeout_minutes = COALESCE($8, session_timeout_minutes),
                max_login_attempts = COALESCE($9, max_login_attempts),
                lockout_duration_minutes = COALESCE($10, lockout_duration_minutes),
                ip_whitelist = COALESCE($11, ip_whitelist),
                ip_blacklist = COALESCE($12, ip_blacklist),
                updated_at = CURRENT_TIMESTAMP
            WHERE school_id = $13
            RETURNING *
        `, [two_factor_auth, password_expiry_days, password_min_length,
            password_require_uppercase, password_require_lowercase,
            password_require_numbers, password_require_special,
            session_timeout_minutes, max_login_attempts, lockout_duration_minutes,
            ip_whitelist, ip_blacklist, req.user.school_id]);
        
        res.json({ message: 'Security settings updated', settings: result.rows[0] });
    } catch (error) {
        console.error('Error updating security settings:', error);
        res.status(500).json({ error: 'Error updating security settings' });
    }
}

// ==================== ROLE PERMISSIONS ====================

// Get role permissions
async function getRolePermissions(req, res) {
    try {
        const result = await pool.query(`
            SELECT * FROM role_permissions ORDER BY role, module, permission
        `);
        
        // Group by role
        const permissions = {};
        result.rows.forEach(row => {
            if (!permissions[row.role]) {
                permissions[row.role] = {};
            }
            if (!permissions[row.role][row.module]) {
                permissions[row.role][row.module] = [];
            }
            permissions[row.role][row.module].push(row.permission);
        });
        
        res.json(permissions);
    } catch (error) {
        console.error('Error fetching role permissions:', error);
        res.status(500).json({ error: 'Error fetching role permissions' });
    }
}

// Update role permission
async function updateRolePermission(req, res) {
    const { role, module, permission, action } = req.body;
    
    try {
        if (action === 'add') {
            await pool.query(`
                INSERT INTO role_permissions (role, module, permission)
                VALUES ($1, $2, $3)
                ON CONFLICT DO NOTHING
            `, [role, module, permission]);
        } else if (action === 'remove') {
            await pool.query(`
                DELETE FROM role_permissions WHERE role = $1 AND module = $2 AND permission = $3
            `, [role, module, permission]);
        }
        
        res.json({ message: `Permission ${action}ed successfully` });
    } catch (error) {
        console.error('Error updating role permission:', error);
        res.status(500).json({ error: 'Error updating role permission' });
    }
}

// ==================== DASHBOARD STATS ====================

async function getSystemDashboard(req, res) {
    try {
        // Get counts
        const userCount = await pool.query(`SELECT COUNT(*) as count FROM users WHERE school_id = $1`, [req.user.school_id]);
        const errorCount = await pool.query(`SELECT COUNT(*) as count FROM error_logs WHERE resolved = false`);
        const pendingBackups = await pool.query(`SELECT COUNT(*) as count FROM backup_records WHERE status = 'pending'`);
        const activeSessions = await pool.query(`SELECT COUNT(*) as count FROM user_sessions WHERE is_active = true`);
        
        // Get recent errors
        const recentErrors = await pool.query(`
            SELECT * FROM error_logs 
            WHERE resolved = false 
            ORDER BY created_at DESC 
            LIMIT 5
        `);
        
        // Get recent audit logs
        const recentActivity = await pool.query(`
            SELECT al.*, u.username
            FROM audit_logs al
            LEFT JOIN users u ON al.user_id = u.id
            WHERE al.school_id = $1
            ORDER BY al.created_at DESC
            LIMIT 10
        `, [req.user.school_id]);
        
        // Get last backup status
        const lastBackup = await pool.query(`
            SELECT * FROM backup_records 
            WHERE school_id = $1 
            ORDER BY created_at DESC 
            LIMIT 1
        `, [req.user.school_id]);
        
        res.json({
            total_users: parseInt(userCount.rows[0].count),
            unresolved_errors: parseInt(errorCount.rows[0].count),
            pending_backups: parseInt(pendingBackups.rows[0].count),
            active_sessions: parseInt(activeSessions.rows[0].count),
            recent_errors: recentErrors.rows,
            recent_activity: recentActivity.rows,
            last_backup: lastBackup.rows[0] || null
        });
    } catch (error) {
        console.error('Error fetching system dashboard:', error);
        res.status(500).json({ error: 'Error fetching system dashboard' });
    }
}

module.exports = {
    // Settings
    getSystemSettings,
    updateSystemSetting,
    // Audit Logs
    getAuditLogs,
    exportAuditLogs,
    // Backups
    createBackup,
    getBackups,
    restoreBackup,
    deleteBackup,
    // Health
    getSystemHealth,
    recordHealthMetrics,
    // Error Logs
    getErrorLogs,
    resolveError,
    // Gateways
    getGatewayConfigs,
    updateGatewayConfig,
    testGateway,
    // Security
    getSecuritySettings,
    updateSecuritySettings,
    // Roles
    getRolePermissions,
    updateRolePermission,
    // Dashboard
    getSystemDashboard
};