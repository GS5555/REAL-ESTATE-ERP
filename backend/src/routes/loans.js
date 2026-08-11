// V2 Home Loan Management Module — convert any property lead into a loan lead,
// track bank/DSA/commission, automated reminders, and loan dashboards.
import { Router } from 'express';
import { get, run, all, ts, id, audit, notify } from '../db.js';
import { hydratelist, csv } from '../lib/helpers.js';
import { requireAuth, can } from '../auth.js';
import { emitCompany } from '../realtime.js';

const router = Router();
router.use(requireAuth);

const LOAN_STATUSES = ['application', 'documents', 'processing', 'approved', 'sanctioned', 'disbursed', 'rejected'];
const LOAN_LABELS = {
  application: 'Application', documents: 'Documents', processing: 'Processing',
  approved: 'Approved', sanctioned: 'Sanctioned', disbursed: 'Disbursed', rejected: 'Rejected'
};
const ACTIVE_LOAN = ['application', 'documents', 'processing', 'approved', 'sanctioned'];

function loanOut(l) {
  const referrer = l.referrer_id ? get('SELECT name FROM users WHERE id=?', l.referrer_id) : null;
  return { ...l, statusLabel: LOAN_LABELS[l.status] || l.status, referrer_name: referrer?.name || null };
}

function sendReminders(companyId, loan) {
  let schedule = [];
  try { schedule = JSON.parse(loan.reminder_schedule || '[]'); } catch { /* ignore */ }
  if (!loan.payment_due_date || !schedule.length) return;
  const due = new Date(loan.payment_due_date);
  const now = Date.now();
  for (const s of schedule) {
    const leadMins = (parseInt(s.daysBefore, 10) || 1) * 86400000;
    if (now >= due.getTime() - leadMins && now < due.getTime() + 86400000) {
      const channels = Array.isArray(s.channels) && s.channels.length ? s.channels : ['inapp'];
      // notify the sales owner handling the loan (via the lead) + finance
      const owner = loan.lead_id ? get('SELECT owner_id FROM leads WHERE id=?', loan.lead_id) : null;
      const targets = [];
      if (owner?.owner_id) targets.push(owner.owner_id);
      for (const t of all('SELECT id FROM users WHERE company_id=? AND role IN (?,?)', companyId, 'finance_manager', 'company_admin')) targets.push(t.id);
      for (const target of [...new Set(targets)]) {
        for (const ch of channels) {
          notify(companyId, target, 'Home loan payment due',
            `Payment of ₹${loan.loan_amount || 0} due for ${loan.customer_name} on ${loan.payment_due_date?.slice(0, 10)} (${ch})`, 'loan', ch);
        }
      }
    }
  }
}

// ---- Loan master data: banks, DSAs (multi-bank rates), employee commission ----
function loanCompanyId(req) {
  if (req.user.company_id) return req.user.company_id;
  const first = get('SELECT id FROM companies ORDER BY created_at LIMIT 1');
  return first ? first.id : null;
}

router.get('/loans/master', (req, res) => {
  if (!can(req.user, 'loan.view')) return res.status(403).json({ error: 'Forbidden' });
  const cid = loanCompanyId(req);
  const showComm = can(req.user, 'commission.view');
  const banks = all('SELECT * FROM loan_banks WHERE company_id=? ORDER BY name', cid)
    .map((b) => (showComm ? b : { ...b, rate_offered: 0 }));
  const dsas = all('SELECT * FROM loan_dsas WHERE company_id=? ORDER BY name', cid).map((d) => ({
    ...d,
    banks: all('SELECT bank_id, rate_offered FROM loan_dsa_banks WHERE company_id=? AND dsa_id=?', cid, d.id)
      .map((r) => ({ ...r, bank_name: banks.find((b) => b.id === r.bank_id)?.name || 'Unknown', rate_offered: showComm ? r.rate_offered : 0 }))
  }));
  const employees = all('SELECT id, name, role, commission_rate FROM users WHERE company_id=? ORDER BY name', cid)
    .map((u) => ({ id: u.id, name: u.name, role: u.role, commission_rate: showComm ? (u.commission_rate || 0) : 0 }));
  res.json({ banks, dsas, employees, commission_restricted: !showComm });
});

