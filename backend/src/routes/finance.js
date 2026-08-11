import { Router } from 'express';
import { get, run, all, ts, id, audit } from '../db.js';
import { hydrate, hydratelist } from '../lib/helpers.js';
import { requireAuth, requirePerm, can } from '../auth.js';
import { paginate, csv } from '../lib/helpers.js';

const router = Router();
router.use(requireAuth);

// ================= BOOKINGS =================
router.get('/bookings', (req, res) => {
  if (!can(req.user, 'finance.view') && !can(req.user, 'inventory.view')) return res.status(403).json({ error: 'Forbidden' });
  const rows = hydratelist(
    all(`SELECT b.*, c.name AS customer_name, u.number AS unit_number, u.price AS unit_price, p.name AS project_name
         FROM bookings b LEFT JOIN customers c ON c.id=b.customer_id
         LEFT JOIN units u ON u.id=b.unit_id LEFT JOIN projects p ON p.id=u.project_id
         WHERE b.company_id=? ORDER BY b.created_at DESC`, req.user.company_id),
    ['payment_plan']
  );
  res.json(rows);
});

router.post('/bookings', (req, res) => {
  if (!can(req.user, 'finance.create') && !can(req.user, 'lead.create')) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  if (!b.customer_id || !b.unit_id) return res.status(400).json({ error: 'customer_id and unit_id required' });
  const unit = get('SELECT * FROM units WHERE id=? AND company_id=?', b.unit_id, req.user.company_id);
  if (!unit) return res.status(404).json({ error: 'Unit not found' });
  if (unit.availability === 'Sold' || unit.availability === 'Booked') return res.status(400).json({ error: 'Unit not available' });

  const bid = id();
  const total = b.total_value || unit.price || 0;
  run(`INSERT INTO bookings (id, company_id, customer_id, unit_id, lead_id, token_amount, total_value, agreement_date, possession_date, status, rera_ref, payment_plan, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    bid, req.user.company_id, b.customer_id, b.unit_id, b.lead_id || null, b.token_amount || 0, total,
    b.agreement_date || null, b.possession_date || null, b.status || 'token_received',
    b.rera_ref || null, JSON.stringify(b.payment_plan || {}), ts());

  run(`UPDATE units SET availability='Booked', booking_status='Booked', customer_id=? WHERE id=?`, b.customer_id, b.unit_id);

  const customer = get('SELECT * FROM customers WHERE id=?', b.customer_id);
  if (customer) {
    run('UPDATE customers SET loyalty_points=loyalty_points+100 WHERE id=?', b.customer_id);
    // channel partner commission if referred
    if (customer.referred_by) {
      const partner = get('SELECT * FROM partners WHERE company_id=? AND (phone=? OR email=?)', req.user.company_id, customer.phone, customer.email)
        || all('SELECT * FROM partners WHERE company_id=?', req.user.company_id)[0];
      if (partner) {
        const pct = partner.commission_pct || 1;
        run(`INSERT INTO commissions (id, company_id, partner_id, booking_id, amount, pct, status, created_at)
             VALUES (?,?,?,?,?,?,?,?)`, id(), req.user.company_id, partner.id, bid, (total * pct) / 100, pct, 'pending', ts());
      }
    }
  }

  if (b.lead_id) run('UPDATE leads SET status=? WHERE id=?', 'booking', b.lead_id);
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'booking.create', entity: 'booking', entity_id: bid, detail: { customer: b.customer_id, unit: b.unit_id, total } });
  res.json({ ok: true, id: bid, total });
});

router.patch('/bookings/:id', (req, res) => {
  if (!can(req.user, 'finance.edit')) return res.status(403).json({ error: 'Forbidden' });
  const bk = get('SELECT * FROM bookings WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!bk) return res.status(404).json({ error: 'Not found' });
  const fields = ['token_amount', 'total_value', 'agreement_date', 'possession_date', 'status', 'rera_ref'];
  for (const f of fields) if (req.body[f] !== undefined) run(`UPDATE bookings SET ${f}=? WHERE id=?`, req.body[f], bk.id);
  if (req.body.payment_plan !== undefined) run('UPDATE bookings SET payment_plan=? WHERE id=?', JSON.stringify(req.body.payment_plan), bk.id);
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'booking.update', entity: 'booking', entity_id: bk.id, detail: Object.keys(req.body || {}) });
  res.json({ ok: true });
});

// ================= PAYMENTS =================
router.get('/payments', (req, res) => {
  if (!can(req.user, 'finance.view')) return res.status(403).json({ error: 'Forbidden' });
  const rows = all(
    `SELECT p.*, c.name AS customer_name FROM payments p LEFT JOIN customers c ON c.id=p.customer_id
     WHERE p.company_id=? ORDER BY p.date DESC LIMIT 500`, req.user.company_id);
  res.json(rows);
});

router.post('/payments', (req, res) => {
  if (!can(req.user, 'finance.create')) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  if (!b.amount) return res.status(400).json({ error: 'amount required' });
  const pid = id();
  const receipt = `RC-${Date.now().toString().slice(-6)}`;
  run(`INSERT INTO payments (id, company_id, customer_id, booking_id, invoice_id, amount, type, mode, status, reference, receipt_no, date, notes, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    pid, req.user.company_id, b.customer_id || null, b.booking_id || null, b.invoice_id || null, b.amount,
    b.type || 'booking', b.mode || 'cash', b.status || 'received', b.reference || null, receipt,
    b.date || ts().slice(0, 10), b.notes || null, ts());
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'payment.create', entity: 'payment', entity_id: pid, detail: { amount: b.amount, mode: b.mode } });
  res.json({ ok: true, id: pid, receipt_no: receipt });
});

