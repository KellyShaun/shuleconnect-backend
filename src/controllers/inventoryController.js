const { Pool } = require('pg');
const QRCode = require('qrcode');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

// Helper Functions
function generateAssetTag() {
    const year = new Date().getFullYear();
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `AST/${year}/${random}`;
}

function generateBarcode() {
    const random = Math.floor(Math.random() * 10000000000).toString().padStart(10, '0');
    return `BAR${random}`;
}

// ==================== ASSET CATEGORIES ====================

async function getAssetCategories(req, res) {
    try {
        const result = await pool.query(`
            SELECT * FROM asset_categories 
            WHERE school_id = $1 AND is_active = true
            ORDER BY category_name
        `, [req.user.school_id]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ error: 'Error fetching categories' });
    }
}

async function createAssetCategory(req, res) {
    const { category_name, category_code, depreciation_rate, useful_life_years, description } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO asset_categories (school_id, category_name, category_code, depreciation_rate, useful_life_years, description)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [req.user.school_id, category_name, category_code, depreciation_rate, useful_life_years, description]);
        
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creating category:', error);
        res.status(500).json({ error: 'Error creating category' });
    }
}

// ==================== ASSET MANAGEMENT ====================

async function getAssets(req, res) {
    const { status, category, location, search, page = 1, limit = 20 } = req.query;
    
    try {
        let query = `
            SELECT a.*, ac.category_name, s.supplier_name,
                   COALESCE(
                       (SELECT json_agg(jsonb_build_object(
                           'id', aa.id,
                           'assigned_to_type', aa.assigned_to_type,
                           'assigned_date', aa.assigned_date,
                           'status', aa.status
                       )) FROM asset_assignments aa WHERE aa.asset_id = a.id AND aa.status = 'active'),
                       '[]'
                   ) as current_assignment
            FROM assets a
            LEFT JOIN asset_categories ac ON a.category_id = ac.id
            LEFT JOIN suppliers s ON a.supplier_id = s.id
            WHERE a.school_id = $1
        `;
        
        const params = [req.user.school_id];
        let paramCount = 2;
        
        if (status) {
            query += ` AND a.status = $${paramCount}`;
            params.push(status);
            paramCount++;
        }
        
        if (category) {
            query += ` AND a.category_id = $${paramCount}`;
            params.push(category);
            paramCount++;
        }
        
        if (location) {
            query += ` AND a.location ILIKE $${paramCount}`;
            params.push(`%${location}%`);
            paramCount++;
        }
        
        if (search) {
            query += ` AND (a.name ILIKE $${paramCount} OR a.asset_tag ILIKE $${paramCount} OR a.barcode ILIKE $${paramCount})`;
            params.push(`%${search}%`);
            paramCount++;
        }
        
        // Get total count
        const countQuery = query.replace(
            'SELECT a.*, ac.category_name, s.supplier_name, COALESCE((SELECT json_agg(jsonb_build_object(\'id\', aa.id, \'assigned_to_type\', aa.assigned_to_type, \'assigned_date\', aa.assigned_date, \'status\', aa.status)) FROM asset_assignments aa WHERE aa.asset_id = a.id AND aa.status = \'active\'), \'[]\') as current_assignment',
            'SELECT COUNT(*) as total'
        );
        const countResult = await pool.query(countQuery, params);
        const total = parseInt(countResult.rows[0].total);
        
        // Add pagination
        const offset = (page - 1) * limit;
        query += ` ORDER BY a.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(limit, offset);
        
        const result = await pool.query(query, params);
        
        res.json({
            assets: result.rows,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching assets:', error);
        res.status(500).json({ error: 'Error fetching assets' });
    }
}

async function getAssetById(req, res) {
    const { id } = req.params;
    
    try {
        const result = await pool.query(`
            SELECT a.*, ac.category_name, s.supplier_name,
                   COALESCE(
                       (SELECT json_agg(jsonb_build_object(
                           'id', aa.id,
                           'assigned_to_type', aa.assigned_to_type,
                           'assigned_to_id', aa.assigned_to_id,
                           'assigned_date', aa.assigned_date,
                           'expected_return_date', aa.expected_return_date,
                           'status', aa.status
                       )) FROM asset_assignments aa WHERE aa.asset_id = a.id ORDER BY aa.assigned_date DESC),
                       '[]'
                   ) as assignments,
                   COALESCE(
                       (SELECT json_agg(jsonb_build_object(
                           'id', mr.id,
                           'maintenance_date', mr.maintenance_date,
                           'maintenance_type', mr.maintenance_type,
                           'cost', mr.cost,
                           'status', mr.status
                       )) FROM maintenance_records mr WHERE mr.asset_id = a.id ORDER BY mr.maintenance_date DESC LIMIT 5),
                       '[]'
                   ) as maintenance_history
            FROM assets a
            LEFT JOIN asset_categories ac ON a.category_id = ac.id
            LEFT JOIN suppliers s ON a.supplier_id = s.id
            WHERE a.id = $1 AND a.school_id = $2
        `, [id, req.user.school_id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Asset not found' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error fetching asset:', error);
        res.status(500).json({ error: 'Error fetching asset' });
    }
}

async function createAsset(req, res) {
    const {
        name, description, category_id, supplier_id, model, serial_number,
        manufacturer, purchase_date, purchase_cost, location, department,
        room_number, condition, warranty_expiry, insurance_policy,
        insurance_expiry, notes
    } = req.body;
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const assetTag = generateAssetTag();
        const barcode = generateBarcode();
        const qrCode = await QRCode.toDataURL(assetTag);
        
        // Calculate initial current value
        const currentValue = purchase_cost;
        
        const result = await client.query(`
            INSERT INTO assets (
                school_id, asset_tag, barcode, qr_code, name, description, category_id,
                supplier_id, model, serial_number, manufacturer, purchase_date,
                purchase_cost, current_value, location, department, room_number,
                condition, status, warranty_expiry, insurance_policy, insurance_expiry, notes,
                created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'available', $19, $20, $21, $22, $23)
            RETURNING id
        `, [req.user.school_id, assetTag, barcode, qrCode, name, description, category_id,
            supplier_id, model, serial_number, manufacturer, purchase_date,
            purchase_cost, currentValue, location, department, room_number,
            condition, warranty_expiry, insurance_policy, insurance_expiry, notes,
            req.user.id]);
        
        // Log creation
        await client.query(`
            INSERT INTO asset_audit_logs (asset_id, action, new_value, changed_by)
            VALUES ($1, 'created', $2, $3)
        `, [result.rows[0].id, JSON.stringify({ name, assetTag, purchase_cost }), req.user.id]);
        
        await client.query('COMMIT');
        
        res.status(201).json({
            message: 'Asset created successfully',
            asset_id: result.rows[0].id,
            asset_tag: assetTag,
            barcode: barcode,
            qr_code: qrCode
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error creating asset:', error);
        res.status(500).json({ error: 'Error creating asset: ' + error.message });
    } finally {
        client.release();
    }
}

async function updateAsset(req, res) {
    const { id } = req.params;
    const updates = req.body;
    
    try {
        // Get old values for audit
        const oldAsset = await pool.query(`
            SELECT * FROM assets WHERE id = $1 AND school_id = $2
        `, [id, req.user.school_id]);
        
        if (oldAsset.rows.length === 0) {
            return res.status(404).json({ error: 'Asset not found' });
        }
        
        const allowedFields = ['name', 'description', 'category_id', 'location', 'department', 
                               'room_number', 'condition', 'status', 'notes'];
        
        const setClause = [];
        const values = [];
        let paramCount = 1;
        
        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                setClause.push(`${field} = $${paramCount}`);
                values.push(updates[field]);
                paramCount++;
            }
        }
        
        if (setClause.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }
        
        values.push(id, req.user.school_id);
        
        const query = `
            UPDATE assets 
            SET ${setClause.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE id = $${paramCount} AND school_id = $${paramCount + 1}
            RETURNING *
        `;
        
        const result = await pool.query(query, values);
        
        // Log changes
        const changes = {};
        for (const field of allowedFields) {
            if (updates[field] !== undefined && oldAsset.rows[0][field] !== updates[field]) {
                changes[field] = {
                    old: oldAsset.rows[0][field],
                    new: updates[field]
                };
            }
        }
        
        if (Object.keys(changes).length > 0) {
            await pool.query(`
                INSERT INTO asset_audit_logs (asset_id, action, old_value, new_value, changed_by)
                VALUES ($1, 'updated', $2, $3, $4)
            `, [id, JSON.stringify(changes), JSON.stringify(updates), req.user.id]);
        }
        
        res.json({ message: 'Asset updated successfully', asset: result.rows[0] });
    } catch (error) {
        console.error('Error updating asset:', error);
        res.status(500).json({ error: 'Error updating asset' });
    }
}

async function deleteAsset(req, res) {
    const { id } = req.params;
    
    try {
        const result = await pool.query(`
            UPDATE assets SET status = 'disposed', updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND school_id = $2
            RETURNING id
        `, [id, req.user.school_id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Asset not found' });
        }
        
        res.json({ message: 'Asset disposed successfully' });
    } catch (error) {
        console.error('Error disposing asset:', error);
        res.status(500).json({ error: 'Error disposing asset' });
    }
}

// ==================== ASSET ASSIGNMENTS ====================

async function assignAsset(req, res) {
    const { asset_id, assigned_to_type, assigned_to_id, expected_return_date, notes } = req.body;
    
    try {
        // Check if asset is available
        const asset = await pool.query(`
            SELECT status FROM assets WHERE id = $1 AND school_id = $2
        `, [asset_id, req.user.school_id]);
        
        if (asset.rows.length === 0) {
            return res.status(404).json({ error: 'Asset not found' });
        }
        
        if (asset.rows[0].status !== 'available') {
            return res.status(400).json({ error: 'Asset is not available for assignment' });
        }
        
        // Create assignment
        const result = await pool.query(`
            INSERT INTO asset_assignments (
                asset_id, assigned_to_type, assigned_to_id, assigned_by,
                expected_return_date, notes, status
            ) VALUES ($1, $2, $3, $4, $5, $6, 'active')
            RETURNING id
        `, [asset_id, assigned_to_type, assigned_to_id, req.user.id, expected_return_date, notes]);
        
        // Update asset status
        await pool.query(`
            UPDATE assets SET status = 'assigned', updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
        `, [asset_id]);
        
        // Log assignment
        await pool.query(`
            INSERT INTO asset_audit_logs (asset_id, action, new_value, changed_by)
            VALUES ($1, 'assigned', $2, $3)
        `, [asset_id, JSON.stringify({ assigned_to_type, assigned_to_id, expected_return_date }), req.user.id]);
        
        res.status(201).json({
            message: 'Asset assigned successfully',
            assignment_id: result.rows[0].id
        });
    } catch (error) {
        console.error('Error assigning asset:', error);
        res.status(500).json({ error: 'Error assigning asset' });
    }
}

async function returnAsset(req, res) {
    const { assignment_id, condition, notes } = req.body;
    
    try {
        const assignment = await pool.query(`
            SELECT asset_id FROM asset_assignments 
            WHERE id = $1 AND status = 'active'
        `, [assignment_id]);
        
        if (assignment.rows.length === 0) {
            return res.status(404).json({ error: 'Assignment not found' });
        }
        
        // Update assignment
        await pool.query(`
            UPDATE asset_assignments 
            SET actual_return_date = CURRENT_DATE, condition_at_return = $1, 
                notes = COALESCE(notes || '', $2), status = 'returned'
            WHERE id = $3
        `, [condition, notes, assignment_id]);
        
        // Update asset status
        await pool.query(`
            UPDATE assets SET status = 'available', condition = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
        `, [condition || 'good', assignment.rows[0].asset_id]);
        
        // Log return
        await pool.query(`
            INSERT INTO asset_audit_logs (asset_id, action, new_value, changed_by)
            VALUES ($1, 'returned', $2, $3)
        `, [assignment.rows[0].asset_id, JSON.stringify({ condition, notes }), req.user.id]);
        
        res.json({ message: 'Asset returned successfully' });
    } catch (error) {
        console.error('Error returning asset:', error);
        res.status(500).json({ error: 'Error returning asset' });
    }
}

// ==================== MAINTENANCE ====================

async function addMaintenanceRecord(req, res) {
    const { asset_id, maintenance_date, maintenance_type, description, cost, vendor_name, next_maintenance_date, notes } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO maintenance_records (
                asset_id, maintenance_date, maintenance_type, description,
                cost, vendor_name, next_maintenance_date, notes, performed_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id
        `, [asset_id, maintenance_date, maintenance_type, description, cost, vendor_name, next_maintenance_date, notes, req.user.id]);
        
        // Update asset last_maintenance date
        await pool.query(`
            UPDATE assets 
            SET last_maintenance = $1, next_maintenance = $2, updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
        `, [maintenance_date, next_maintenance_date, asset_id]);
        
        res.status(201).json({ message: 'Maintenance record added', id: result.rows[0].id });
    } catch (error) {
        console.error('Error adding maintenance record:', error);
        res.status(500).json({ error: 'Error adding maintenance record' });
    }
}

