const { Pool } = require('pg');
const moment = require('moment');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

// ==================== DRIVERS ====================

async function getDrivers(req, res) {
    try {
        const result = await pool.query(`
            SELECT d.*, COUNT(v.id) as assigned_vehicles
            FROM transport_drivers d
            LEFT JOIN transport_vehicles v ON d.id = v.assigned_driver_id AND v.status = 'active'
            WHERE d.school_id = $1
            GROUP BY d.id
            ORDER BY d.driver_name
        `, [req.user.school_id]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching drivers:', error);
        res.status(500).json({ error: 'Error fetching drivers' });
    }
}

async function createDriver(req, res) {
    const { driver_name, driver_license, phone, email, address, hire_date, salary, emergency_contact, emergency_phone, notes } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO transport_drivers (
                school_id, driver_name, driver_license, phone, email, address,
                hire_date, salary, emergency_contact, emergency_phone, notes, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active')
            RETURNING *
        `, [req.user.school_id, driver_name, driver_license, phone, email, address,
            hire_date, salary, emergency_contact, emergency_phone, notes]);
        
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creating driver:', error);
        res.status(500).json({ error: 'Error creating driver' });
    }
}

// ==================== VEHICLES ====================

async function getVehicles(req, res) {
    try {
        const result = await pool.query(`
            SELECT v.*, d.driver_name,
                   COUNT(DISTINCT s.id) as assigned_students
            FROM transport_vehicles v
            LEFT JOIN transport_drivers d ON v.assigned_driver_id = d.id
            LEFT JOIN transport_routes r ON v.route_id = r.id
            LEFT JOIN transport_student_assignments sa ON r.id = sa.route_id AND sa.is_active = true
            LEFT JOIN students s ON sa.student_id = s.id
            WHERE v.school_id = $1
            GROUP BY v.id, d.driver_name
            ORDER BY v.vehicle_number
        `, [req.user.school_id]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching vehicles:', error);
        res.status(500).json({ error: 'Error fetching vehicles' });
    }
}

async function createVehicle(req, res) {
    const { vehicle_number, registration_number, model, manufacturer, year, capacity, fuel_type, insurance_policy, insurance_expiry, inspection_due, notes } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO transport_vehicles (
                school_id, vehicle_number, registration_number, model, manufacturer,
                year, capacity, fuel_type, insurance_policy, insurance_expiry,
                inspection_due, status, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active', $12)
            RETURNING *
        `, [req.user.school_id, vehicle_number, registration_number, model, manufacturer,
            year, capacity, fuel_type, insurance_policy, insurance_expiry,
            inspection_due, notes]);
        
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creating vehicle:', error);
        res.status(500).json({ error: 'Error creating vehicle' });
    }
}

async function assignDriver(req, res) {
    const { vehicle_id, driver_id } = req.body;
    
    try {
        await pool.query(`
            UPDATE transport_vehicles 
            SET assigned_driver_id = $1
            WHERE id = $2 AND school_id = $3
        `, [driver_id, vehicle_id, req.user.school_id]);
        
        res.json({ message: 'Driver assigned successfully' });
    } catch (error) {
        console.error('Error assigning driver:', error);
        res.status(500).json({ error: 'Error assigning driver' });
    }
}

// ==================== ROUTES ====================