// ================= INVOICES =================
router.get('/invoices', (req, res) => {
  if (!can(req.user, 'finance.view')) return res.status(403).json({ error: 'Forbidden' });
  const rows = all(
    `SELECT i.*, c.name AS customer_name FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id
     WHERE i.company_id=? ORDER BY i.date DESC LIMIT 500`, req.user.company_id);
  res.json(rows);
});

router.post('/invoices', (req, res) => {
  if (!can(req.user, 'finance.invoice')) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  if (!b.amount || !b.customer_id) return res.status(400).json({ error: 'amount and customer_id required' });
  const num = `INV-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
  const iid = id();
  run(`INSERT INTO invoices (id, company_id, customer_id, booking_id, number, amount, gst, status, date, due_date, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    iid, req.user.company_id, b.customer_id, b.booking_id || null, num, b.amount, b.gst || 0,
    b.status || 'sent', b.date || ts().slice(0, 10), b.due_date || null, ts());
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'invoice.create', entity: 'invoice', entity_id: iid, detail: { number: num } });
  res.json({ ok: true, id: iid, number: num });
});

router.patch('/invoices/:id', (req, res) => {
  if (!can(req.user, 'finance.edit')) return res.status(403).json({ error: 'Forbidden' });
  const f = ['status', 'due_date'];
  for (const ff of f) if (req.body[ff] !== undefined) run(`UPDATE invoices SET ${ff}=? WHERE id=? AND company_id=?`, req.body[ff], req.params.id, req.user.company_id);
  res.json({ ok: true });
});