async function createRepairRequest(req, res) {
    const { asset_id, issue_description, urgency, photos } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO repair_requests (
                asset_id, requested_by, issue_description, urgency, photos, status
            ) VALUES ($1, $2, $3, $4, $5, 'pending')
            RETURNING id
        `, [asset_id, req.user.id, issue_description, urgency, photos]);
        
        res.status(201).json({ message: 'Repair request submitted', id: result.rows[0].id });
    } catch (error) {
        console.error('Error creating repair request:', error);
        res.status(500).json({ error: 'Error creating repair request' });
    }
}

// ==================== STOCK MANAGEMENT ====================

async function getStockItems(req, res) {
    const { category, low_stock, search, page = 1, limit = 20 } = req.query;
    
    try {
        let query = `
            SELECT s.*, sup.supplier_name,
                   CASE WHEN s.current_quantity <= s.reorder_point THEN true ELSE false END as needs_reorder
            FROM stock_items s
            LEFT JOIN suppliers sup ON s.supplier_id = sup.id
            WHERE s.school_id = $1
        `;
        
        const params = [req.user.school_id];
        let paramCount = 2;
        
        if (category) {
            query += ` AND s.category = $${paramCount}`;
            params.push(category);
            paramCount++;
        }
        
        if (low_stock === 'true') {
            query += ` AND s.current_quantity <= s.reorder_point`;
        }
        
        if (search) {
            query += ` AND (s.item_name ILIKE $${paramCount} OR s.item_code ILIKE $${paramCount})`;
            params.push(`%${search}%`);
            paramCount++;
        }
        
        const countQuery = query.replace(
            'SELECT s.*, sup.supplier_name, CASE WHEN s.current_quantity <= s.reorder_point THEN true ELSE false END as needs_reorder',
            'SELECT COUNT(*) as total'
        );
        const countResult = await pool.query(countQuery, params);
        const total = parseInt(countResult.rows[0].total);
        
        const offset = (page - 1) * limit;
        query += ` ORDER BY s.current_quantity ASC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(limit, offset);
        
        const result = await pool.query(query, params);
        
        res.json({
            stock_items: result.rows,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching stock items:', error);
        res.status(500).json({ error: 'Error fetching stock items' });
    }
}

// Add these functions to your inventoryController.js

// Get suppliers (if you have a suppliers table)
async function getSuppliers(req, res) {
    try {
        const result = await pool.query(`
            SELECT * FROM suppliers 
            WHERE school_id = $1 AND is_active = true
            ORDER BY supplier_name
        `, [req.user.school_id]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching suppliers:', error);
        res.status(500).json({ error: 'Error fetching suppliers' });
    }
}

async function createSupplier(req, res) {
    const { supplier_name, contact_person, phone, email, address, tax_pin } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO suppliers (school_id, supplier_name, contact_person, phone, email, address, tax_pin)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `, [req.user.school_id, supplier_name, contact_person, phone, email, address, tax_pin]);
        
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creating supplier:', error);
        res.status(500).json({ error: 'Error creating supplier' });
    }
}

// Make sure to add these to module.exports at the bottom of the file

async function createStockItem(req, res) {
    const { item_code, item_name, category, unit_of_measure, current_quantity, minimum_quantity, reorder_point, unit_cost, supplier_id, location, notes } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO stock_items (
                school_id, item_code, item_name, category, unit_of_measure,
                current_quantity, minimum_quantity, reorder_point, unit_cost,
                supplier_id, location, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *
        `, [req.user.school_id, item_code, item_name, category, unit_of_measure,
            current_quantity, minimum_quantity, reorder_point, unit_cost,
            supplier_id, location, notes]);
        
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creating stock item:', error);
        res.status(500).json({ error: 'Error creating stock item' });
    }
}

