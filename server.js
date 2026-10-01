const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const { db, runAsync, getAsync, allAsync, initDb } = require('./db');
const { validateAndFormatNIC } = require('./utils');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'gelms_gov_lk_secret_key_2025';

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.static('public'));

// Audit Logger Helper
async function logAudit(req, userId, username, action, details) {
    try {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        await runAsync(
            `INSERT INTO audit_logs (user_id, username, action, details, ip_address) VALUES (?, ?, ?, ?, ?)`,
            [userId || null, username || 'System', action, details, ip]
        );
    } catch (e) {
        console.error('Audit log error:', e);
    }
}

// Notification Helper
async function sendNotification(userId, title, message) {
    try {
        await runAsync(
            `INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)`,
            [userId, title, message]
        );
    } catch (e) {
        console.error('Notification error:', e);
    }
}

// Ensure Leave Balances exist for an employee and year
async function ensureLeaveBalances(employeeId, year) {
    if (!employeeId || !year) return;
    try {
        const leaveTypes = await allAsync(`SELECT leave_type_id, maximum_days FROM leave_types`);
        for (const lt of leaveTypes) {
            await runAsync(`
                INSERT OR IGNORE INTO leave_balances (employee_id, leave_type_id, year, allocated_days, used_days, remaining_days)
                VALUES (?, ?, ?, ?, 0, ?)
            `, [employeeId, lt.leave_type_id, year, lt.maximum_days, lt.maximum_days]);
        }
    } catch (e) {
        console.error('Error ensuring leave balances:', e);
    }
}

// Authentication Middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Authentication required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: 'Invalid or expired token' });
        req.user = user;
        next();
    });
}

// Role Authorization Middleware
function authorizeRoles(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ message: 'Access denied: Unauthorized role' });
        }
        next();
    };
}