async function getRoutes(req, res) {
    try {
        const result = await pool.query(`
            SELECT r.*, COUNT(DISTINCT rs.id) as stops_count,
                   COUNT(DISTINCT sa.student_id) as assigned_students
            FROM transport_routes r
            LEFT JOIN transport_route_stops rs ON r.id = rs.route_id AND rs.is_active = true
            LEFT JOIN transport_student_assignments sa ON r.id = sa.route_id AND sa.is_active = true
            WHERE r.school_id = $1 AND r.is_active = true
            GROUP BY r.id
            ORDER BY r.route_name
        `, [req.user.school_id]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching routes:', error);
        res.status(500).json({ error: 'Error fetching routes' });
    }
}

async function createRoute(req, res) {
    const { route_name, route_code, start_point, end_point, distance_km, estimated_duration_minutes, fare_amount, notes } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO transport_routes (
                school_id, route_name, route_code, start_point, end_point,
                distance_km, estimated_duration_minutes, fare_amount, notes, is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
            RETURNING *
        `, [req.user.school_id, route_name, route_code, start_point, end_point,
            distance_km, estimated_duration_minutes, fare_amount, notes]);
        
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creating route:', error);
        res.status(500).json({ error: 'Error creating route' });
    }
}

// ==================== ROUTE STOPS ====================

async function getRouteStops(req, res) {
    const { route_id } = req.query;
    
    try {
        const result = await pool.query(`
            SELECT * FROM transport_route_stops
            WHERE route_id = $1 AND is_active = true
            ORDER BY stop_order
        `, [route_id]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching route stops:', error);
        res.status(500).json({ error: 'Error fetching route stops' });
    }
}

async function addRouteStop(req, res) {
    const { route_id, stop_name, stop_order, latitude, longitude, pickup_time, dropoff_time, estimated_arrival, distance_from_school_km } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO transport_route_stops (
                route_id, stop_name, stop_order, latitude, longitude,
                pickup_time, dropoff_time, estimated_arrival, distance_from_school_km, is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
            RETURNING *
        `, [route_id, stop_name, stop_order, latitude, longitude,
            pickup_time, dropoff_time, estimated_arrival, distance_from_school_km]);
        
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error adding route stop:', error);
        res.status(500).json({ error: 'Error adding route stop' });
    }
}

// ==================== STUDENT ASSIGNMENTS ====================

async function assignStudentToRoute(req, res) {
    const { student_id, route_id, pickup_stop_id, dropoff_stop_id, fare_amount, notes } = req.body;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Deactivate current assignment
        await client.query(`
            UPDATE transport_student_assignments 
            SET is_active = false, deassigned_date = CURRENT_DATE
            WHERE student_id = $1 AND is_active = true
        `, [student_id]);
        
        // Create new assignment
        const result = await client.query(`
            INSERT INTO transport_student_assignments (
                student_id, route_id, pickup_stop_id, dropoff_stop_id,
                assigned_date, fare_amount, is_active, notes
            ) VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, true, $6)
            RETURNING id
        `, [student_id, route_id, pickup_stop_id, dropoff_stop_id, fare_amount, notes]);
        
        await client.query('COMMIT');
        
        res.status(201).json({ message: 'Student assigned to route', assignment_id: result.rows[0].id });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error assigning student:', error);
        res.status(500).json({ error: 'Error assigning student' });
    } finally {
        client.release();
    }
}

async function getStudentTransportInfo(req, res) {
    const { student_id } = req.params;
    
    try {
        const result = await pool.query(`
            SELECT sa.*, r.route_name, r.route_code,
                   ps.stop_name as pickup_stop, ps.pickup_time,
                   ds.stop_name as dropoff_stop, ds.dropoff_time,
                   v.vehicle_number, v.registration_number,
                   d.driver_name, d.phone as driver_phone
            FROM transport_student_assignments sa
            JOIN transport_routes r ON sa.route_id = r.id
            JOIN transport_route_stops ps ON sa.pickup_stop_id = ps.id
            JOIN transport_route_stops ds ON sa.dropoff_stop_id = ds.id
            LEFT JOIN transport_vehicles v ON r.id = v.route_id AND v.status = 'active'
            LEFT JOIN transport_drivers d ON v.assigned_driver_id = d.id
            WHERE sa.student_id = $1 AND sa.is_active = true
        `, [student_id]);
        
        res.json(result.rows[0] || null);
    } catch (error) {
        console.error('Error fetching student transport info:', error);
        res.status(500).json({ error: 'Error fetching student transport info' });
    }
}