async function updateStockQuantity(req, res) {
    const { id } = req.params;
    const { quantity, transaction_type, department, issued_to, notes } = req.body;
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const stockItem = await client.query(`
            SELECT * FROM stock_items WHERE id = $1 AND school_id = $2
        `, [id, req.user.school_id]);
        
        if (stockItem.rows.length === 0) {
            return res.status(404).json({ error: 'Stock item not found' });
        }
        
        let newQuantity = stockItem.rows[0].current_quantity;
        let transactionQuantity = Math.abs(quantity);
        
        if (transaction_type === 'receive') {
            newQuantity += transactionQuantity;
        } else if (transaction_type === 'issue') {
            if (newQuantity < transactionQuantity) {
                return res.status(400).json({ error: 'Insufficient stock' });
            }
            newQuantity -= transactionQuantity;
        } else if (transaction_type === 'adjustment') {
            newQuantity = transactionQuantity;
        }
        
        await client.query(`
            UPDATE stock_items 
            SET current_quantity = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
        `, [newQuantity, id]);
        
        await client.query(`
            INSERT INTO stock_transactions (
                stock_item_id, transaction_type, quantity, unit_price,
                total_value, department, issued_to, notes, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [id, transaction_type, transactionQuantity, stockItem.rows[0].unit_cost,
            transactionQuantity * stockItem.rows[0].unit_cost, department, issued_to, notes, req.user.id]);
        
        await client.query('COMMIT');
        
        res.json({ message: 'Stock updated successfully', new_quantity: newQuantity });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating stock:', error);
        res.status(500).json({ error: 'Error updating stock' });
    } finally {
        client.release();
    }
}

// ==================== DASHBOARD STATS ====================

async function getInventoryDashboard(req, res) {
    try {
        // Asset statistics
        const assetStats = await pool.query(`
            SELECT 
                COUNT(*) as total_assets,
                COUNT(CASE WHEN status = 'available' THEN 1 END) as available,
                COUNT(CASE WHEN status = 'assigned' THEN 1 END) as assigned,
                COUNT(CASE WHEN status = 'maintenance' THEN 1 END) as maintenance,
                COUNT(CASE WHEN next_maintenance <= CURRENT_DATE + INTERVAL '30 days' THEN 1 END) as upcoming_maintenance
            FROM assets
            WHERE school_id = $1
        `, [req.user.school_id]);
        
        // Stock statistics
        const stockStats = await pool.query(`
            SELECT 
                COUNT(*) as total_items,
                COUNT(CASE WHEN current_quantity <= reorder_point THEN 1 END) as low_stock_items,
                SUM(current_quantity * unit_cost) as total_value
            FROM stock_items
            WHERE school_id = $1
        `, [req.user.school_id]);
        
        // Recent transactions
        const recentTransactions = await pool.query(`
            SELECT st.*, si.item_name, si.item_code
            FROM stock_transactions st
            JOIN stock_items si ON st.stock_item_id = si.id
            WHERE si.school_id = $1
            ORDER BY st.created_at DESC
            LIMIT 10
        `, [req.user.school_id]);
        
        // Low stock alerts
        const lowStock = await pool.query(`
            SELECT * FROM stock_items
            WHERE school_id = $1 AND current_quantity <= reorder_point
            ORDER BY (current_quantity / NULLIF(reorder_point, 0)) ASC
            LIMIT 10
        `, [req.user.school_id]);
        
        res.json({
            asset_stats: assetStats.rows[0],
            stock_stats: stockStats.rows[0],
            recent_transactions: recentTransactions.rows,
            low_stock_alerts: lowStock.rows
        });
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        res.status(500).json({ error: 'Error fetching dashboard stats' });
    }
}

async function getSuppliers(req, res) {
    try {
        const result = await pool.query(`
            SELECT * FROM suppliers 
            WHERE school_id = $1 AND is_active = true
            ORDER BY supplier_name
        `, [req.user.school_id]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching suppliers:', error);
        res.status(500).json({ error: 'Error fetching suppliers' });
    }
}

async function createSupplier(req, res) {
    const { supplier_name, contact_person, phone, email, address, tax_pin } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO suppliers (school_id, supplier_name, contact_person, phone, email, address, tax_pin)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `, [req.user.school_id, supplier_name, contact_person, phone, email, address, tax_pin]);
        
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creating supplier:', error);
        res.status(500).json({ error: 'Error creating supplier' });
    }
}

module.exports = {
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
    getInventoryDashboard,
    getSuppliers,
    createSupplier
};