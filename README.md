# Government Employee Leave Management System (GELMS)

GELMS is a centralized web-based Leave Management System designed specifically for government institutions in Sri Lanka. It automates leave applications, supervisor review/approvals, leave balance tracking, and administrative reporting across mobile devices and desktop computers.

## System Features

### 👥 Role-Based Access Control
- **Employee**: Apply for leave online, check remaining balances, view application status/history, receive low balance notifications, and cancel pending applications. Mobile-first responsive UI.
- **Supervisor / Approving Officer**: Review pending team leave applications, approve or reject applications with comments, and monitor employee leave records.
- **HR / Administrative Officer**: Manage employee profiles, configure government leave types & entitlements, manage departments, and generate department/monthly/annual leave reports.
- **System Administrator**: Manage user accounts and system roles, view full system audit trails (`audit_logs`).

### ⚖️ Configurable Sri Lankan Government Leave Types
Pre-configured with standard Sri Lankan government leave defaults:
- **Annual Leave** (21 days)
- **Casual Leave** (21 days)
- **Medical Leave** (24 days)
- **Maternity Leave** (84 days)
- **No-Pay Leave** (365 days)
- **Special Leave** (14 days)
- **Duty Leave** (30 days)

### 📅 Leave Balance Calculation
Automatic balance tracking adhering to the standard formula:
```text
Remaining Leave = Allocated Leave - Used Leave
```

### 🔐 Security & Audit Trail
- Passwords hashed using `bcryptjs`.
- Stateless JWT authentication for REST APIs.
- Full audit log recording action details, user, timestamp, and IP address.
- Sri Lankan NIC validation (Old 9-digit + V/X, and New 12-digit formats).

---

## Prerequisites

- [Node.js](https://nodejs.org/) (v16 or higher)
- npm

---

## Quick Start

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Start Server**:
   ```bash
   node server.js
   ```

3. **Access Application**:
   Open browser at [http://localhost:3000](http://localhost:3000)

---

## Demo Credentials

| Role | Username | Password |
| --- | --- | --- |
| **Employee** | `employee` | `Employee@123` |
| **Supervisor** | `supervisor` | `Supervisor@123` |
| **HR Officer** | `hrofficer` | `Hr@123456` |
| **System Admin** | `admin` | `Admin@123` |

---

## Running Automated Tests

Execute the full automated integration and workflow test suite:
```bash
node tests/gelms.test.js
```