// ---- Banks ----
router.post('/loans/master/banks', (req, res) => {
  if (!can(req.user, 'commission.edit') && !can(req.user, 'loan.edit')) return res.status(403).json({ error: 'Forbidden' });
  const { name, rate_offered, contact_person } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Bank name required' });
  const bid = id();
  run('INSERT INTO loan_banks (id, company_id, name, rate_offered, contact_person, created_at) VALUES (?,?,?,?,?,?)',
    bid, loanCompanyId(req), String(name).trim(), Number(rate_offered) || 0, contact_person || null, ts());
  audit({ company_id: loanCompanyId(req), user_id: req.user.id, user_name: req.user.name, action: 'loan.bank.create', entity: 'loan_bank', entity_id: bid, module: 'loans' });
  res.json({ ok: true, id: bid });
});

router.patch('/loans/master/banks/:id', (req, res) => {
  if (!can(req.user, 'commission.edit') && !can(req.user, 'loan.edit')) return res.status(403).json({ error: 'Forbidden' });
  const b = get('SELECT * FROM loan_banks WHERE id=? AND company_id=?', req.params.id, loanCompanyId(req));
  if (!b) return res.status(404).json({ error: 'Not found' });
  const { name, rate_offered, contact_person } = req.body || {};
  if (name !== undefined) run('UPDATE loan_banks SET name=? WHERE id=?', String(name).trim(), b.id);
  if (rate_offered !== undefined) run('UPDATE loan_banks SET rate_offered=? WHERE id=?', Number(rate_offered) || 0, b.id);
  if (contact_person !== undefined) run('UPDATE loan_banks SET contact_person=? WHERE id=?', contact_person, b.id);
  audit({ company_id: loanCompanyId(req), user_id: req.user.id, user_name: req.user.name, action: 'loan.bank.update', entity: 'loan_bank', entity_id: b.id, module: 'loans' });
  res.json({ ok: true });
});

router.delete('/loans/master/banks/:id', (req, res) => {
  if (!can(req.user, 'commission.edit') && !can(req.user, 'loan.edit')) return res.status(403).json({ error: 'Forbidden' });
  run('DELETE FROM loan_banks WHERE id=? AND company_id=?', req.params.id, loanCompanyId(req));
  run('DELETE FROM loan_dsa_banks WHERE bank_id=? AND company_id=?', req.params.id, loanCompanyId(req));
  audit({ company_id: loanCompanyId(req), user_id: req.user.id, user_name: req.user.name, action: 'loan.bank.delete', entity: 'loan_bank', entity_id: req.params.id, module: 'loans' });
  res.json({ ok: true });
});

// ---- DSAs (a DSA can offer multiple banks, each with its own rate) ----
router.post('/loans/master/dsas', (req, res) => {
  if (!can(req.user, 'commission.edit') && !can(req.user, 'loan.edit')) return res.status(403).json({ error: 'Forbidden' });
  const { name, contact_person, contact_phone, bank_rates } = req.body || {};
  if (!name) return res.status(400).json({ error: 'DSA name required' });
  const did = id();
  run('INSERT INTO loan_dsas (id, company_id, name, contact_person, contact_phone, created_at) VALUES (?,?,?,?,?,?)',
    did, loanCompanyId(req), String(name).trim(), contact_person || null, contact_phone || null, ts());
  for (const br of (bank_rates || [])) {
    if (br.bank_id && br.checked) {
      run('INSERT OR REPLACE INTO loan_dsa_banks (company_id, dsa_id, bank_id, rate_offered) VALUES (?,?,?,?)',
        loanCompanyId(req), did, br.bank_id, Number(br.rate_offered) || 0);
    }
  }
  audit({ company_id: loanCompanyId(req), user_id: req.user.id, user_name: req.user.name, action: 'loan.dsa.create', entity: 'loan_dsa', entity_id: did, module: 'loans' });
  res.json({ ok: true, id: did });
});