// =========================================
// 1. AUTHENTICATION ENDPOINTS
// =========================================

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ message: 'Username and password are required.' });
        }

        const user = await getAsync(`
            SELECT u.*, e.name as employee_name, e.nic, e.department_id, e.designation
            FROM users u
            LEFT JOIN employees e ON u.employee_id = e.employee_id
            WHERE u.username = ?
        `, [username.trim()]);

        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        const tokenPayload = {
            userId: user.user_id,
            username: user.username,
            role: user.role,
            employeeId: user.employee_id,
            employeeName: user.employee_name
        };

        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });

        await logAudit(req, user.user_id, user.username, 'LOGIN', `User ${user.username} logged in successfully.`);

        res.json({
            message: 'Login successful',
            token,
            user: {
                userId: user.user_id,
                username: user.username,
                role: user.role,
                employeeId: user.employee_id,
                employeeName: user.employee_name || 'Administrator',
                nic: user.nic,
                designation: user.designation
            }
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// GET /api/auth/me
app.get('/api/auth/me', authenticateToken, async (req, res) => {
    try {
        const user = await getAsync(`
            SELECT u.user_id, u.username, u.role, u.employee_id, e.name, e.nic, e.email, e.designation, d.department_name
            FROM users u
            LEFT JOIN employees e ON u.employee_id = e.employee_id
            LEFT JOIN departments d ON e.department_id = d.department_id
            WHERE u.user_id = ?
        `, [req.user.userId]);

        if (!user) return res.status(404).json({ message: 'User not found' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// =========================================
// 2. DEPARTMENT MANAGEMENT ENDPOINTS
// =========================================

// GET /api/departments
app.get('/api/departments', authenticateToken, async (req, res) => {
    try {
        const departments = await allAsync(`SELECT * FROM departments ORDER BY department_name ASC`);
        res.json(departments);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// POST /api/departments
app.post('/api/departments', authenticateToken, authorizeRoles('Admin', 'HR'), async (req, res) => {
    try {
        const { department_code, department_name } = req.body;
        if (!department_code || !department_name) {
            return res.status(400).json({ message: 'Code and Name are required.' });
        }

        const result = await runAsync(
            `INSERT INTO departments (department_code, department_name) VALUES (?, ?)`,
            [department_code.toUpperCase().trim(), department_name.trim()]
        );

        await logAudit(req, req.user.userId, req.user.username, 'CREATE_DEPARTMENT', `Created department ${department_name}`);
        res.status(201).json({ message: 'Department created successfully', department_id: result.lastID });
    } catch (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ message: 'Department code already exists.' });
        }
        res.status(500).json({ message: err.message });
    }
});

// =========================================
// 3. EMPLOYEE MANAGEMENT ENDPOINTS
// =========================================

// GET /api/employees
app.get('/api/employees', authenticateToken, async (req, res) => {
    try {
        const employees = await allAsync(`
            SELECT e.*, d.department_name, s.name as supervisor_name
            FROM employees e
            LEFT JOIN departments d ON e.department_id = d.department_id
            LEFT JOIN employees s ON e.supervisor_id = s.employee_id
            ORDER BY e.employee_id DESC
        `);
        res.json(employees);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// GET /api/employees/:id
app.get('/api/employees/:id', authenticateToken, async (req, res) => {
    try {
        const employee = await getAsync(`
            SELECT e.*, d.department_name, s.name as supervisor_name
            FROM employees e
            LEFT JOIN departments d ON e.department_id = d.department_id
            LEFT JOIN employees s ON e.supervisor_id = s.employee_id
            WHERE e.employee_id = ?
        `, [req.params.id]);

        if (!employee) return res.status(404).json({ message: 'Employee not found' });
        res.json(employee);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// POST /api/employees
app.post('/api/employees', authenticateToken, authorizeRoles('Admin', 'HR'), async (req, res) => {
    try {
        const { employee_number, name, nic, email, phone, department_id, designation, supervisor_id, date_of_appointment, username, password, role } = req.body;

        if (!employee_number || !name || !nic || !email || !department_id || !designation || !date_of_appointment) {
            return res.status(400).json({ message: 'All required fields must be filled.' });
        }

        const nicValidation = validateAndFormatNIC(nic);
        if (!nicValidation.isValid) {
            return res.status(400).json({ message: nicValidation.message });
        }

        const formattedNic = nicValidation.formattedNIC;

        const empResult = await runAsync(`
            INSERT INTO employees (employee_number, name, nic, email, phone, department_id, designation, supervisor_id, date_of_appointment)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [employee_number.trim(), name.trim(), formattedNic, email.trim(), phone || '', department_id, designation.trim(), supervisor_id || null, date_of_appointment]);

        const employeeId = empResult.lastID;

        // Auto-allocate initial leave balances for 2025 and current year
        const yearsToSeed = Array.from(new Set([2025, new Date().getFullYear()]));
        for (const yr of yearsToSeed) {
            await ensureLeaveBalances(employeeId, yr);
        }

        // If login credentials provided, create user account
        if (username && password && role) {
            const passwordHash = await bcrypt.hash(password, 10);
            await runAsync(`
                INSERT INTO users (username, password_hash, role, employee_id)
                VALUES (?, ?, ?, ?)
            `, [username.trim(), passwordHash, role, employeeId]);
        }

        await logAudit(req, req.user.userId, req.user.username, 'CREATE_EMPLOYEE', `Created employee ${name} (${employee_number})`);
        res.status(201).json({ message: 'Employee registered successfully', employee_id: employeeId });
    } catch (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ message: 'Employee number, NIC, or Email already exists.' });
        }
        res.status(500).json({ message: err.message });
    }
});

// PUT /api/employees/:id
app.put('/api/employees/:id', authenticateToken, authorizeRoles('Admin', 'HR'), async (req, res) => {
    try {
        const { name, nic, email, phone, department_id, designation, supervisor_id, date_of_appointment, status } = req.body;
        const employeeId = req.params.id;

        const nicValidation = validateAndFormatNIC(nic);
        if (!nicValidation.isValid) {
            return res.status(400).json({ message: nicValidation.message });
        }

        await runAsync(`
            UPDATE employees
            SET name = ?, nic = ?, email = ?, phone = ?, department_id = ?, designation = ?, supervisor_id = ?, date_of_appointment = ?, status = ?
            WHERE employee_id = ?
        `, [name.trim(), nicValidation.formattedNIC, email.trim(), phone || '', department_id, designation.trim(), supervisor_id || null, date_of_appointment, status || 'Active', employeeId]);

        await logAudit(req, req.user.userId, req.user.username, 'UPDATE_EMPLOYEE', `Updated employee ID ${employeeId}`);
        res.json({ message: 'Employee details updated successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// =========================================
// 4. LEAVE TYPE MANAGEMENT ENDPOINTS
// =========================================

// GET /api/leave-types
app.get('/api/leave-types', authenticateToken, async (req, res) => {
    try {
        const leaveTypes = await allAsync(`SELECT * FROM leave_types ORDER BY leave_type_id ASC`);
        res.json(leaveTypes);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// POST /api/leave-types
app.post('/api/leave-types', authenticateToken, authorizeRoles('Admin', 'HR'), async (req, res) => {
    try {
        const { leave_type_name, maximum_days, description, requires_document, gender_restriction } = req.body;
        if (!leave_type_name || maximum_days === undefined) {
            return res.status(400).json({ message: 'Leave type name and maximum days are required.' });
        }

        const result = await runAsync(`
            INSERT INTO leave_types (leave_type_name, maximum_days, description, requires_document, gender_restriction)
            VALUES (?, ?, ?, ?, ?)
        `, [leave_type_name.trim(), maximum_days, description || '', requires_document ? 1 : 0, gender_restriction || 'All']);

        const leaveTypeId = result.lastID;

        // Populate this new leave type for existing employees for current year
        const currentYear = new Date().getFullYear();
        const employees = await allAsync(`SELECT employee_id FROM employees`);
        for (const emp of employees) {
            await runAsync(`
                INSERT OR IGNORE INTO leave_balances (employee_id, leave_type_id, year, allocated_days, used_days, remaining_days)
                VALUES (?, ?, ?, ?, 0, ?)
            `, [emp.employee_id, leaveTypeId, currentYear, maximum_days, maximum_days]);
        }

        await logAudit(req, req.user.userId, req.user.username, 'CREATE_LEAVE_TYPE', `Created leave type ${leave_type_name}`);
        res.status(201).json({ message: 'Leave type created successfully', leave_type_id: leaveTypeId });
    } catch (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ message: 'Leave type name already exists.' });
        }
        res.status(500).json({ message: err.message });
    }
});

// =========================================
// 5. LEAVE APPLICATION & BALANCE ENDPOINTS
// =========================================

// GET /api/leave-balances/my
app.get('/api/leave-balances/my', authenticateToken, async (req, res) => {
    try {
        const employeeId = req.user.employeeId;
        if (!employeeId) {
            return res.status(400).json({ message: 'User is not linked to an employee profile.' });
        }
        const year = req.query.year || new Date().getFullYear();

        await ensureLeaveBalances(employeeId, year);

        const balances = await allAsync(`
            SELECT lb.*, lt.leave_type_name, lt.maximum_days, lt.description, lt.requires_document
            FROM leave_balances lb
            JOIN leave_types lt ON lb.leave_type_id = lt.leave_type_id
            WHERE lb.employee_id = ? AND lb.year = ?
            ORDER BY lt.leave_type_id ASC
        `, [employeeId, year]);

        res.json(balances);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// GET /api/leave-balances/employee/:id
app.get('/api/leave-balances/employee/:id', authenticateToken, async (req, res) => {
    try {
        const employeeId = req.params.id;
        const year = req.query.year || new Date().getFullYear();

        await ensureLeaveBalances(employeeId, year);

        const balances = await allAsync(`
            SELECT lb.*, lt.leave_type_name, lt.maximum_days, lt.description
            FROM leave_balances lb
            JOIN leave_types lt ON lb.leave_type_id = lt.leave_type_id
            WHERE lb.employee_id = ? AND lb.year = ?
            ORDER BY lt.leave_type_id ASC
        `, [employeeId, year]);

        res.json(balances);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// POST /api/leave-applications
app.post('/api/leave-applications', authenticateToken, async (req, res) => {
    try {
        const employeeId = req.user.employeeId;
        if (!employeeId) {
            return res.status(400).json({ message: 'Only registered employees can submit leave applications.' });
        }

        const { leave_type_id, start_date, end_date, number_of_days, reason, attachment_path } = req.body;

        if (!leave_type_id || !start_date || !end_date || !number_of_days || !reason) {
            return res.status(400).json({ message: 'All fields (Leave Type, Dates, Days Count, Reason) are required.' });
        }

        const numDays = parseFloat(number_of_days);
        if (isNaN(numDays) || numDays <= 0) {
            return res.status(400).json({ message: 'Number of days must be greater than zero.' });
        }

        // Check Leave Balance
        const currentYear = new Date(start_date).getFullYear() || new Date().getFullYear();
        await ensureLeaveBalances(employeeId, currentYear);
        const balance = await getAsync(`
            SELECT * FROM leave_balances
            WHERE employee_id = ? AND leave_type_id = ? AND year = ?
        `, [employeeId, leave_type_id, currentYear]);

        if (!balance) {
            return res.status(400).json({ message: 'No leave balance allocation found for this leave type/year.' });
        }

        if (balance.remaining_days < numDays) {
            return res.status(400).json({
                message: `Insufficient leave balance. Remaining: ${balance.remaining_days} day(s), Requested: ${numDays} day(s).`
            });
        }

        // Check if leave type requires document
        const leaveType = await getAsync(`SELECT * FROM leave_types WHERE leave_type_id = ?`, [leave_type_id]);
        if (leaveType && leaveType.requires_document && numDays >= 2 && !attachment_path) {
            return res.status(400).json({ message: `${leaveType.leave_type_name} for 2 or more days requires a supporting document/certificate.` });
        }

        // Create Leave Application
        const result = await runAsync(`
            INSERT INTO leave_applications (employee_id, leave_type_id, start_date, end_date, number_of_days, reason, attachment_path, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending')
        `, [employeeId, leave_type_id, start_date, end_date, numDays, reason.trim(), attachment_path || null]);

        const applicationId = result.lastID;

        // Find Supervisor to send Notification
        const emp = await getAsync(`SELECT supervisor_id, name FROM employees WHERE employee_id = ?`, [employeeId]);
        if (emp && emp.supervisor_id) {
            const supervisorUser = await getAsync(`SELECT user_id FROM users WHERE employee_id = ?`, [emp.supervisor_id]);
            if (supervisorUser) {
                await sendNotification(
                    supervisorUser.user_id,
                    'New Leave Application',
                    `${emp.name} has submitted a new leave application for ${numDays} day(s) starting from ${start_date}.`
                );
            }
        }

        await logAudit(req, req.user.userId, req.user.username, 'SUBMIT_LEAVE', `Submitted leave application #${applicationId} for ${numDays} days.`);
        res.status(201).json({ message: 'Leave application submitted successfully', application_id: applicationId });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// GET /api/leave-applications/my
app.get('/api/leave-applications/my', authenticateToken, async (req, res) => {
    try {
        const employeeId = req.user.employeeId;
        const applications = await allAsync(`
            SELECT la.*, lt.leave_type_name, lap.comments as supervisor_comments, sup.name as supervisor_name
            FROM leave_applications la
            JOIN leave_types lt ON la.leave_type_id = lt.leave_type_id
            LEFT JOIN leave_approvals lap ON la.application_id = lap.application_id
            LEFT JOIN employees sup ON lap.approver_id = sup.employee_id
            WHERE la.employee_id = ?
            ORDER BY la.application_id DESC
        `, [employeeId]);

        res.json(applications);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// PUT /api/leave-applications/:id/cancel
app.put('/api/leave-applications/:id/cancel', authenticateToken, async (req, res) => {
    try {
        const applicationId = req.params.id;
        const appRecord = await getAsync(`SELECT * FROM leave_applications WHERE application_id = ?`, [applicationId]);

        if (!appRecord) return res.status(404).json({ message: 'Application not found' });
        if (appRecord.employee_id !== req.user.employeeId) {
            return res.status(403).json({ message: 'You can only cancel your own applications.' });
        }
        if (appRecord.status !== 'Pending') {
            return res.status(400).json({ message: `Cannot cancel application with status '${appRecord.status}'.` });
        }

        await runAsync(`UPDATE leave_applications SET status = 'Cancelled' WHERE application_id = ?`, [applicationId]);

        await logAudit(req, req.user.userId, req.user.username, 'CANCEL_LEAVE', `Cancelled leave application #${applicationId}`);
        res.json({ message: 'Leave application cancelled successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// =========================================
// 6. APPROVAL WORKFLOW ENDPOINTS (Supervisor/HR/Admin)
// =========================================

// GET /api/leave-applications/pending
app.get('/api/leave-applications/pending', authenticateToken, authorizeRoles('Supervisor', 'HR', 'Admin'), async (req, res) => {
    try {
        let query = `
            SELECT la.*, lt.leave_type_name, e.name as employee_name, e.employee_number, e.designation, d.department_name
            FROM leave_applications la
            JOIN leave_types lt ON la.leave_type_id = lt.leave_type_id
            JOIN employees e ON la.employee_id = e.employee_id
            LEFT JOIN departments d ON e.department_id = d.department_id
            WHERE la.status = 'Pending'
        `;
        const params = [];

        // If Supervisor, filter by employees assigned to this supervisor
        if (req.user.role === 'Supervisor' && req.user.employeeId) {
            query += ` AND e.supervisor_id = ?`;
            params.push(req.user.employeeId);
        }

        query += ` ORDER BY la.application_id ASC`;

        const pendingApps = await allAsync(query, params);
        res.json(pendingApps);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// POST /api/leave-applications/:id/approval
app.post('/api/leave-applications/:id/approval', authenticateToken, authorizeRoles('Supervisor', 'HR', 'Admin'), async (req, res) => {
    try {
        const applicationId = req.params.id;
        const { approval_status, comments } = req.body; // 'Approved' or 'Rejected'

        if (!['Approved', 'Rejected'].includes(approval_status)) {
            return res.status(400).json({ message: 'Status must be Approved or Rejected.' });
        }

        const appRecord = await getAsync(`SELECT * FROM leave_applications WHERE application_id = ?`, [applicationId]);
        if (!appRecord) return res.status(404).json({ message: 'Application not found' });

        if (appRecord.status !== 'Pending') {
            return res.status(400).json({ message: `Application already processed with status: ${appRecord.status}` });
        }

        const approverEmployeeId = req.user.employeeId;

        if (approval_status === 'Approved') {
            const year = new Date(appRecord.start_date).getFullYear() || new Date().getFullYear();
            await ensureLeaveBalances(appRecord.employee_id, year);
            const balance = await getAsync(`
                SELECT * FROM leave_balances
                WHERE employee_id = ? AND leave_type_id = ? AND year = ?
            `, [appRecord.employee_id, appRecord.leave_type_id, year]);

            if (!balance) {
                return res.status(400).json({ message: 'Leave balance not initialized for employee.' });
            }

            if (balance.remaining_days < appRecord.number_of_days) {
                return res.status(400).json({ message: `Cannot approve: Requested days exceed remaining balance (${balance.remaining_days} left).` });
            }

            // Update Balance: Remaining = Allocated - Used
            const newUsed = balance.used_days + appRecord.number_of_days;
            const newRemaining = balance.allocated_days - newUsed;

            await runAsync(`
                UPDATE leave_balances
                SET used_days = ?, remaining_days = ?
                WHERE balance_id = ?
            `, [newUsed, newRemaining, balance.balance_id]);

            // Alert low balance notification if remaining <= 3
            if (newRemaining <= 3) {
                const empUser = await getAsync(`SELECT user_id FROM users WHERE employee_id = ?`, [appRecord.employee_id]);
                if (empUser) {
                    await sendNotification(empUser.user_id, 'Low Leave Balance Alert', `Your remaining balance for leave type ID ${appRecord.leave_type_id} is low (${newRemaining} day(s) remaining).`);
                }
            }
        }

        // Update Application Status
        await runAsync(`UPDATE leave_applications SET status = ? WHERE application_id = ?`, [approval_status, applicationId]);

        // Insert Approval Record
        await runAsync(`
            INSERT INTO leave_approvals (application_id, approver_id, approval_status, comments)
            VALUES (?, ?, ?, ?)
        `, [applicationId, approverEmployeeId || 0, approval_status, comments || '']);

        // Notify Employee
        const empUser = await getAsync(`SELECT user_id FROM users WHERE employee_id = ?`, [appRecord.employee_id]);
        if (empUser) {
            await sendNotification(
                empUser.user_id,
                `Leave Application ${approval_status}`,
                `Your leave application for ${appRecord.number_of_days} day(s) starting ${appRecord.start_date} has been ${approval_status.toLowerCase()}.${comments ? ' Comments: ' + comments : ''}`
            );
        }

        await logAudit(req, req.user.userId, req.user.username, 'APPROVE_LEAVE', `Leave Application #${applicationId} set to ${approval_status}.`);
        res.json({ message: `Leave application ${approval_status.toLowerCase()} successfully.` });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// =========================================
// 7. NOTIFICATIONS & AUDIT LOGS ENDPOINTS
// =========================================

// GET /api/notifications
app.get('/api/notifications', authenticateToken, async (req, res) => {
    try {
        const notifications = await allAsync(`
            SELECT * FROM notifications
            WHERE user_id = ?
            ORDER BY notification_id DESC
            LIMIT 20
        `, [req.user.userId]);

        res.json(notifications);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// PUT /api/notifications/read
app.put('/api/notifications/read', authenticateToken, async (req, res) => {
    try {
        await runAsync(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`, [req.user.userId]);
        res.json({ message: 'Notifications marked as read' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// GET /api/audit-logs
app.get('/api/audit-logs', authenticateToken, authorizeRoles('Admin', 'HR'), async (req, res) => {
    try {
        const logs = await allAsync(`SELECT * FROM audit_logs ORDER BY log_id DESC LIMIT 100`);
        res.json(logs);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// =========================================
// 8. REPORTING ENDPOINTS
// =========================================

// GET /api/reports/leave-summary
app.get('/api/reports/leave-summary', authenticateToken, authorizeRoles('Admin', 'HR', 'Supervisor'), async (req, res) => {
    try {
        const { department_id, year, status } = req.query;
        const currentYear = year || new Date().getFullYear();

        let query = `
            SELECT la.*, e.employee_number, e.name as employee_name, e.designation, d.department_name, lt.leave_type_name
            FROM leave_applications la
            JOIN employees e ON la.employee_id = e.employee_id
            JOIN departments d ON e.department_id = d.department_id
            JOIN leave_types lt ON la.leave_type_id = lt.leave_type_id
            WHERE strftime('%Y', la.start_date) = ?
        `;
        const params = [String(currentYear)];

        if (department_id) {
            query += ` AND e.department_id = ?`;
            params.push(department_id);
        }

        if (status) {
            query += ` AND la.status = ?`;
            params.push(status);
        }

        if (req.user.role === 'Supervisor' && req.user.employeeId) {
            query += ` AND e.supervisor_id = ?`;
            params.push(req.user.employeeId);
        }

        query += ` ORDER BY la.application_id DESC`;

        const reportData = await allAsync(query, params);
        res.json(reportData);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// GET /api/reports/leave-balances
app.get('/api/reports/leave-balances', authenticateToken, authorizeRoles('Admin', 'HR', 'Supervisor'), async (req, res) => {
    try {
        const { department_id, year } = req.query;
        const currentYear = year || new Date().getFullYear();

        const allEmps = await allAsync(`SELECT employee_id FROM employees`);
        for (const emp of allEmps) {
            await ensureLeaveBalances(emp.employee_id, currentYear);
        }

        let query = `
            SELECT lb.*, e.employee_number, e.name as employee_name, d.department_name, lt.leave_type_name
            FROM leave_balances lb
            JOIN employees e ON lb.employee_id = e.employee_id
            JOIN departments d ON e.department_id = d.department_id
            JOIN leave_types lt ON lb.leave_type_id = lt.leave_type_id
            WHERE lb.year = ?
        `;
        const params = [currentYear];

        if (department_id) {
            query += ` AND e.department_id = ?`;
            params.push(department_id);
        }

        if (req.user.role === 'Supervisor' && req.user.employeeId) {
            query += ` AND e.supervisor_id = ?`;
            params.push(req.user.employeeId);
        }

        query += ` ORDER BY e.name ASC, lt.leave_type_id ASC`;

        const reportData = await allAsync(query, params);
        res.json(reportData);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// GET /api/users
app.get('/api/users', authenticateToken, authorizeRoles('Admin'), async (req, res) => {
    try {
        const users = await allAsync(`
            SELECT u.user_id, u.username, u.role, u.created_at, e.name as employee_name, e.employee_number
            FROM users u
            LEFT JOIN employees e ON u.employee_id = e.employee_id
            ORDER BY u.user_id DESC
        `);
        res.json(users);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// POST /api/users
app.post('/api/users', authenticateToken, authorizeRoles('Admin'), async (req, res) => {
    try {
        const { username, password, role, employee_id } = req.body;
        if (!username || !password || !role) {
            return res.status(400).json({ message: 'Username, password, and role are required.' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        await runAsync(`
            INSERT INTO users (username, password_hash, role, employee_id)
            VALUES (?, ?, ?, ?)
        `, [username.trim(), passwordHash, role, employee_id || null]);

        await logAudit(req, req.user.userId, req.user.username, 'CREATE_USER', `Created user account ${username} with role ${role}`);
        res.status(201).json({ message: 'User account created successfully' });
    } catch (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ message: 'Username already exists.' });
        }
        res.status(500).json({ message: err.message });
    }
});

// Initialize database and export app module / start server if run directly
initDb().then(() => {
    if (require.main === module) {
        app.listen(PORT, () => {
            console.log(`GELMS Server running on port ${PORT}`);
        });
    }
}).catch(err => console.error('Database initialization failed:', err));

module.exports = app;
