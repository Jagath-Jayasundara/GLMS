// GELMS Frontend Application Controller

let currentUser = null;
let currentToken = null;

document.addEventListener('DOMContentLoaded', () => {
    // Check saved session
    const token = localStorage.getItem('gelms_token');
    const user = localStorage.getItem('gelms_user');

    if (token && user) {
        currentToken = token;
        currentUser = JSON.parse(user);
        initAuthenticatedUI();
    } else {
        showLogin();
    }

    // Attach Event Listeners
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);
    document.getElementById('applyLeaveForm').addEventListener('submit', handleApplyLeave);
    document.getElementById('addEmployeeForm').addEventListener('submit', handleAddEmployee);
    document.getElementById('generateReportBtn').addEventListener('click', handleGenerateReport);

    const applyStartDateInput = document.getElementById('applyStartDate');
    const applyEndDateInput = document.getElementById('applyEndDate');
    if (applyStartDateInput && applyEndDateInput) {
        applyStartDateInput.addEventListener('change', calculateLeaveDays);
        applyStartDateInput.addEventListener('input', calculateLeaveDays);
        applyEndDateInput.addEventListener('change', calculateLeaveDays);
        applyEndDateInput.addEventListener('input', calculateLeaveDays);
    }

    // Tab Navigation Listener
    document.querySelectorAll('.nav-item').forEach(nav => {
        nav.addEventListener('click', (e) => {
            const tabName = e.target.getAttribute('data-tab');
            switchTab(tabName);
        });
    });
});

function showLogin() {
    document.getElementById('loginView').style.display = 'block';
    document.getElementById('appContent').style.display = 'none';
    document.getElementById('userNav').style.display = 'none';
    document.getElementById('appNav').style.display = 'none';
}

function initAuthenticatedUI() {
    document.getElementById('loginView').style.display = 'none';
    document.getElementById('appContent').style.display = 'block';
    document.getElementById('userNav').style.display = 'flex';
    document.getElementById('appNav').style.display = 'flex';

    document.getElementById('navUserName').textContent = currentUser.employeeName || currentUser.username;
    document.getElementById('navUserRole').textContent = currentUser.role;

    // Show role-specific tab items
    const role = currentUser.role;
    document.querySelectorAll('.supervisor-only').forEach(el => el.style.display = (role === 'Supervisor' || role === 'Admin' || role === 'HR') ? 'block' : 'none');
    document.querySelectorAll('.hr-only').forEach(el => el.style.display = (role === 'HR' || role === 'Admin') ? 'block' : 'none');
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = (role === 'Admin') ? 'block' : 'none');
    document.querySelectorAll('.admin-hr-sup').forEach(el => el.style.display = (role === 'Admin' || role === 'HR' || role === 'Supervisor') ? 'block' : 'none');
    document.querySelectorAll('.admin-hr').forEach(el => el.style.display = (role === 'Admin' || role === 'HR') ? 'block' : 'none');

    switchTab('dashboard');
}

async function handleLogin(e) {
    e.preventDefault();
    const usernameInput = document.getElementById('username').value;
    const passwordInput = document.getElementById('password').value;
    const errDiv = document.getElementById('loginError');

    errDiv.style.display = 'none';

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: usernameInput, password: passwordInput })
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.message || 'Login failed');
        }

        currentToken = data.token;
        currentUser = data.user;

        localStorage.setItem('gelms_token', currentToken);
        localStorage.setItem('gelms_user', JSON.stringify(currentUser));

        initAuthenticatedUI();
    } catch (err) {
        errDiv.textContent = err.message;
        errDiv.style.display = 'block';
    }
}

function handleLogout() {
    localStorage.removeItem('gelms_token');
    localStorage.removeItem('gelms_user');
    currentToken = null;
    currentUser = null;
    showLogin();
}

function switchTab(tabName) {
    document.querySelectorAll('.nav-item').forEach(nav => {
        if (nav.getAttribute('data-tab') === tabName) {
            nav.classList.add('active');
        } else {
            nav.classList.remove('active');
        }
    });

    document.querySelectorAll('.tab-page').forEach(page => {
        page.style.display = page.id === `tab-${tabName}` ? 'block' : 'none';
    });

    // Load data based on tab
    if (tabName === 'dashboard') loadDashboard();
    else if (tabName === 'applyLeave') loadApplyLeaveForm();
    else if (tabName === 'leaveHistory') loadLeaveHistory();
    else if (tabName === 'approvals') loadPendingApprovals();
    else if (tabName === 'employees') loadEmployees();
    else if (tabName === 'leaveTypes') loadLeaveTypes();
    else if (tabName === 'users') loadUsers();
    else if (tabName === 'reports') loadReportsInit();
    else if (tabName === 'auditLogs') loadAuditLogs();
}