router.patch('/loans/master/dsas/:id', (req, res) => {
  if (!can(req.user, 'commission.edit') && !can(req.user, 'loan.edit')) return res.status(403).json({ error: 'Forbidden' });
  const d = get('SELECT * FROM loan_dsas WHERE id=? AND company_id=?', req.params.id, loanCompanyId(req));
  if (!d) return res.status(404).json({ error: 'Not found' });
  const { name, contact_person, contact_phone, bank_rates } = req.body || {};
  if (name !== undefined) run('UPDATE loan_dsas SET name=? WHERE id=?', String(name).trim(), d.id);
  if (contact_person !== undefined) run('UPDATE loan_dsas SET contact_person=? WHERE id=?', contact_person, d.id);
  if (contact_phone !== undefined) run('UPDATE loan_dsas SET contact_phone=? WHERE id=?', contact_phone, d.id);
  if (Array.isArray(bank_rates)) {
    run('DELETE FROM loan_dsa_banks WHERE dsa_id=? AND company_id=?', d.id, loanCompanyId(req));
    for (const br of bank_rates) {
      if (br.bank_id && br.checked) {
        run('INSERT OR REPLACE INTO loan_dsa_banks (company_id, dsa_id, bank_id, rate_offered) VALUES (?,?,?,?)',
          loanCompanyId(req), d.id, br.bank_id, Number(br.rate_offered) || 0);
      }
    }
  }
  audit({ company_id: loanCompanyId(req), user_id: req.user.id, user_name: req.user.name, action: 'loan.dsa.update', entity: 'loan_dsa', entity_id: d.id, module: 'loans' });
  res.json({ ok: true });
});

router.delete('/loans/master/dsas/:id', (req, res) => {
  if (!can(req.user, 'commission.edit') && !can(req.user, 'loan.edit')) return res.status(403).json({ error: 'Forbidden' });
  run('DELETE FROM loan_dsas WHERE id=? AND company_id=?', req.params.id, loanCompanyId(req));
  run('DELETE FROM loan_dsa_banks WHERE dsa_id=? AND company_id=?', req.params.id, loanCompanyId(req));
  audit({ company_id: loanCompanyId(req), user_id: req.user.id, user_name: req.user.name, action: 'loan.dsa.delete', entity: 'loan_dsa', entity_id: req.params.id, module: 'loans' });
  res.json({ ok: true });
});

// ---- Employee commission rates (admin-defined; hidden unless commission.view) ----
router.put('/loans/master/employee-commission', (req, res) => {
  if (!can(req.user, 'commission.edit')) return res.status(403).json({ error: 'Forbidden' });
  const rates = req.body?.rates;
  if (!Array.isArray(rates)) return res.status(400).json({ error: 'rates[] required' });
  for (const r of rates) {
    if (r.user_id) run('UPDATE users SET commission_rate=? WHERE id=? AND company_id=?', Number(r.commission_rate) || 0, r.user_id, loanCompanyId(req));
  }
  audit({ company_id: loanCompanyId(req), user_id: req.user.id, user_name: req.user.name, action: 'loan.commission.rates', entity: 'users', module: 'loans', detail: { count: rates.length } });
  res.json({ ok: true });
});

