import { Router } from 'express';
import { get, run, all, ts, id, audit } from '../db.js';
import { hydrate, hydratelist } from '../lib/helpers.js';
import { requireAuth, requirePerm, can, hashPw } from '../auth.js';
import { paginate, csv } from '../lib/helpers.js';

const router = Router();
router.use(requireAuth);

router.get('/employees', (req, res) => {
  if (!can(req.user, 'employee.view') && !can(req.user, 'employee.create')) return res.status(403).json({ error: 'Forbidden' });
  const rows = hydratelist(
    all('SELECT * FROM employees WHERE company_id=? ORDER BY created_at DESC', req.user.company_id),
    ['documents', 'bank']
  );
  res.json(rows);
});

router.get('/employees/:id', (req, res) => {
  const e = hydrate(get('SELECT * FROM employees WHERE id=? AND company_id=?', req.params.id, req.user.company_id), ['documents', 'bank']);
  if (!e) return res.status(404).json({ error: 'Not found' });
  const attendance = all('SELECT * FROM attendance WHERE employee_id=? ORDER BY date DESC LIMIT 90', e.id);
  const leaves = all('SELECT * FROM leaves WHERE employee_id=? ORDER BY from_date DESC', e.id);
  res.json({ employee: e, attendance, leaves });
});

router.post('/employees', (req, res) => {
  if (!can(req.user, 'employee.create')) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Name required' });
  const eid = id();
  run(`INSERT INTO employees (id, company_id, user_id, name, email, phone, department, designation, doj, salary, pan, bank, status, documents, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    eid, req.user.company_id, b.user_id || null, b.name, b.email || null, b.phone || null, b.department || 'Sales',
    b.designation || null, b.doj || null, b.salary || 0, b.pan || null, JSON.stringify(b.bank || {}),
    b.status || 'active', JSON.stringify(b.documents || []), ts());
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'employee.create', entity: 'employee', entity_id: eid, detail: { name: b.name } });
  res.json({ ok: true, id: eid });
});

router.patch('/employees/:id', (req, res) => {
  if (!can(req.user, 'employee.edit')) return res.status(403).json({ error: 'Forbidden' });
  const e = get('SELECT * FROM employees WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!e) return res.status(404).json({ error: 'Not found' });
  const fields = ['name', 'email', 'phone', 'department', 'designation', 'doj', 'salary', 'pan', 'status'];
  for (const f of fields) if (req.body[f] !== undefined) run(`UPDATE employees SET ${f}=? WHERE id=?`, req.body[f], e.id);
  if (req.body.bank !== undefined) run('UPDATE employees SET bank=? WHERE id=?', JSON.stringify(req.body.bank), e.id);
  if (req.body.documents !== undefined) run('UPDATE employees SET documents=? WHERE id=?', JSON.stringify(req.body.documents), e.id);
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'employee.update', entity: 'employee', entity_id: e.id, detail: Object.keys(req.body || {}) });
  res.json({ ok: true });
});

// Attendance
router.get('/attendance', (req, res) => {
  if (!can(req.user, 'employee.attendance') && !can(req.user, 'employee.view')) return res.status(403).json({ error: 'Forbidden' });
  const rows = all(
    `SELECT a.*, e.name AS employee_name FROM attendance a LEFT JOIN employees e ON e.id=a.employee_id
     WHERE a.company_id=? ORDER BY a.date DESC LIMIT 300`, req.user.company_id);
  res.json(rows);
});
router.post('/attendance', (req, res) => {
  if (!can(req.user, 'employee.attendance')) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  if (!b.employee_id || !b.date) return res.status(400).json({ error: 'employee_id and date required' });
  const exists = get('SELECT id FROM attendance WHERE employee_id=? AND date=?', b.employee_id, b.date);
  if (exists) return res.status(400).json({ error: 'Attendance already recorded for date' });
  run(`INSERT INTO attendance (id, company_id, employee_id, date, status, checkin, checkout, latitude, longitude, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    id(), req.user.company_id, b.employee_id, b.date, b.status || 'present', b.checkin || null, b.checkout || null,
    b.latitude || null, b.longitude || null, ts());
  res.json({ ok: true });
});

// Leave
router.get('/leaves', (req, res) => {
  if (!can(req.user, 'hr.leave') && !can(req.user, 'employee.view')) return res.status(403).json({ error: 'Forbidden' });
  const rows = all(
    `SELECT l.*, e.name AS employee_name FROM leaves l LEFT JOIN employees e ON e.id=l.employee_id
     WHERE l.company_id=? ORDER BY l.from_date DESC`, req.user.company_id);
  res.json(rows);
});
router.post('/leaves', (req, res) => {
  if (!can(req.user, 'hr.leave') && !can(req.user, 'employee.create')) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  if (!b.employee_id || !b.from_date) return res.status(400).json({ error: 'employee_id and from_date required' });
  run(`INSERT INTO leaves (id, company_id, employee_id, from_date, to_date, type, status, reason, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    id(), req.user.company_id, b.employee_id, b.from_date, b.to_date || b.from_date, b.type || 'casual',
    b.status || 'pending', b.reason || null, ts());
  res.json({ ok: true });
});
router.patch('/leaves/:id', (req, res) => {
  if (!can(req.user, 'hr.leave')) return res.status(403).json({ error: 'Forbidden' });
  run(`UPDATE leaves SET status=? WHERE id=? AND company_id=?`, req.body?.status || 'approved', req.params.id, req.user.company_id);
  res.json({ ok: true });
});

// Payroll overview (salary + deductions)
router.get('/payroll', (req, res) => {
  if (!can(req.user, 'hr.payroll') && !can(req.user, 'employee.salary')) return res.status(403).json({ error: 'Forbidden' });
  const rows = all('SELECT * FROM employees WHERE company_id=? AND status=?', req.user.company_id, 'active');
  const summary = rows.reduce((a, e) => {
    a.totalSalary += e.salary || 0;
    a.pf += (e.salary || 0) * 0.12;
    a.esi += (e.salary || 0) * 0.0075;
    a.tds += (e.salary || 0) * 0.05;
    return a;
  }, { totalSalary: 0, pf: 0, esi: 0, tds: 0 });
  res.json({ employees: rows.length, summary, month: new Date().toISOString().slice(0, 7) });
});

router.get('/export/csv', (req, res) => {
  if (!can(req.user, 'employee.view') || !can(req.user, 'employee.export')) return res.status(403).json({ error: 'Forbidden' });
  const rows = all('SELECT * FROM employees WHERE company_id=?', req.user.company_id);
  const data = rows.map((e) => ({
    Name: e.name, Email: e.email, Phone: e.phone, Department: e.department, Designation: e.designation,
    DOJ: e.doj, Salary: e.salary, Status: e.status
  }));
  const cols = Object.keys(data[0] || {}).map((k) => ({ label: k, accessor: (r) => r[k] }));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="employees.csv"');
  res.send(csv(data, cols));
});

export default router;
