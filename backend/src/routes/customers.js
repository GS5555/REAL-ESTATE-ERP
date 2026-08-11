import { Router } from 'express';
import { get, run, all, ts, id, audit } from '../db.js';
import { hydrate, hydratelist } from '../lib/helpers.js';
import { requireAuth, requirePerm, can } from '../auth.js';
import { paginate, csv } from '../lib/helpers.js';
import { estimateLtv } from '../lib/insights.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  if (!can(req.user, 'customer.view')) return res.status(403).json({ error: 'Forbidden' });
  const { page, limit, offset } = paginate(req);
  const where = ['company_id=?'];
  const args = [req.user.company_id];
  if (req.query.q) { where.push('(name LIKE ? OR phone LIKE ? OR email LIKE ?)'); args.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`); }
  if (req.query.kyc) { where.push('kyc_status=?'); args.push(req.query.kyc); }
  const total = get(`SELECT COUNT(*) n FROM customers WHERE ${where.join(' AND ')}`, ...args).n;
  const rows = hydratelist(
    all(`SELECT * FROM customers WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`, ...args, limit, offset),
    ['kyc_docs']
  );
  const enriched = rows.map((c) => ({ ...c, ltv: estimateLtv(c.id) }));
  res.json({ items: enriched, total, page, limit });
});

router.get('/:id', (req, res) => {
  const c = hydrate(get('SELECT * FROM customers WHERE id=? AND company_id=?', req.params.id, req.user.company_id), ['kyc_docs']);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const bookings = hydratelist(all('SELECT * FROM bookings WHERE customer_id=?', c.id), ['payment_plan']);
  const payments = all('SELECT * FROM payments WHERE customer_id=? ORDER BY date DESC', c.id);
  const invoices = all('SELECT * FROM invoices WHERE customer_id=? ORDER BY date DESC', c.id);
  const documents = hydratelist(all('SELECT * FROM documents WHERE entity_type=? AND entity_id=?', 'customer', c.id));
  res.json({ customer: c, bookings, payments, invoices, documents, ltv: estimateLtv(c.id) });
});

router.post('/', (req, res) => {
  if (!can(req.user, 'customer.create')) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Name required' });
  const cid = id();
  run(`INSERT INTO customers (id, company_id, lead_id, name, phone, email, address, pan, aadhaar, kyc_status, kyc_docs, loyalty_points, referred_by, qr_code, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)`,
    cid, req.user.company_id, b.lead_id || null, b.name, b.phone || null, b.email || null, b.address || null,
    b.pan || null, b.aadhaar || null, b.kyc_status || 'pending', JSON.stringify(b.kyc_docs || []),
    b.referred_by || null, Buffer.from(cid).toString('base64url'), ts());
  if (b.state !== undefined) run('UPDATE customers SET state=? WHERE id=?', b.state || null, cid);
  if (b.state_code !== undefined) run('UPDATE customers SET state_code=? WHERE id=?', b.state_code || null, cid);
  if (b.gstin !== undefined) run('UPDATE customers SET gstin=? WHERE id=?', b.gstin || null, cid);
  if (b.lead_id) {
    const lead = get('SELECT * FROM leads WHERE id=?', b.lead_id);
    if (lead) run('UPDATE leads SET status=? WHERE id=? AND status IN (\'new_lead\',\'qualified\',\'interested\')', 'negotiation', b.lead_id);
  }
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'customer.create', entity: 'customer', entity_id: cid, detail: { name: b.name } });
  res.json({ ok: true, id: cid });
});

router.patch('/:id', (req, res) => {
  if (!can(req.user, 'customer.edit')) return res.status(403).json({ error: 'Forbidden' });
  const c = get('SELECT * FROM customers WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const fields = ['name', 'phone', 'email', 'address', 'pan', 'aadhaar', 'loyalty_points', 'referred_by', 'state', 'state_code', 'gstin'];
  for (const f of fields) if (req.body[f] !== undefined) run(`UPDATE customers SET ${f}=? WHERE id=?`, req.body[f], c.id);
  if (req.body.kyc_docs !== undefined) run('UPDATE customers SET kyc_docs=? WHERE id=?', JSON.stringify(req.body.kyc_docs), c.id);
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'customer.update', entity: 'customer', entity_id: c.id, detail: Object.keys(req.body || {}) });
  res.json({ ok: true });
});

router.post('/:id/kyc', (req, res) => {
  if (!can(req.user, 'customer.kyc')) return res.status(403).json({ error: 'Forbidden' });
  const c = get('SELECT * FROM customers WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const { status } = req.body || {};
  run('UPDATE customers SET kyc_status=? WHERE id=?', status || 'verified', c.id);
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'customer.kyc', entity: 'customer', entity_id: c.id, detail: { status } });
  res.json({ ok: true });
});

router.get('/export/csv', (req, res) => {
  if (!can(req.user, 'customer.export')) return res.status(403).json({ error: 'Forbidden' });
  const rows = all('SELECT * FROM customers WHERE company_id=?', req.user.company_id);
  const data = rows.map((c) => ({
    Name: c.name, Phone: c.phone, Email: c.email, KYC: c.kyc_status, PAN: c.pan,
    Loyalty: c.loyalty_points, Created: c.created_at
  }));
  const cols = Object.keys(data[0] || {}).map((k) => ({ label: k, accessor: (r) => r[k] }));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="customers.csv"');
  res.send(csv(data, cols));
});

export default router;