// ---------------- DASHBOARD ----------------
async function loadDashboard() {
    const currentYear = new Date().getFullYear();
    const yearElem = document.getElementById('currentYearText');
    if (yearElem) yearElem.textContent = currentYear;

    document.getElementById('dashEmployeeName').textContent = currentUser.employeeName || currentUser.username;
    document.getElementById('dashDepartment').textContent = currentUser.designation || currentUser.role;

    // Load Leave Balances
    const grid = document.getElementById('leaveBalancesGrid');
    grid.innerHTML = '<p>Loading balances...</p>';

    try {
        const res = await fetch('/api/leave-balances/my', {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        const balances = await res.json();

        grid.innerHTML = '';
        if (Array.isArray(balances) && balances.length > 0) {
            balances.forEach(b => {
                const tile = document.createElement('div');
                tile.className = 'balance-tile';
                tile.innerHTML = `
                    <h4>${b.leave_type_name}</h4>
                    <div class="balance-stats">
                        <span class="balance-number">${b.remaining_days} <span style="font-size:0.9rem">Days</span></span>
                        <span class="balance-sub">Used: ${b.used_days} / ${b.allocated_days}</span>
                    </div>
                `;
                grid.appendChild(tile);
            });
        } else {
            const message = balances && balances.message ? balances.message : 'No active leave allocations found for this profile.';
            grid.innerHTML = `<p style="color: var(--text-muted);">${message}</p>`;
        }

        // Load Notifications
        const notifRes = await fetch('/api/notifications', {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        const notifications = await notifRes.json();
        const notifDiv = document.getElementById('notificationsList');
        notifDiv.innerHTML = '';

        if (Array.isArray(notifications) && notifications.length > 0) {
            notifications.forEach(n => {
                const item = document.createElement('div');
                item.className = `notification-item ${n.is_read ? '' : 'unread'}`;
                item.innerHTML = `
                    <strong>${n.title}</strong>
                    <p style="margin:2px 0;">${n.message}</p>
                    <span class="notification-time">${new Date(n.created_at).toLocaleString()}</span>
                `;
                notifDiv.appendChild(item);
            });
        } else {
            notifDiv.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem;">No recent notifications.</p>';
        }
    } catch (e) {
        console.error(e);
    }
}

// ---------------- APPLY LEAVE ----------------
function calculateLeaveDays() {
    const startDateVal = document.getElementById('applyStartDate').value;
    const endDateVal = document.getElementById('applyEndDate').value;
    const numDaysInput = document.getElementById('applyNumDays');

    if (startDateVal) {
        document.getElementById('applyEndDate').min = startDateVal;
    } else {
        document.getElementById('applyEndDate').removeAttribute('min');
    }

    if (!startDateVal || !endDateVal) {
        return;
    }

    const start = new Date(startDateVal + 'T00:00:00');
    const end = new Date(endDateVal + 'T00:00:00');

    if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        const diffTime = end.getTime() - start.getTime();
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;

        if (diffDays >= 0.5) {
            numDaysInput.value = diffDays;
        } else {
            numDaysInput.value = '';
        }
    }
}

async function loadApplyLeaveForm() {
    const select = document.getElementById('applyLeaveType');
    select.innerHTML = '<option value="">-- Select Leave Type --</option>';

    try {
        const res = await fetch('/api/leave-types', {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        const leaveTypes = await res.json();

        leaveTypes.forEach(lt => {
            const opt = document.createElement('option');
            opt.value = lt.leave_type_id;
            opt.textContent = `${lt.leave_type_name} (Max ${lt.maximum_days} Days)`;
            select.appendChild(opt);
        });
    } catch (e) {
        console.error(e);
    }
}

async function handleApplyLeave(e) {
    e.preventDefault();
    const msgDiv = document.getElementById('applyMessage');
    msgDiv.style.display = 'none';

    const payload = {
        leave_type_id: document.getElementById('applyLeaveType').value,
        start_date: document.getElementById('applyStartDate').value,
        end_date: document.getElementById('applyEndDate').value,
        number_of_days: document.getElementById('applyNumDays').value,
        reason: document.getElementById('applyReason').value
    };

    try {
        const res = await fetch('/api/leave-applications', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Failed to submit application');

        msgDiv.className = 'badge badge-approved';
        msgDiv.style.width = '100%';
        msgDiv.style.padding = '10px';
        msgDiv.style.textAlign = 'center';
        msgDiv.textContent = 'Leave Application Submitted Successfully!';
        msgDiv.style.display = 'block';

        document.getElementById('applyLeaveForm').reset();
    } catch (err) {
        msgDiv.className = 'badge badge-rejected';
        msgDiv.style.width = '100%';
        msgDiv.style.padding = '10px';
        msgDiv.style.textAlign = 'center';
        msgDiv.textContent = err.message;
        msgDiv.style.display = 'block';
    }
}

// ---------------- LEAVE HISTORY ----------------
async function loadLeaveHistory() {
    const body = document.getElementById('myLeaveHistoryBody');
    body.innerHTML = '<tr><td colspan="8">Loading history...</td></tr>';

    try {
        const res = await fetch('/api/leave-applications/my', {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        const apps = await res.json();

        body.innerHTML = '';
        if (Array.isArray(apps) && apps.length > 0) {
            apps.forEach(a => {
                const tr = document.createElement('tr');
                let badgeClass = 'badge-pending';
                if (a.status === 'Approved') badgeClass = 'badge-approved';
                if (a.status === 'Rejected') badgeClass = 'badge-rejected';
                if (a.status === 'Cancelled') badgeClass = 'badge-cancelled';

                tr.innerHTML = `
                    <td>#${a.application_id}</td>
                    <td>${a.leave_type_name}</td>
                    <td>${a.start_date}</td>
                    <td>${a.end_date}</td>
                    <td>${a.number_of_days}</td>
                    <td>${a.reason}</td>
                    <td><span class="badge ${badgeClass}">${a.status}</span></td>
                    <td>
                        ${a.status === 'Pending' ? `<button class="btn btn-danger btn-sm" onclick="cancelLeave(${a.application_id})">Cancel</button>` : '-'}
                    </td>
                `;
                body.appendChild(tr);
            });
        } else {
            body.innerHTML = '<tr><td colspan="8" style="text-align:center; color: var(--text-muted)">No leave applications found.</td></tr>';
        }
    } catch (e) {
        console.error(e);
    }
}

async function cancelLeave(id) {
    if (!confirm('Are you sure you want to cancel this leave application?')) return;

    try {
        const res = await fetch(`/api/leave-applications/${id}/cancel`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        const data = await res.json();
        alert(data.message);
        loadLeaveHistory();
    } catch (e) {
        alert(e.message);
    }
}

// ---------------- APPROVALS ----------------
async function loadPendingApprovals() {
    const body = document.getElementById('pendingApprovalsBody');
    body.innerHTML = '<tr><td colspan="8">Loading pending approvals...</td></tr>';

    try {
        const res = await fetch('/api/leave-applications/pending', {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        const pending = await res.json();

        body.innerHTML = '';
        if (Array.isArray(pending) && pending.length > 0) {
            pending.forEach(p => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>#${p.application_id}</td>
                    <td><strong>${p.employee_name}</strong><br><small>${p.employee_number}</small></td>
                    <td>${p.department_name || '-'}</td>
                    <td>${p.leave_type_name}</td>
                    <td>${p.start_date} to ${p.end_date}</td>
                    <td><strong>${p.number_of_days} Day(s)</strong></td>
                    <td>${p.reason}</td>
                    <td>
                        <button class="btn btn-primary btn-sm" onclick="openApprovalModal(${p.application_id}, '${p.employee_name}', '${p.leave_type_name}', ${p.number_of_days})">Review</button>
                    </td>
                `;
                body.appendChild(tr);
            });
        } else {
            body.innerHTML = '<tr><td colspan="8" style="text-align:center; color: var(--text-muted)">No pending applications for review.</td></tr>';
        }
    } catch (e) {
        console.error(e);
    }
}

function openApprovalModal(id, empName, leaveType, days) {
    document.getElementById('modalAppId').value = id;
    document.getElementById('modalAppDetails').innerHTML = `
        Reviewing application <strong>#${id}</strong> from <strong>${empName}</strong> for <strong>${days} Day(s)</strong> of <strong>${leaveType}</strong>.
    `;
    document.getElementById('modalComments').value = '';
    document.getElementById('approvalModal').style.display = 'flex';
}

function closeApprovalModal() {
    document.getElementById('approvalModal').style.display = 'none';
}

async function submitApproval(status) {
    const id = document.getElementById('modalAppId').value;
    const comments = document.getElementById('modalComments').value;

    try {
        const res = await fetch(`/api/leave-applications/${id}/approval`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({ approval_status: status, comments })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message);

        alert(data.message);
        closeApprovalModal();
        loadPendingApprovals();
    } catch (err) {
        alert(err.message);
    }
}

// ---------------- EMPLOYEES ----------------
async function loadEmployees() {
    const body = document.getElementById('employeesTableBody');
    body.innerHTML = '<tr><td colspan="7">Loading employees...</td></tr>';

    try {
        const res = await fetch('/api/employees', {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        const employees = await res.json();

        body.innerHTML = '';
        employees.forEach(emp => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${emp.employee_number}</strong></td>
                <td>${emp.name}</td>
                <td>${emp.nic}</td>
                <td>${emp.department_name || '-'}</td>
                <td>${emp.designation}</td>
                <td>${emp.supervisor_name || 'N/A'}</td>
                <td><span class="badge badge-approved">${emp.status}</span></td>
            `;
            body.appendChild(tr);
        });
    } catch (e) {
        console.error(e);
    }
}

async function toggleEmployeeModal(show) {
    const modal = document.getElementById('employeeModal');
    modal.style.display = show ? 'flex' : 'none';

    if (show) {
        // Load Departments and Supervisors
        const deptsRes = await fetch('/api/departments', { headers: { 'Authorization': `Bearer ${currentToken}` } });
        const depts = await deptsRes.json();
        const deptSelect = document.getElementById('newEmpDept');
        deptSelect.innerHTML = '<option value="">Select Department</option>';
        depts.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.department_id;
            opt.textContent = d.department_name;
            deptSelect.appendChild(opt);
        });

        const empRes = await fetch('/api/employees', { headers: { 'Authorization': `Bearer ${currentToken}` } });
        const emps = await empRes.json();
        const supSelect = document.getElementById('newEmpSupervisor');
        supSelect.innerHTML = '<option value="">None (No Supervisor)</option>';
        emps.forEach(e => {
            const opt = document.createElement('option');
            opt.value = e.employee_id;
            opt.textContent = `${e.name} (${e.designation})`;
            supSelect.appendChild(opt);
        });
    }
}

async function handleAddEmployee(e) {
    e.preventDefault();
    const payload = {
        employee_number: document.getElementById('newEmpNo').value,
        name: document.getElementById('newEmpName').value,
        nic: document.getElementById('newEmpNic').value,
        email: document.getElementById('newEmpEmail').value,
        department_id: document.getElementById('newEmpDept').value,
        designation: document.getElementById('newEmpDesignation').value,
        supervisor_id: document.getElementById('newEmpSupervisor').value || null,
        date_of_appointment: document.getElementById('newEmpAppDate').value,
        username: document.getElementById('newEmpUsername').value || null,
        password: document.getElementById('newEmpPassword').value || null,
        role: document.getElementById('newEmpRole').value
    };

    try {
        const res = await fetch('/api/employees', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message);

        alert('Employee Registered Successfully');
        toggleEmployeeModal(false);
        document.getElementById('addEmployeeForm').reset();
        loadEmployees();
    } catch (err) {
        alert(err.message);
    }
}

// ---------------- LEAVE TYPES ----------------
async function loadLeaveTypes() {
    const body = document.getElementById('leaveTypesTableBody');
    body.innerHTML = '<tr><td colspan="6">Loading leave types...</td></tr>';

    try {
        const res = await fetch('/api/leave-types', {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        const types = await res.json();

        body.innerHTML = '';
        types.forEach(t => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${t.leave_type_id}</td>
                <td><strong>${t.leave_type_name}</strong></td>
                <td>${t.maximum_days} Days</td>
                <td>${t.gender_restriction}</td>
                <td>${t.requires_document ? 'Yes' : 'No'}</td>
                <td>${t.description}</td>
            `;
            body.appendChild(tr);
        });
    } catch (e) {
        console.error(e);
    }
}

// ---------------- USERS ----------------
async function loadUsers() {
    const body = document.getElementById('usersTableBody');
    body.innerHTML = '<tr><td colspan="5">Loading users...</td></tr>';

    try {
        const res = await fetch('/api/users', {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        const users = await res.json();

        body.innerHTML = '';
        users.forEach(u => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>#${u.user_id}</td>
                <td><strong>${u.username}</strong></td>
                <td><span class="user-role-chip">${u.role}</span></td>
                <td>${u.employee_name || 'System Account'}</td>
                <td>${new Date(u.created_at).toLocaleDateString()}</td>
            `;
            body.appendChild(tr);
        });
    } catch (e) {
        console.error(e);
    }
}

// ---------------- REPORTS ----------------
async function loadReportsInit() {
    const select = document.getElementById('reportDept');
    select.innerHTML = '<option value="">All Departments</option>';

    const reportYearInput = document.getElementById('reportYear');
    if (reportYearInput && !reportYearInput.value) {
        reportYearInput.value = new Date().getFullYear();
    }

    try {
        const res = await fetch('/api/departments', { headers: { 'Authorization': `Bearer ${currentToken}` } });
        const depts = await res.json();
        depts.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.department_id;
            opt.textContent = d.department_name;
            select.appendChild(opt);
        });
    } catch (e) {
        console.error(e);
    }
}

async function handleGenerateReport() {
    const type = document.getElementById('reportType').value;
    const dept = document.getElementById('reportDept').value;
    const year = document.getElementById('reportYear').value;

    const head = document.getElementById('reportTableHead');
    const body = document.getElementById('reportTableBody');

    head.innerHTML = '';
    body.innerHTML = '<tr><td colspan="6">Generating report...</td></tr>';

    try {
        if (type === 'applications') {
            const url = `/api/reports/leave-summary?year=${year}${dept ? '&department_id=' + dept : ''}`;
            const res = await fetch(url, { headers: { 'Authorization': `Bearer ${currentToken}` } });
            const data = await res.json();

            head.innerHTML = `
                <tr>
                    <th>Emp ID</th>
                    <th>Name</th>
                    <th>Department</th>
                    <th>Leave Type</th>
                    <th>Dates</th>
                    <th>Days</th>
                    <th>Status</th>
                </tr>
            `;

            body.innerHTML = '';
            if (Array.isArray(data) && data.length > 0) {
                data.forEach(d => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${d.employee_number}</td>
                        <td>${d.employee_name}</td>
                        <td>${d.department_name}</td>
                        <td>${d.leave_type_name}</td>
                        <td>${d.start_date} to ${d.end_date}</td>
                        <td>${d.number_of_days}</td>
                        <td><strong>${d.status}</strong></td>
                    `;
                    body.appendChild(tr);
                });
            } else {
                body.innerHTML = '<tr><td colspan="7" style="text-align:center;">No records found.</td></tr>';
            }
        } else {
            const url = `/api/reports/leave-balances?year=${year}${dept ? '&department_id=' + dept : ''}`;
            const res = await fetch(url, { headers: { 'Authorization': `Bearer ${currentToken}` } });
            const data = await res.json();

            head.innerHTML = `
                <tr>
                    <th>Emp ID</th>
                    <th>Name</th>
                    <th>Department</th>
                    <th>Leave Type</th>
                    <th>Allocated</th>
                    <th>Used</th>
                    <th>Remaining</th>
                </tr>
            `;

            body.innerHTML = '';
            if (Array.isArray(data) && data.length > 0) {
                data.forEach(d => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${d.employee_number}</td>
                        <td>${d.employee_name}</td>
                        <td>${d.department_name}</td>
                        <td>${d.leave_type_name}</td>
                        <td>${d.allocated_days}</td>
                        <td>${d.used_days}</td>
                        <td><strong>${d.remaining_days}</strong></td>
                    `;
                    body.appendChild(tr);
                });
            } else {
                body.innerHTML = '<tr><td colspan="7" style="text-align:center;">No records found.</td></tr>';
            }
        }
    } catch (e) {
        console.error(e);
    }
}

// ---------------- AUDIT LOGS ----------------
async function loadAuditLogs() {
    const body = document.getElementById('auditLogsBody');
    body.innerHTML = '<tr><td colspan="6">Loading audit logs...</td></tr>';

    try {
        const res = await fetch('/api/audit-logs', {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        const logs = await res.json();

        body.innerHTML = '';
        logs.forEach(l => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>#${l.log_id}</td>
                <td>${new Date(l.timestamp).toLocaleString()}</td>
                <td><strong>${l.username || 'System'}</strong></td>
                <td><span class="user-role-chip">${l.action}</span></td>
                <td>${l.details}</td>
                <td>${l.ip_address || '-'}</td>
            `;
            body.appendChild(tr);
        });
    } catch (e) {
        console.error(e);
    }
}
