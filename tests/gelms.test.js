const app = require('../server');
const assert = require('assert');

async function runTests() {
    console.log('--- Starting GELMS Automated Integration & Workflow Test Suite ---');

    const server = app.listen(3099, async () => {
        try {
            const baseUrl = 'http://localhost:3099';

            // 1. Employee Login
            console.log('Test 1: Employee Authentication...');
            const empLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: 'employee', password: 'Employee@123' })
            });
            assert.strictEqual(empLoginRes.status, 200, 'Employee login failed');
            const empData = await empLoginRes.json();
            const empToken = empData.token;
            assert.ok(empToken, 'Token missing in response');
            console.log('✓ Employee Login Successful:', empData.user.employeeName);

            // 2. Fetch Initial Leave Balances
            console.log('Test 2: Fetching Employee Leave Balances...');
            const balRes = await fetch(`${baseUrl}/api/leave-balances/my?year=2025`, {
                headers: { 'Authorization': `Bearer ${empToken}` }
            });
            assert.strictEqual(balRes.status, 200);
            const balances = await balRes.json();
            const annualLeave = balances.find(b => b.leave_type_name === 'Annual Leave');
            assert.ok(annualLeave, 'Annual leave balance not found');
            const initialUsed = annualLeave.used_days;
            const initialRemaining = annualLeave.remaining_days;
            console.log(`✓ Initial Annual Leave Balances -> Used: ${initialUsed}, Remaining: ${initialRemaining} Days`);

            // 3. Submit Leave Application
            console.log('Test 3: Submitting Leave Application...');
            const applyRes = await fetch(`${baseUrl}/api/leave-applications`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${empToken}`
                },
                body: JSON.stringify({
                    leave_type_id: annualLeave.leave_type_id,
                    start_date: '2025-05-01',
                    end_date: '2025-05-03',
                    number_of_days: 3,
                    reason: 'Annual family holiday'
                })
            });
            assert.strictEqual(applyRes.status, 201);
            const applyData = await applyRes.json();
            const appId = applyData.application_id;
            assert.ok(appId, 'Application ID missing');
            console.log(`✓ Submitted Leave Application #${appId}`);

            // 4. Supervisor Login & Application Review
            console.log('Test 4: Supervisor Login & Pending Applications Inspection...');
            const supLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: 'supervisor', password: 'Supervisor@123' })
            });
            assert.strictEqual(supLoginRes.status, 200);
            const supData = await supLoginRes.json();
            const supToken = supData.token;

            const pendingRes = await fetch(`${baseUrl}/api/leave-applications/pending`, {
                headers: { 'Authorization': `Bearer ${supToken}` }
            });
            assert.strictEqual(pendingRes.status, 200);
            const pendingApps = await pendingRes.json();
            const targetApp = pendingApps.find(a => a.application_id === appId);
            assert.ok(targetApp, 'Pending application not found in supervisor list');
            console.log('✓ Pending Application verified in Supervisor Queue.');

            // 5. Supervisor Approves Application
            console.log('Test 5: Supervisor Approval Process...');
            const approveRes = await fetch(`${baseUrl}/api/leave-applications/${appId}/approval`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${supToken}`
                },
                body: JSON.stringify({
                    approval_status: 'Approved',
                    comments: 'Approved for annual leave'
                })
            });
            assert.strictEqual(approveRes.status, 200);
            console.log('✓ Application Approved by Supervisor.');

            // 6. Verify Updated Leave Balance Formula (Remaining = Allocated - Used)
            console.log('Test 6: Verifying Updated Leave Balance Formula...');
            const updatedBalRes = await fetch(`${baseUrl}/api/leave-balances/my?year=2025`, {
                headers: { 'Authorization': `Bearer ${empToken}` }
            });
            const updatedBalances = await updatedBalRes.json();
            const updatedAnnual = updatedBalances.find(b => b.leave_type_name === 'Annual Leave');
            assert.strictEqual(updatedAnnual.used_days, initialUsed + 3, 'Used days should increase by 3');
            assert.strictEqual(updatedAnnual.remaining_days, initialRemaining - 3, 'Remaining days should decrease by 3');
            console.log(`✓ Balance Updated Correctly: Used = ${updatedAnnual.used_days}, Remaining = ${updatedAnnual.remaining_days}`);

            // 7. Test Admin/HR Reports & Audit Log
            console.log('Test 7: Admin/HR Reports and Audit Log Verification...');
            const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: 'admin', password: 'Admin@123' })
            });
            const adminToken = (await adminLoginRes.json()).token;

            const reportRes = await fetch(`${baseUrl}/api/reports/leave-summary?year=2025`, {
                headers: { 'Authorization': `Bearer ${adminToken}` }
            });
            assert.strictEqual(reportRes.status, 200);
            const reportData = await reportRes.json();
            assert.ok(reportData.length > 0, 'Report data empty');
            console.log(`✓ Summary Report Generated (${reportData.length} entries).`);

            const auditRes = await fetch(`${baseUrl}/api/audit-logs`, {
                headers: { 'Authorization': `Bearer ${adminToken}` }
            });
            assert.strictEqual(auditRes.status, 200);
            const auditData = await auditRes.json();
            assert.ok(auditData.length > 0, 'Audit log empty');
            console.log(`✓ Audit Log Verified (${auditData.length} audit entries recorded).`);

            console.log('\n✅ ALL INTEGRATION TESTS PASSED SUCCESSFULLY!');
        } catch (err) {
            console.error('\n❌ TEST SUITE FAILED:', err);
            process.exitCode = 1;
        } finally {
            server.close();
            process.exit(process.exitCode || 0);
        }
    });
}

runTests();