// ---- Convert a lead/customer into a loan lead (or manual referral entry) ----
router.post('/loans/convert', (req, res) => {
  if (!can(req.user, 'loan.create')) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  const lead = b.lead_id ? get('SELECT * FROM leads WHERE id=? AND company_id=?', b.lead_id, loanCompanyId(req)) : null;
  if (b.lead_id && !lead) return res.status(404).json({ error: 'Lead not found' });
  const customer = b.customer_id ? get('SELECT * FROM customers WHERE id=? AND company_id=?', b.customer_id, loanCompanyId(req)) : null;
  if (b.customer_id && !customer) return res.status(404).json({ error: 'Customer not found' });
  const existing = (lead || customer) && get('SELECT id FROM loans WHERE company_id=? AND (lead_id=? OR customer_id=?)', loanCompanyId(req), b.lead_id || '', b.customer_id || '');
  if (existing) return res.status(400).json({ error: 'Loan lead already exists for this lead/customer' });
  const lid = id();
  const bank = b.bank_id ? get('SELECT name, rate_offered FROM loan_banks WHERE id=? AND company_id=?', b.bank_id, loanCompanyId(req)) : null;
  const dsa = b.dsa_id ? get('SELECT name FROM loan_dsas WHERE id=? AND company_id=?', b.dsa_id, loanCompanyId(req)) : null;
  run(`INSERT INTO loans (id, company_id, lead_id, customer_id, customer_name, customer_phone, customer_email, property_desc,
          bank, bank_id, dsa_agent, dsa_id, contact_person, referrer_id, rate_offered, payout_timeline, leads_converted,
          loan_amount, interest_rate, status, processing_fee, disbursement_date, commission_amount,
          commission_status, payment_due_date, reminder_schedule, notes, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    lid, loanCompanyId(req), b.lead_id || null, b.customer_id || null,
    b.customer_name || lead?.name || customer?.name || 'Customer', b.customer_phone || lead?.phone || customer?.phone || null,
    b.customer_email || lead?.email || customer?.email || null,
    b.property_desc || lead?.requirement || customer?.address || null,
    bank?.name || b.bank || null, b.bank_id || null, dsa?.name || b.dsa_agent || null, b.dsa_id || null,
    b.contact_person || null, b.referrer_id || null, Number(b.rate_offered) || bank?.rate_offered || 0,
    b.payout_timeline || null, Number(b.leads_converted) || 0,
    b.loan_amount || 0, b.interest_rate || 0, b.status || 'application', b.processing_fee || 0, b.disbursement_date || null,
    b.commission_amount || 0, b.commission_status || 'pending', b.payment_due_date || null,
    JSON.stringify(b.reminder_schedule || []), b.notes || null, ts(), ts());
  if (lead) {
    run("UPDATE leads SET status=? WHERE id=?", 'loan_processing', lead.id);
    if (lead.owner_id) notify(loanCompanyId(req), lead.owner_id, 'Lead converted to Home Loan', `Home loan lead created for ${lead.name}`);
  }
  if (b.referrer_id) {
    const emp = get('SELECT name, commission_rate FROM users WHERE id=? AND company_id=?', b.referrer_id, loanCompanyId(req));
    const rate = Number(b.referrer_rate) || emp?.commission_rate || 0;
    const amount = Math.round((b.loan_amount || 0) * (rate / 100));
    run('INSERT INTO loan_referrals (id, company_id, user_id, loan_id, commission_rate, commission_amount, commission_status, payout_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      id(), loanCompanyId(req), b.referrer_id, lid, rate, amount, b.referrer_status || 'pending', b.payout_timeline || null, ts());
    if (emp) notify(loanCompanyId(req), b.referrer_id, 'Referral commission registered', `Home loan referral for ${b.customer_name || 'customer'} at ${rate}% (₹${amount})`);
  }
  audit({ company_id: loanCompanyId(req), user_id: req.user.id, user_name: req.user.name, action: 'loan.convert', entity: 'loan', entity_id: lid, detail: { lead: b.lead_id, customer: b.customer_id, referrer: b.referrer_id }, module: 'loans' });
  emitCompany(loanCompanyId(req), 'loan:new', { loanId: lid });
  res.json({ ok: true, id: lid });
});

router.get('/loans', (req, res) => {
  if (!can(req.user, 'loan.view')) return res.status(403).json({ error: 'Forbidden' });
  const where = ['company_id=?'];
  const args = [loanCompanyId(req)];
  if (req.query.status) { where.push('status=?'); args.push(req.query.status); }
  if (req.query.bank) { where.push('bank=?'); args.push(req.query.bank); }
  if (req.query.loan_type) { where.push('loan_type=?'); args.push(req.query.loan_type); }
  if (req.query.from) { where.push('created_at>=?'); args.push(req.query.from); }
  if (req.query.to) { where.push('created_at<=?'); args.push(req.query.to + 'T23:59:59'); }
  if (req.query.q) { where.push('(customer_name LIKE ? OR customer_phone LIKE ? OR bank LIKE ? OR dsa_agent LIKE ?)'); args.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`); }
  const rows = all(`SELECT * FROM loans WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 200`, ...args);
  rows.forEach((l) => sendReminders(loanCompanyId(req), l));
  res.json(rows.map(loanOut));
});

router.get('/loans/meta', (req, res) => {
  res.json({ statuses: Object.entries(LOAN_LABELS).map(([value, label]) => ({ value, label })), reminders: [{ label: 'EMI due', daysBefore: 5 }, { label: 'Document expiry', daysBefore: 7 }, { label: 'Loan approval follow-up', daysBefore: 3 }] });
});