// ==================== GPS TRACKING ====================

async function updateVehicleLocation(req, res) {
    const { vehicle_id, latitude, longitude, speed, heading, accuracy } = req.body;
    
    try {
        await pool.query(`
            INSERT INTO transport_gps_tracking (
                vehicle_id, latitude, longitude, speed, heading, accuracy
            ) VALUES ($1, $2, $3, $4, $5, $6)
        `, [vehicle_id, latitude, longitude, speed, heading, accuracy]);
        
        res.json({ message: 'Location updated' });
    } catch (error) {
        console.error('Error updating location:', error);
        res.status(500).json({ error: 'Error updating location' });
    }
}

async function getVehicleLocation(req, res) {
    const { vehicle_id } = req.params;
    
    try {
        const result = await pool.query(`
            SELECT * FROM transport_gps_tracking
            WHERE vehicle_id = $1
            ORDER BY timestamp DESC
            LIMIT 1
        `, [vehicle_id]);
        
        res.json(result.rows[0] || null);
    } catch (error) {
        console.error('Error fetching vehicle location:', error);
        res.status(500).json({ error: 'Error fetching vehicle location' });
    }
}

// ==================== MAINTENANCE ====================

async function addMaintenanceRecord(req, res) {
    const { vehicle_id, maintenance_type, description, cost, odometer_reading, mechanic_name, next_maintenance_date, notes } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO transport_maintenance (
                vehicle_id, maintenance_type, description, cost,
                odometer_reading, mechanic_name, next_maintenance_date, notes, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'completed')
            RETURNING id
        `, [vehicle_id, maintenance_type, description, cost, odometer_reading, mechanic_name, next_maintenance_date, notes]);
        
        // Update vehicle maintenance dates
        await pool.query(`
            UPDATE transport_vehicles 
            SET last_maintenance = CURRENT_DATE,
                next_maintenance = $1,
                current_mileage = $2
            WHERE id = $3
        `, [next_maintenance_date, odometer_reading, vehicle_id]);
        
        res.status(201).json({ message: 'Maintenance record added', id: result.rows[0].id });
    } catch (error) {
        console.error('Error adding maintenance record:', error);
        res.status(500).json({ error: 'Error adding maintenance record' });
    }
}

// ==================== DASHBOARD ====================

async function getTransportDashboard(req, res) {
    try {
        const vehicles = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
                COUNT(CASE WHEN status = 'maintenance' THEN 1 END) as maintenance
            FROM transport_vehicles
            WHERE school_id = $1
        `, [req.user.school_id]);
        
        const routes = await pool.query(`
            SELECT COUNT(*) as total FROM transport_routes
            WHERE school_id = $1 AND is_active = true
        `, [req.user.school_id]);
        
        const students = await pool.query(`
            SELECT COUNT(*) as total FROM transport_student_assignments
            WHERE is_active = true
        `);
        
        const upcomingMaintenance = await pool.query(`
            SELECT v.vehicle_number, v.next_maintenance,
                   EXTRACT(DAY FROM (v.next_maintenance - CURRENT_DATE)) as days_remaining
            FROM transport_vehicles v
            WHERE v.next_maintenance BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
            LIMIT 5
        `);
        
        const activeBuses = await pool.query(`
            SELECT v.*, d.driver_name, r.route_name
            FROM transport_vehicles v
            LEFT JOIN transport_drivers d ON v.assigned_driver_id = d.id
            LEFT JOIN transport_routes r ON v.route_id = r.id
            WHERE v.status = 'active' AND v.school_id = $1
            LIMIT 10
        `, [req.user.school_id]);
        
        res.json({
            total_vehicles: parseInt(vehicles.rows[0].total),
            active_vehicles: parseInt(vehicles.rows[0].active),
            maintenance_vehicles: parseInt(vehicles.rows[0].maintenance),
            total_routes: parseInt(routes.rows[0].total),
            students_transported: parseInt(students.rows[0].total),
            upcoming_maintenance: upcomingMaintenance.rows,
            active_buses: activeBuses.rows
        });
    } catch (error) {
        console.error('Error fetching transport dashboard:', error);
        res.status(500).json({ error: 'Error fetching transport dashboard' });
    }
}

