const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DB_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

const DB_PATH = path.join(DB_DIR, 'database.sqlite');
const db = new sqlite3.Database(DB_PATH);

function runAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function getAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function allAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function initDb() {
    console.log('Initializing GELMS Database Schema...');

    // Foreign keys enabled
    await runAsync('PRAGMA foreign_keys = ON');

    // Users table
    await runAsync(`CREATE TABLE IF NOT EXISTS users (
        user_id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL, -- 'Employee', 'Supervisor', 'HR', 'Admin'
        employee_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE SET NULL
    )`);

    // Departments table
    await runAsync(`CREATE TABLE IF NOT EXISTS departments (
        department_id INTEGER PRIMARY KEY AUTOINCREMENT,
        department_code TEXT UNIQUE NOT NULL,
        department_name TEXT NOT NULL
    )`);

    // Employees table
    await runAsync(`CREATE TABLE IF NOT EXISTS employees (
        employee_id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_number TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        nic TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT,
        department_id INTEGER,
        designation TEXT NOT NULL,
        supervisor_id INTEGER,
        date_of_appointment TEXT NOT NULL,
        status TEXT DEFAULT 'Active',
        FOREIGN KEY (department_id) REFERENCES departments(department_id),
        FOREIGN KEY (supervisor_id) REFERENCES employees(employee_id)
    )`);

    // Leave Types table
    await runAsync(`CREATE TABLE IF NOT EXISTS leave_types (
        leave_type_id INTEGER PRIMARY KEY AUTOINCREMENT,
        leave_type_name TEXT UNIQUE NOT NULL,
        maximum_days INTEGER NOT NULL,
        description TEXT,
        requires_document INTEGER DEFAULT 0,
        gender_restriction TEXT DEFAULT 'All' -- 'All', 'Female', 'Male'
    )`);

    // Leave Balances table
    await runAsync(`CREATE TABLE IF NOT EXISTS leave_balances (
        balance_id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        leave_type_id INTEGER NOT NULL,
        year INTEGER NOT NULL,
        allocated_days REAL NOT NULL,
        used_days REAL DEFAULT 0,
        remaining_days REAL NOT NULL,
        UNIQUE(employee_id, leave_type_id, year),
        FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE,
        FOREIGN KEY (leave_type_id) REFERENCES leave_types(leave_type_id) ON DELETE CASCADE
    )`);

    // Leave Applications table
    await runAsync(`CREATE TABLE IF NOT EXISTS leave_applications (
        application_id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        leave_type_id INTEGER NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        number_of_days REAL NOT NULL,
        reason TEXT NOT NULL,
        attachment_path TEXT,
        status TEXT DEFAULT 'Pending', -- 'Pending', 'Approved', 'Rejected', 'Cancelled'
        applied_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE,
        FOREIGN KEY (leave_type_id) REFERENCES leave_types(leave_type_id)
    )`);

    // Leave Approvals table
    await runAsync(`CREATE TABLE IF NOT EXISTS leave_approvals (
        approval_id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER NOT NULL,
        approver_id INTEGER NOT NULL,
        approval_status TEXT NOT NULL, -- 'Approved', 'Rejected'
        comments TEXT,
        approval_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (application_id) REFERENCES leave_applications(application_id) ON DELETE CASCADE,
        FOREIGN KEY (approver_id) REFERENCES employees(employee_id)
    )`);

    // Notifications table
    await runAsync(`CREATE TABLE IF NOT EXISTS notifications (
        notification_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        is_read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )`);

    // Audit Logs table
    await runAsync(`CREATE TABLE IF NOT EXISTS audit_logs (
        log_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT,
        action TEXT NOT NULL,
        details TEXT NOT NULL,
        ip_address TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await seedDefaults();
    console.log('Database initialized successfully.');
}

async function seedDefaults() {
    // Seed Departments
    const depts = [
        ['ADMIN', 'Administration & HR Department'],
        ['HEALTH', 'Ministry of Health & Medical Services'],
        ['FINANCE', 'Finance & Procurement Division'],
        ['IT', 'Information Technology Division'],
        ['EDU', 'Education & Public Services']
    ];

    for (const [code, name] of depts) {
        await runAsync(`INSERT OR IGNORE INTO departments (department_code, department_name) VALUES (?, ?)`, [code, name]);
    }

    // Seed Leave Types according to Sri Lanka Government Standards
    const leaveTypes = [
        ['Annual Leave', 21, 'Yearly allocated vacation leave entitlement for government officers', 0, 'All'],
        ['Casual Leave', 21, 'Short-term personal / urgent casual leave', 0, 'All'],
        ['Medical Leave', 24, 'Medical sick leave supported by medical certificate', 1, 'All'],
        ['Maternity Leave', 84, 'Full pay maternity leave for female officers', 1, 'Female'],
        ['No-Pay Leave', 365, 'Special no-pay leave granted under government circulars', 0, 'All'],
        ['Special Leave', 14, 'Leave for special circumstances (religious, exam, duty)', 0, 'All'],
        ['Duty Leave', 30, 'Official duties, official workshops, or official training', 0, 'All']
    ];

    for (const [name, days, desc, reqDoc, gender] of leaveTypes) {
        await runAsync(`INSERT OR IGNORE INTO leave_types (leave_type_name, maximum_days, description, requires_document, gender_restriction) VALUES (?, ?, ?, ?, ?)`, [name, days, desc, reqDoc, gender]);
    }

    // Seed System Admin User
    const adminUser = await getAsync(`SELECT * FROM users WHERE username = 'admin'`);
    if (!adminUser) {
        const passwordHash = await bcrypt.hash('Admin@123', 10);
        await runAsync(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)`, ['admin', passwordHash, 'Admin']);
    }

    // Seed Sample Employees and Users for Demo/Testing
    // Department IDs: ADMIN=1, HEALTH=2, FINANCE=3, IT=4, EDU=5
    const healthDept = await getAsync(`SELECT department_id FROM departments WHERE department_code = 'HEALTH'`);
    const healthDeptId = healthDept ? healthDept.department_id : 1;

    // Supervisor employee
    let supervisor = await getAsync(`SELECT * FROM employees WHERE employee_number = 'EMP001'`);
    if (!supervisor) {
        await runAsync(`INSERT INTO employees (employee_number, name, nic, email, phone, department_id, designation, date_of_appointment) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            ['EMP001', 'Dr. K. L. Perera', '197812345678', 'perera@health.gov.lk', '0771234567', healthDeptId, 'Senior Medical Officer / Supervisor', '2005-03-15']
        );
        supervisor = await getAsync(`SELECT * FROM employees WHERE employee_number = 'EMP001'`);

        const supHash = await bcrypt.hash('Supervisor@123', 10);
        await runAsync(`INSERT INTO users (username, password_hash, role, employee_id) VALUES (?, ?, ?, ?)`,
            ['supervisor', supHash, 'Supervisor', supervisor.employee_id]
        );
    }

    // Regular Employee
    let employee1 = await getAsync(`SELECT * FROM employees WHERE employee_number = 'EMP002'`);
    if (!employee1) {
        await runAsync(`INSERT INTO employees (employee_number, name, nic, email, phone, department_id, designation, supervisor_id, date_of_appointment) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ['EMP002', 'S. M. Fernando', '199256781234', 'fernando@health.gov.lk', '0719876543', healthDeptId, 'Management Service Officer', supervisor.employee_id, '2016-08-01']
        );
        employee1 = await getAsync(`SELECT * FROM employees WHERE employee_number = 'EMP002'`);

        const empHash = await bcrypt.hash('Employee@123', 10);
        await runAsync(`INSERT INTO users (username, password_hash, role, employee_id) VALUES (?, ?, ?, ?)`,
            ['employee', empHash, 'Employee', employee1.employee_id]
        );
    }

    // HR Officer
    let hrOfficer = await getAsync(`SELECT * FROM employees WHERE employee_number = 'EMP003'`);
    if (!hrOfficer) {
        await runAsync(`INSERT INTO employees (employee_number, name, nic, email, phone, department_id, designation, supervisor_id, date_of_appointment) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ['EMP003', 'A. B. Jayasinghe', '198534567890', 'hr@gov.lk', '0703334444', 1, 'HR Executive Officer', supervisor.employee_id, '2010-01-10']
        );
        hrOfficer = await getAsync(`SELECT * FROM employees WHERE employee_number = 'EMP003'`);

        const hrHash = await bcrypt.hash('Hr@123456', 10);
        await runAsync(`INSERT INTO users (username, password_hash, role, employee_id) VALUES (?, ?, ?, ?)`,
            ['hrofficer', hrHash, 'HR', hrOfficer.employee_id]
        );
    }

    // Populate Leave Balances for 2025 and the current system year for all existing employees
    const yearsToSeed = Array.from(new Set([2025, new Date().getFullYear()]));
    const allEmployees = await allAsync(`SELECT employee_id FROM employees`);
    const allLeaveTypes = await allAsync(`SELECT leave_type_id, maximum_days FROM leave_types`);

    for (const year of yearsToSeed) {
        for (const emp of allEmployees) {
            for (const lt of allLeaveTypes) {
                await runAsync(`INSERT OR IGNORE INTO leave_balances (employee_id, leave_type_id, year, allocated_days, used_days, remaining_days) VALUES (?, ?, ?, ?, ?, ?)`,
                    [emp.employee_id, lt.leave_type_id, year, lt.maximum_days, 0, lt.maximum_days]
                );
            }
        }
    }
}

module.exports = {
    db,
    runAsync,
    getAsync,
    allAsync,
    initDb
};