router.get('/loans/referrals', (req, res) => {
  if (!can(req.user, 'loan.view')) return res.status(403).json({ error: 'Forbidden' });
  const rows = all(
    `SELECT r.*, u.name user_name, l.customer_name loan_customer
     FROM loan_referrals r
     LEFT JOIN users u ON u.id = r.user_id
     LEFT JOIN loans l ON l.id = r.loan_id
     WHERE r.company_id=? ORDER BY r.created_at DESC LIMIT 200`, loanCompanyId(req));
  const restricted = !can(req.user, 'commission.view');
  res.json(rows.map((r) => ({ ...r, commission_amount: restricted ? 0 : r.commission_amount, commission_rate: restricted ? 0 : r.commission_rate, restricted })));
});

router.get('/loans/:id', (req, res) => {
  const l = get('SELECT * FROM loans WHERE id=? AND company_id=?', req.params.id, loanCompanyId(req));
  if (!l) return res.status(404).json({ error: 'Not found' });
  res.json({ ...loanOut(l), reminderSchedule: (() => { try { return JSON.parse(l.reminder_schedule || '[]'); } catch { return []; } })() });
});

router.patch('/loans/:id', (req, res) => {
  if (!can(req.user, 'loan.edit')) return res.status(403).json({ error: 'Forbidden' });
  const l = get('SELECT * FROM loans WHERE id=? AND company_id=?', req.params.id, loanCompanyId(req));
  if (!l) return res.status(404).json({ error: 'Not found' });
  const plain = ['bank', 'bank_id', 'dsa_agent', 'dsa_id', 'contact_person', 'referrer_id', 'loan_amount', 'interest_rate', 'status', 'processing_fee', 'disbursement_date', 'commission_amount', 'commission_status', 'payment_due_date', 'notes', 'property_desc', 'customer_name', 'customer_phone', 'customer_email', 'rate_offered', 'payout_timeline', 'leads_converted'];
  for (const f of plain) if (req.body[f] !== undefined) run(`UPDATE loans SET ${f}=? WHERE id=?`, req.body[f], l.id);
  if (req.body.reminder_schedule !== undefined) run('UPDATE loans SET reminder_schedule=? WHERE id=?', JSON.stringify(req.body.reminder_schedule || []), l.id);
  if (req.body.bank_id !== undefined) {
    const bank = get('SELECT name, rate_offered FROM loan_banks WHERE id=? AND company_id=?', req.body.bank_id, loanCompanyId(req));
    if (bank) run('UPDATE loans SET bank=?, rate_offered=? WHERE id=?', bank.name, bank.rate_offered, l.id);
  }
  if (req.body.dsa_id !== undefined) {
    const dsa = get('SELECT name FROM loan_dsas WHERE id=? AND company_id=?', req.body.dsa_id, loanCompanyId(req));
    if (dsa) run('UPDATE loans SET dsa_agent=? WHERE id=?', dsa.name, l.id);
  }
  if (req.body.referrer_id !== undefined && req.body.referrer_id) {
    const emp = get('SELECT name, commission_rate FROM users WHERE id=? AND company_id=?', req.body.referrer_id, loanCompanyId(req));
    const rate = Number(req.body.referrer_rate) || emp?.commission_rate || 0;
    const amount = Math.round((req.body.loan_amount || l.loan_amount || 0) * (rate / 100));
    run('INSERT OR REPLACE INTO loan_referrals (id, company_id, user_id, loan_id, commission_rate, commission_amount, commission_status, payout_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      get('SELECT id FROM loan_referrals WHERE loan_id=? AND company_id=?', l.id, loanCompanyId(req))?.id || id(), loanCompanyId(req), req.body.referrer_id, l.id, rate, amount, 'pending', req.body.payout_timeline || null, ts());
  }
  run('UPDATE loans SET updated_at=? WHERE id=?', ts(), l.id);
  audit({ company_id: loanCompanyId(req), user_id: req.user.id, user_name: req.user.name, action: 'loan.update', entity: 'loan', entity_id: l.id, detail: req.body, module: 'loans' });
  res.json({ ok: true });
});

// ---- Loan dashboard ----
router.get('/loans/dashboard/summary', (req, res) => {
  if (!can(req.user, 'loan.view')) return res.status(403).json({ error: 'Forbidden' });
  const cid = loanCompanyId(req);
  const rows = all('SELECT * FROM loans WHERE company_id=?', cid);
  const total = rows.length;
  const active = rows.filter((r) => ACTIVE_LOAN.includes(r.status)).length;
  const approved = rows.filter((r) => ['approved', 'sanctioned', 'disbursed'].includes(r.status)).length;
  const disbursed = rows.filter((r) => r.status === 'disbursed').length;
  const conversionRate = total ? Math.round((approved / total) * 100) : 0;
  const pipeline = {};
  for (const r of rows) pipeline[LOAN_LABELS[r.status] || r.status] = (pipeline[LOAN_LABELS[r.status] || r.status] || 0) + 1;
  res.json({ total, active, approved, disbursed, conversionRate, pipeline: Object.entries(pipeline).map(([label, count]) => ({ label, count })) });
});

router.get('/loans/dashboard/by-bank', (req, res) => {
  const rows = all(
    `SELECT COALESCE(NULLIF(bank,''),'Unassigned') bank, COUNT(*) total,
       SUM(CASE WHEN status IN ('approved','sanctioned','disbursed') THEN 1 ELSE 0 END) approvals,
       SUM(CASE WHEN status='disbursed' THEN 1 ELSE 0 END) disbursed
     FROM loans WHERE company_id=? GROUP BY bank ORDER BY total DESC`, loanCompanyId(req));
  res.json(rows.map((r) => ({ ...r, approvalRate: r.total ? Math.round((r.approvals / r.total) * 100) : 0 })));
});

router.get('/loans/dashboard/by-dsa', (req, res) => {
  const restricted = !can(req.user, 'commission.view');
  const rows = all(
    `SELECT COALESCE(NULLIF(dsa_agent,''),'Unassigned') dsa, COUNT(*) total,
       SUM(CASE WHEN status IN ('approved','sanctioned','disbursed') THEN 1 ELSE 0 END) approved,
       COALESCE(SUM(CASE WHEN commission_status='paid' THEN commission_amount ELSE 0 END),0) commissionPaid,
       COALESCE(SUM(CASE WHEN commission_status='pending' THEN commission_amount ELSE 0 END),0) commissionPending
     FROM loans WHERE company_id=? GROUP BY dsa ORDER BY total DESC`, loanCompanyId(req));
  res.json(rows.map((r) => ({ ...r, commissionPaid: restricted ? 0 : r.commissionPaid, commissionPending: restricted ? 0 : r.commissionPending, restricted })));
});

router.get('/loans/dashboard/commissions', (req, res) => {
  const rows = all('SELECT * FROM loans WHERE company_id=?', loanCompanyId(req));
  const earned = rows.reduce((s, r) => s + (r.commission_amount || 0), 0);
  const paid = rows.filter((r) => r.commission_status === 'paid').reduce((s, r) => s + (r.commission_amount || 0), 0);
  const items = rows.filter((r) => r.commission_amount > 0).map((r) => ({ id: r.id, customer_name: r.customer_name, dsa_agent: r.dsa_agent, amount: r.commission_amount, status: r.commission_status }));
  // Commission % is sensitive: only show exact amounts to users with commission.view
  if (!can(req.user, 'commission.view')) {
    return res.json({ earned, pending: 0, paid, restricted: true, items: items.map((i) => ({ ...i, amount: 0 })) });
  }
  res.json({ earned, pending: earned - paid, paid, items });
});

// Rights-based CSV export of home loans (admin assigns loan.export).
router.get('/loans/export/csv', (req, res) => {
  if (!can(req.user, 'loan.view') || !can(req.user, 'loan.export')) return res.status(403).json({ error: 'Forbidden' });
  const rows = all('SELECT * FROM loans WHERE company_id=?', loanCompanyId(req));
  const data = rows.map((l) => ({
    Customer: l.customer_name, Phone: l.customer_phone, Email: l.customer_email || '',
    Bank: l.bank || '', 'Loan Type': l.loan_type || '', 'Loan Amount': l.loan_amount || '',
    Status: LOAN_LABELS[l.status] || l.status, 'DSA Agent': l.dsa_agent || '', 'Commission': l.commission_amount || 0,
    'Created': (l.created_at || '').slice(0, 10)
  }));
  const cols = Object.keys(data[0] || {}).map((k) => ({ label: k, accessor: (r) => r[k] }));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="home_loans.csv"');
  res.send(csv(data, cols));
});

export default router;