// Add to backend/src/controllers/transportController.js

// Get transport manager dashboard
async function getTransportManagerDashboard(req, res) {
    try {
        // Vehicle statistics
        const vehicles = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
                COUNT(CASE WHEN status = 'maintenance' THEN 1 END) as maintenance
            FROM transport_vehicles
            WHERE school_id = $1
        `, [req.user.school_id]);
        
        // Drivers count
        const drivers = await pool.query(`
            SELECT COUNT(*) as count FROM transport_drivers WHERE school_id = $1
        `, [req.user.school_id]);
        
        // Routes count
        const routes = await pool.query(`
            SELECT COUNT(*) as count FROM transport_routes WHERE school_id = $1 AND is_active = true
        `, [req.user.school_id]);
        
        // Students transported
        const students = await pool.query(`
            SELECT COUNT(DISTINCT student_id) as count FROM transport_student_assignments WHERE is_active = true
        `);
        
        // Active buses with details
        const activeBuses = await pool.query(`
            SELECT v.*, d.driver_name, r.route_name
            FROM transport_vehicles v
            LEFT JOIN transport_drivers d ON v.assigned_driver_id = d.id
            LEFT JOIN transport_routes r ON v.route_id = r.id
            WHERE v.status = 'active' AND v.school_id = $1
        `, [req.user.school_id]);
        
        // Upcoming maintenance
        const maintenance = await pool.query(`
            SELECT v.vehicle_number, m.*, 
                   EXTRACT(DAY FROM (m.next_maintenance_date - CURRENT_DATE)) as days_left
            FROM transport_maintenance m
            JOIN transport_vehicles v ON m.vehicle_id = v.id
            WHERE m.next_maintenance_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
            ORDER BY m.next_maintenance_date ASC
        `);
        
        // Route utilization
        const routeUtilization = await pool.query(`
            SELECT r.route_name, COUNT(sa.student_id) as students
            FROM transport_routes r
            LEFT JOIN transport_student_assignments sa ON r.id = sa.route_id AND sa.is_active = true
            WHERE r.school_id = $1 AND r.is_active = true
            GROUP BY r.id, r.route_name
        `, [req.user.school_id]);
        
        res.json({
            total_vehicles: parseInt(vehicles.rows[0].total),
            active_vehicles: parseInt(vehicles.rows[0].active),
            maintenance_vehicles: parseInt(vehicles.rows[0].maintenance),
            total_drivers: parseInt(drivers.rows[0].count),
            total_routes: parseInt(routes.rows[0].count),
            students_transported: parseInt(students.rows[0].count),
            active_buses: activeBuses.rows,
            upcoming_maintenance: maintenance.rows,
            route_utilization: routeUtilization.rows
        });
    } catch (error) {
        console.error('Error fetching transport manager dashboard:', error);
        res.status(500).json({ error: 'Error fetching dashboard data' });
    }
}

// Record fuel transaction
async function recordFuelTransaction(req, res) {
    const { vehicle_id, fuel_date, fuel_amount, fuel_cost, odometer_reading } = req.body;
    
    try {
        await pool.query(`
            INSERT INTO transport_fuel_records (vehicle_id, fuel_date, fuel_amount, fuel_cost, odometer_reading)
            VALUES ($1, $2, $3, $4, $5)
        `, [vehicle_id, fuel_date, fuel_amount, fuel_cost, odometer_reading]);
        
        // Update vehicle odometer
        await pool.query(`
            UPDATE transport_vehicles SET current_mileage = $1 WHERE id = $2
        `, [odometer_reading, vehicle_id]);
        
        res.json({ message: 'Fuel record added successfully' });
    } catch (error) {
        console.error('Error recording fuel:', error);
        res.status(500).json({ error: 'Error recording fuel' });
    }
}

// Record maintenance
async function recordMaintenance(req, res) {
    const { vehicle_id, maintenance_date, maintenance_type, description, cost, next_maintenance_date } = req.body;
    
    try {
        await pool.query(`
            INSERT INTO transport_maintenance (vehicle_id, maintenance_date, maintenance_type, description, cost, next_maintenance_date, status)
            VALUES ($1, $2, $3, $4, $5, $6, 'scheduled')
        `, [vehicle_id, maintenance_date, maintenance_type, description, cost, next_maintenance_date]);
        
        // Update vehicle status to maintenance if needed
        if (maintenance_type === 'repair' || maintenance_type === 'emergency') {
            await pool.query(`
                UPDATE transport_vehicles SET status = 'maintenance' WHERE id = $1
            `, [vehicle_id]);
        }
        
        res.json({ message: 'Maintenance record added' });
    } catch (error) {
        console.error('Error recording maintenance:', error);
        res.status(500).json({ error: 'Error recording maintenance' });
    }
}

// Assign driver to vehicle
async function assignDriverToVehicle(req, res) {
    const { vehicle_id, driver_id, route_id } = req.body;
    
    try {
        await pool.query('BEGIN');
        
        // Update vehicle
        await pool.query(`
            UPDATE transport_vehicles 
            SET assigned_driver_id = $1, route_id = $2
            WHERE id = $3
        `, [driver_id, route_id, vehicle_id]);
        
        // Update driver status
        await pool.query(`
            UPDATE transport_drivers SET status = 'assigned' WHERE id = $1
        `, [driver_id]);
        
        await pool.query('COMMIT');
        
        res.json({ message: 'Driver assigned successfully' });
    } catch (error) {
        await pool.query('ROLLBACK');
        console.error('Error assigning driver:', error);
        res.status(500).json({ error: 'Error assigning driver' });
    }
}

// Add driver
async function addDriver(req, res) {
    const { driver_name, driver_license, phone, email, hire_date, salary, address, experience_years } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO transport_drivers (school_id, driver_name, driver_license, phone, email, hire_date, salary, address, experience_years, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')
            RETURNING id
        `, [req.user.school_id, driver_name, driver_license, phone, email, hire_date, salary, address, experience_years]);
        
        res.status(201).json({ message: 'Driver added successfully', id: result.rows[0].id });
    } catch (error) {
        console.error('Error adding driver:', error);
        res.status(500).json({ error: 'Error adding driver' });
    }
}

// Add route
async function addRoute(req, res) {
    const { route_name, route_code, start_point, end_point, distance_km, estimated_duration } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO transport_routes (school_id, route_name, route_code, start_point, end_point, distance_km, estimated_duration_minutes, is_active)
            VALUES ($1, $2, $3, $4, $5, $6, $7, true)
            RETURNING id
        `, [req.user.school_id, route_name, route_code, start_point, end_point, distance_km, estimated_duration]);
        
        res.status(201).json({ message: 'Route added successfully', id: result.rows[0].id });
    } catch (error) {
        console.error('Error adding route:', error);
        res.status(500).json({ error: 'Error adding route' });
    }
}

module.exports = {
    // Drivers
    getDrivers,
    createDriver,
    // Vehicles
    getVehicles,
    createVehicle,
    assignDriver,
    // Routes
    getRoutes,
    createRoute,
    getRouteStops,
    addRouteStop,
    // Student assignments
    assignStudentToRoute,
    getStudentTransportInfo,
    // GPS Tracking
    updateVehicleLocation,
    getVehicleLocation,
    // Maintenance
    addMaintenanceRecord,
    // Dashboard
    getTransportDashboard
};