// ================= EXPENSES =================
router.get('/expenses', (req, res) => {
  if (!can(req.user, 'finance.view')) return res.status(403).json({ error: 'Forbidden' });
  res.json(all('SELECT * FROM expenses WHERE company_id=? ORDER BY date DESC LIMIT 300', req.user.company_id));
});
router.post('/expenses', (req, res) => {
  if (!can(req.user, 'finance.create')) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  if (!b.amount) return res.status(400).json({ error: 'amount required' });
  run(`INSERT INTO expenses (id, company_id, employee_id, amount, category, date, status, notes, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    id(), req.user.company_id, b.employee_id || req.user.id, b.amount, b.category || 'Misc', b.date || ts().slice(0, 10),
    'pending', b.notes || null, ts());
  res.json({ ok: true });
});
router.patch('/expenses/:id', (req, res) => {
  if (!can(req.user, 'finance.approve')) return res.status(403).json({ error: 'Forbidden' });
  run(`UPDATE expenses SET status=? WHERE id=? AND company_id=?`, req.body?.status || 'approved', req.params.id, req.user.company_id);
  res.json({ ok: true });
});

// ================= PARTNERS & COMMISSIONS =================
router.get('/partners', (req, res) => {
  if (!can(req.user, 'partner.view')) return res.status(403).json({ error: 'Forbidden' });
  const rows = all(
    `SELECT p.*, (SELECT COUNT(*) FROM commissions c WHERE c.partner_id=p.id AND c.status='pending') pending_comm,
     (SELECT COALESCE(SUM(amount),0) FROM commissions c WHERE c.partner_id=p.id) total_comm
     FROM partners p WHERE p.company_id=? ORDER BY p.created_at DESC`, req.user.company_id);
  res.json(rows);
});
router.post('/partners', (req, res) => {
  if (!can(req.user, 'partner.create')) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Name required' });
  const pid = id();
  run(`INSERT INTO partners (id, company_id, user_id, name, phone, email, company, commission_pct, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    pid, req.user.company_id, b.user_id || null, b.name, b.phone || null, b.email || null, b.company || null,
    b.commission_pct || 1, 'active', ts());
  res.json({ ok: true, id: pid });
});

router.get('/commissions', (req, res) => {
  if (!can(req.user, 'commission.view')) return res.status(403).json({ error: 'Forbidden' });
  const rows = all(
    `SELECT c.*, p.name AS partner_name FROM commissions c LEFT JOIN partners p ON p.id=c.partner_id
     WHERE c.company_id=? ORDER BY c.created_at DESC`, req.user.company_id);
  res.json(rows);
});
router.patch('/commissions/:id', (req, res) => {
  if (!can(req.user, 'commission.edit')) return res.status(403).json({ error: 'Forbidden' });
  const { status } = req.body || {};
  run(`UPDATE commissions SET status=?, paid_at=? WHERE id=? AND company_id=?`, status || 'paid', ts(), req.params.id, req.user.company_id);
  res.json({ ok: true });
});

// ================= FINANCE SUMMARY =================
router.get('/summary', (req, res) => {
  if (!can(req.user, 'finance.view')) return res.status(403).json({ error: 'Forbidden' });
  const cid = req.user.company_id;
  const payments = all('SELECT * FROM payments WHERE company_id=? AND status=?', cid, 'received');
  const outstanding = get(`SELECT COALESCE(SUM(amount),0) s FROM invoices WHERE company_id=? AND status IN ('sent','overdue')`, cid);
  const collected = payments.reduce((s, p) => s + p.amount, 0);
  const expenses = get(`SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE company_id=? AND status='approved'`, cid);
  const byMode = {};
  for (const p of payments) byMode[p.mode || 'other'] = (byMode[p.mode || 'other'] || 0) + p.amount;
  const monthly = {};
  for (const p of payments) {
    const k = (p.date || '').slice(0, 7);
    if (k) monthly[k] = (monthly[k] || 0) + p.amount;
  }
  const approved = all(`SELECT * FROM expenses WHERE company_id=? AND status='approved'`, cid);
  const monthlyExpenses = {};
  const expenseByCategory = {};
  for (const e of approved) {
    const k = (e.date || '').slice(0, 7);
    if (k) monthlyExpenses[k] = (monthlyExpenses[k] || 0) + e.amount;
    expenseByCategory[e.category || 'other'] = (expenseByCategory[e.category || 'other'] || 0) + e.amount;
  }
  res.json({
    collected, outstanding: outstanding.s, expenses: expenses.s, netCashflow: collected - expenses.s,
    byMode, monthly: Object.entries(monthly).sort().map(([m, v]) => ({ month: m, value: v })),
    monthlyExpenses: Object.entries(monthlyExpenses).sort().map(([m, v]) => ({ month: m, value: v })),
    expenseByCategory: Object.entries(expenseByCategory).map(([label, value]) => ({ label, value }))
  });
});

export default router;
