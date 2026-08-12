// V2 Automatic Invoice & Payment Reminder System.
// Generate PDF invoices, send via email/WhatsApp/SMS, configurable per builder/vendor/customer,
// full invoice history and reminder logs.
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { get, run, all, ts, id, audit } from '../db.js';
import { hydrate, csv } from '../lib/helpers.js';
import { pdf } from '../lib/pdf.js';
import { requireAuth, can } from '../auth.js';
import { companySettings } from '../lib/helpers.js';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
router.use(requireAuth);

// super_admin has no company: fall back to the first company (same pattern as org.js / loans.js)
function billingCompanyId(req) {
  if (req.user.company_id) return req.user.company_id;
  const first = get('SELECT id FROM companies ORDER BY created_at LIMIT 1');
  return first ? first.id : null;
}

// GST state code derivation from GSTIN (first 2 digits = state code per Indian GST).
// For the company, settings.config.gst_state_code may be set explicitly; otherwise derive from GSTIN.
export function gstStateCode(gstin) {
  const g = String(gstin || '').trim().toUpperCase();
  return /^\d{2}/.test(g) ? g.slice(0, 2) : null;
}

// Compute GST split per Indian GST rules:
//  - intra-state (supplier & recipient in same state): CGST = SGST = rate/2 each
//  - inter-state (different states): IGST = full rate
export function gstBreakdown(taxable, rate, supplierState, buyerState) {
  const r = Number(rate) || 0;
  const t = Math.max(0, Number(taxable) || 0);
  const total = Math.round(t * r / 100);
  const sameState = supplierState && buyerState && String(supplierState) === String(buyerState);
  if (sameState) {
    const half = Math.round(total / 2);
    return { gst_rate: r, taxable: t, cgst: half, sgst: total - half, igst: 0, gst_type: 'intra' };
  }
  return { gst_rate: r, taxable: t, cgst: 0, sgst: 0, igst: total, gst_type: 'inter' };
}

// Per-line-item GST: each item's tax = qty x rate x item gst_rate%, then split CGST/SGST/IGST
// based on supplier/buyer state and aggregate across all items.
export function gstBreakdownItems(items, supplierState, buyerState) {
  let taxable = 0, cgst = 0, sgst = 0, igst = 0, sumRate = 0, count = 0;
  for (const it of items || []) {
    const q = Number(it.qty) || 1;
    const r = Number(it.rate) || 0;
    const t = q * r;
    taxable += t;
    const g = gstBreakdown(t, Number(it.gst_rate) || 0, supplierState, buyerState);
    cgst += g.cgst; sgst += g.sgst; igst += g.igst;
    sumRate += Number(it.gst_rate) || 0; count++;
  }
  taxable = Math.round(taxable); cgst = Math.round(cgst); sgst = Math.round(sgst); igst = Math.round(igst);
  const gst_rate = count === 1 ? (sumRate || 0) : 0;
  const sameState = supplierState && buyerState && String(supplierState) === String(buyerState);
  return { gst_rate, taxable, cgst, sgst, igst, gst_type: sameState ? 'intra' : 'inter' };
}

function companyGstState(companyId) {
  const co = hydrate(get('SELECT * FROM companies WHERE id=?', companyId), ['settings']);
  const cfg = co.settings?.config || {};
  if (cfg.gst_state_code) return String(cfg.gst_state_code).trim();
  return gstStateCode(cfg.gst || cfg.gstin);
}

// Automation config stored in company settings: settings.billingAutomation = {
//   builders: { <id>: bool }, vendors: { <id>: bool }, customers: { <id>: bool },
//   channels: { pdf: true, email: true, whatsapp: true, sms: true } }
function autoConfig(companyId) {
  const s = companySettings(companyId);
  return s.billingAutomation || {};
}
function saveAutoConfig(companyId, cfg) {
  const co = get('SELECT * FROM companies WHERE id=?', companyId);
  const settings = hydrate(co, ['settings']).settings || {};
  settings.billingAutomation = cfg;
  run('UPDATE companies SET settings=? WHERE id=?', JSON.stringify(settings), companyId);
}

router.get('/billing/config', (req, res) => {
  res.json(autoConfig(billingCompanyId(req)));
});

router.put('/billing/config', (req, res) => {
  if (!can(req.user, 'settings.edit')) return res.status(403).json({ error: 'Forbidden' });
  const cfg = { ...autoConfig(billingCompanyId(req)), ...(req.body || {}) };
  saveAutoConfig(billingCompanyId(req), cfg);
  audit({ company_id: billingCompanyId(req), user_id: req.user.id, user_name: req.user.name, action: 'billing.config', entity: 'company', entity_id: billingCompanyId(req), detail: cfg, module: 'billing' });
  res.json({ ok: true, config: cfg });
});

// Toggle automation for a specific builder/vendor/customer entity
router.post('/billing/entity', (req, res) => {
  if (!can(req.user, 'settings.edit')) return res.status(403).json({ error: 'Forbidden' });
  const { kind, entity_id, enabled } = req.body || {};
  if (!['builders', 'vendors', 'customers'].includes(kind)) return res.status(400).json({ error: 'invalid kind' });
  const cfg = autoConfig(billingCompanyId(req));
  cfg[kind] = cfg[kind] || {};
  cfg[kind][entity_id] = !!enabled;
  saveAutoConfig(billingCompanyId(req), cfg);
  res.json({ ok: true });
});

// ---- Vendors (company details, GST, contacts, alternate contact) ----
router.get('/billing/vendors', (req, res) => {
  if (!can(req.user, 'finance.view') && !can(req.user, 'vendor.manage')) return res.status(403).json({ error: 'Forbidden' });
  const rows = all('SELECT * FROM vendors WHERE company_id=? ORDER BY company_name', billingCompanyId(req));
  res.json(rows);
});

router.post('/billing/vendors', (req, res) => {
  if (!can(req.user, 'vendor.manage')) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  if (!b.company_name) return res.status(400).json({ error: 'Company name required' });
  const vid = id();
  const gstState = gstStateCode(b.gstin);
  run(`INSERT INTO vendors (id, company_id, company_name, gstin, gst_state_code, gst_state, contact_person, email, phone, alternate_phone, alternate_email, address, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    vid, billingCompanyId(req), String(b.company_name).trim(), b.gstin || null,
    b.gst_state_code || gstState || null, b.gst_state || null, b.contact_person || null,
    b.email || null, b.phone || null, b.alternate_phone || null, b.alternate_email || null, b.address || null, ts());
  audit({ company_id: billingCompanyId(req), user_id: req.user.id, user_name: req.user.name, action: 'vendor.create', entity: 'vendor', entity_id: vid, detail: { company_name: b.company_name } });
  res.json({ ok: true, id: vid });
});

router.patch('/billing/vendors/:id', (req, res) => {
  if (!can(req.user, 'vendor.manage')) return res.status(403).json({ error: 'Forbidden' });
  const v = get('SELECT * FROM vendors WHERE id=? AND company_id=?', req.params.id, billingCompanyId(req));
  if (!v) return res.status(404).json({ error: 'Not found' });
  const fields = ['company_name', 'gstin', 'gst_state_code', 'gst_state', 'contact_person', 'email', 'phone', 'alternate_phone', 'alternate_email', 'address'];
  for (const f of fields) if (req.body[f] !== undefined) run(`UPDATE vendors SET ${f}=? WHERE id=?`, req.body[f], v.id);
  if (req.body.gstin !== undefined && req.body.gst_state_code === undefined) {
    const sc = gstStateCode(req.body.gstin);
    if (sc) run('UPDATE vendors SET gst_state_code=? WHERE id=?', sc, v.id);
  }
  audit({ company_id: billingCompanyId(req), user_id: req.user.id, user_name: req.user.name, action: 'vendor.update', entity: 'vendor', entity_id: v.id, detail: Object.keys(req.body || {}) });
  res.json({ ok: true });
});

router.delete('/billing/vendors/:id', (req, res) => {
  if (!can(req.user, 'vendor.manage')) return res.status(403).json({ error: 'Forbidden' });
  const v = get('SELECT * FROM vendors WHERE id=? AND company_id=?', req.params.id, billingCompanyId(req));
  if (!v) return res.status(404).json({ error: 'Not found' });
  run('DELETE FROM vendors WHERE id=?', v.id);
  audit({ company_id: billingCompanyId(req), user_id: req.user.id, user_name: req.user.name, action: 'vendor.delete', entity: 'vendor', entity_id: v.id, module: 'billing' });
  res.json({ ok: true });
});

// ---- Invoice generation ----
 router.get('/billing/invoices', (req, res) => {
   if (!can(req.user, 'finance.view') && !can(req.user, 'finance.invoice')) return res.status(403).json({ error: 'Forbidden' });
   const where = ['i.company_id=?'];
   const args = [billingCompanyId(req)];
   if (req.query.status) { where.push('i.status=?'); args.push(req.query.status); }
   if (req.query.q) { where.push('(c.name LIKE ? OR i.number LIKE ?)'); args.push(`%${req.query.q}%`, `%${req.query.q}%`); }
   if (req.query.from) { where.push('i.created_at>=?'); args.push(req.query.from); }
   if (req.query.to) { where.push('i.created_at<=?'); args.push(req.query.to + 'T23:59:59'); }
   const rows = all(
      `SELECT i.*, c.name customer_name, c.phone customer_phone, c.email customer_email, c.address customer_address, c.gstin customer_gstin, u.number unit_number, b.rera_ref booking_ref FROM invoices i
       LEFT JOIN customers c ON c.id=i.customer_id LEFT JOIN bookings b ON b.id=i.booking_id LEFT JOIN units u ON u.id=b.unit_id
       WHERE ${where.join(' AND ')} ORDER BY i.created_at DESC LIMIT 200`, ...args);
    const items = all('SELECT * FROM invoice_items WHERE company_id=? AND invoice_id IN (SELECT id FROM invoices WHERE company_id=? LIMIT 200)', billingCompanyId(req), billingCompanyId(req));
    const byInv = {};
    for (const it of items) { (byInv[it.invoice_id] = byInv[it.invoice_id] || []).push(it); }
    res.json(rows.map((r) => ({ ...r, items: byInv[r.id] || [] })));
  });

// Rights-based CSV export of invoices (admin assigns billing.export).
 router.get('/billing/invoices/export/csv', (req, res) => {
   if (!can(req.user, 'finance.view') || !can(req.user, 'billing.export')) return res.status(403).json({ error: 'Forbidden' });
   const rows = all(
     `SELECT i.*, c.name customer_name, u.number unit_number, b.rera_ref booking_ref FROM invoices i
      LEFT JOIN customers c ON c.id=i.customer_id LEFT JOIN bookings b ON b.id=i.booking_id LEFT JOIN units u ON u.id=b.unit_id
      WHERE i.company_id=? ORDER BY i.created_at DESC LIMIT 500`, billingCompanyId(req));
   const data = rows.map((r) => ({
     Number: r.number, Customer: r.customer_name || '', Amount: r.amount, GST: r.gst || 0,
     Status: r.status, Date: (r.date || r.created_at || '').slice(0, 10), Due: (r.due_date || '').slice(0, 10),
     Unit: r.unit_number || '', 'Booking Ref': r.booking_ref || ''
   }));
   const cols = Object.keys(data[0] || {}).map((k) => ({ label: k, accessor: (r) => r[k] }));
   res.setHeader('Content-Type', 'text/csv');
   res.setHeader('Content-Disposition', 'attachment; filename="billings.csv"');
    res.send(csv(data, cols));
  });

// ---- Particulars (products / services master) ----
router.get('/billing/particulars', (req, res) => {
  if (!can(req.user, 'finance.view') && !can(req.user, 'finance.invoice')) return res.status(403).json({ error: 'Forbidden' });
  const rows = all('SELECT * FROM particulars WHERE company_id=? ORDER BY name', billingCompanyId(req));
  res.json(rows);
});

router.post('/billing/particulars', (req, res) => {
  if (!can(req.user, 'finance.invoice')) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Name required' });
  const pid = id();
  run(`INSERT INTO particulars (id, company_id, name, description, hsn, unit, rate, gst_rate, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    pid, billingCompanyId(req), String(b.name).trim(), b.description || null, b.hsn || null, b.unit || null,
    Number(b.rate) || 0, Number(b.gst_rate) || 0, ts());
  audit({ company_id: billingCompanyId(req), user_id: req.user.id, user_name: req.user.name, action: 'particular.create', entity: 'particular', entity_id: pid, detail: { name: b.name } });
  res.json({ ok: true, id: pid });
});

router.patch('/billing/particulars/:id', (req, res) => {
  if (!can(req.user, 'finance.invoice')) return res.status(403).json({ error: 'Forbidden' });
  const p = get('SELECT * FROM particulars WHERE id=? AND company_id=?', req.params.id, billingCompanyId(req));
  if (!p) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const fields = ['name', 'description', 'hsn', 'unit', 'rate', 'gst_rate'];
  const sets = [];
  const args = [];
  for (const f of fields) {
    if (f in b) {
      sets.push(`${f}=?`);
      args.push(f === 'rate' || f === 'gst_rate' ? Number(b[f]) || 0 : (f === 'name' ? String(b[f]).trim() : b[f]));
    }
  }
  if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
  run(`UPDATE particulars SET ${sets.join(',')} WHERE id=? AND company_id=?`, ...args, p.id, billingCompanyId(req));
  audit({ company_id: billingCompanyId(req), user_id: req.user.id, user_name: req.user.name, action: 'particular.update', entity: 'particular', entity_id: p.id, module: 'billing' });
  res.json({ ok: true });
});

router.delete('/billing/particulars/:id', (req, res) => {
  if (!can(req.user, 'finance.invoice')) return res.status(403).json({ error: 'Forbidden' });
  run('DELETE FROM particulars WHERE id=? AND company_id=?', req.params.id, billingCompanyId(req));
  audit({ company_id: billingCompanyId(req), user_id: req.user.id, user_name: req.user.name, action: 'particular.delete', entity: 'particular', entity_id: req.params.id, module: 'billing' });
  res.json({ ok: true });
});

router.post('/billing/invoices', (req, res) => {
  if (!can(req.user, 'finance.invoice')) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  if (!b.customer_id) return res.status(400).json({ error: 'customer_id required' });
  const customer = get('SELECT * FROM customers WHERE id=? AND company_id=?', b.customer_id, billingCompanyId(req));
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  const iid = id();
  const number = b.number || `INV-${Date.now().toString().slice(-6)}`;
  const rate = Number(b.gst) || 0;
  // Line items from particular picker entries: [{ description, hsn, qty, rate, gst_rate }]
  const items = Array.isArray(b.items) ? b.items.filter((it) => it && it.description) : [];
  const supplierState = companyGstState(billingCompanyId(req));
  const buyerState = (customer.state_code || gstStateCode(customer.gstin || b.customer_gstin)) || (b.buyer_state_code || supplierState);
  let g;
  if (items.length) {
    g = gstBreakdownItems(items, supplierState, buyerState);
  } else {
    g = gstBreakdown(Number(b.amount) || 0, rate, supplierState, buyerState);
  }
  const taxable = g.taxable;
  run(`INSERT INTO invoices (id, company_id, customer_id, booking_id, number, amount, gst, status, date, due_date, created_at,
        taxable_amount, gst_rate, cgst, sgst, igst, gst_type)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    iid, billingCompanyId(req), b.customer_id, b.booking_id || null, number, taxable, rate, b.status || 'draft', ts(), b.due_date || null, ts(),
    g.taxable, g.gst_rate, g.cgst, g.sgst, g.igst, g.gst_type);
  for (const it of items) {
    const qty = Number(it.qty) || 1;
    const rte = Number(it.rate) || 0;
    run(`INSERT INTO invoice_items (id, company_id, invoice_id, description, hsn, unit, qty, rate, amount, gst_rate, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      id(), billingCompanyId(req), iid, String(it.description).trim(), it.hsn || null, it.unit || null, qty, rte, qty * rte,
      Number(it.gst_rate) || 0, ts());
  }
  audit({ company_id: billingCompanyId(req), user_id: req.user.id, user_name: req.user.name, action: 'invoice.create', entity: 'invoice', entity_id: iid, detail: { number, gst_type: g.gst_type, items: items.length } });
  res.json({ ok: true, id: iid, number, ...g, items: items.length });
});

// Download PDF invoice
router.get('/billing/invoices/:id/pdf', (req, res) => {
  if (!can(req.user, 'finance.view') && !can(req.user, 'finance.invoice')) return res.status(403).json({ error: 'Forbidden' });
  const inv = get('SELECT * FROM invoices WHERE id=? AND company_id=?', req.params.id, billingCompanyId(req));
  if (!inv) return res.status(404).json({ error: 'Not found' });
  const customer = get('SELECT * FROM customers WHERE id=?', inv.customer_id);
  const co = hydrate(get('SELECT * FROM companies WHERE id=?', billingCompanyId(req)), ['settings']);
  const settings = co.settings || {};
  const rate = Number(inv.gst_rate || inv.gst) || 0;
  const taxable = Number(inv.taxable_amount || inv.amount) || 0;
  const cgst = Number(inv.cgst) || 0;
  const sgst = Number(inv.sgst) || 0;
  const igst = Number(inv.igst) || (Number(inv.gst_type) === 'inter' ? Math.round(taxable * rate / 100) : 0);
  const gstTotal = cgst + sgst + igst;
  const invItems = all('SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY created_at', inv.id);
  // GST-compliant line items: taxable per item, then CGST/SGST split for intra-state
  // or a single IGST column for inter-state (out-of-Maharashtra / different state).
  const isIntra = String(inv.gst_type) === 'intra';
  const buildItem = (it, idx, qty, rte, gstRate) => {
    const taxable = qty * rte;
    const gst = Math.round(taxable * gstRate / 100);
    const row = {
      'Sl No': idx,
      Description: it.description,
      HSN: it.hsn || '',
      Qty: qty,
      Rate: `₹${rte}`,
      Taxable: `₹${taxable}`
    };
    if (isIntra) {
      const half = Math.round(gst / 2);
      row.CGST = `${gstRate}% ₹${half}`;
      row.SGST = `${gstRate}% ₹${gst - half}`;
    } else {
      row.IGST = `${gstRate}% ₹${gst}`;
    }
    row.Total = `₹${taxable + gst}`;
    return row;
  };
  const itemRows = invItems.length
    ? invItems.map((it, i) => buildItem(it, i + 1, Number(it.qty) || 1, Number(it.rate) || 0, Number(it.gst_rate) || 0))
    : [buildItem({ description: 'Booking / service charge', hsn: '' }, 1, 1, taxable, rate)];
  const taxRows = [];
  if (gstTotal > 0) {
    if (cgst + sgst > 0) {
      taxRows.push({ Description: `CGST`, Amount: `₹${cgst}` });
      taxRows.push({ Description: `SGST`, Amount: `₹${sgst}` });
    } else {
      taxRows.push({ Description: `IGST`, Amount: `₹${igst}` });
    }
  }
  taxRows.push({ Description: 'Total', Amount: `₹${taxable + gstTotal}` });
  const tables = [
    { rows: itemRows },
    { rows: taxRows }
  ];
  const config = settings.config || {};
  const branding = settings.branding || {};
  const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');
  let logoBuf = null;
  const logoUrl = branding.logo || '';
  const logoPath = logoUrl.startsWith('/uploads/') ? path.join(UPLOAD_DIR, logoUrl.replace('/uploads/', '')) : null;
  if (logoPath && fs.existsSync(logoPath)) {
    try { logoBuf = fs.readFileSync(logoPath); } catch {}
  }
  const doc = pdf({
    title: `INVOICE`,
    subtitle: inv.number,
    company: {
      name: branding.companyName || co.name,
      tagline: branding.tagline || '',
      logo: logoBuf,
      address: config.address || '',
      gst: config.gst || '',
      rera: config.rera || '',
      phone: config.support?.phone || '',
      email: config.support?.email || '',
      website: config.website || ''
    },
    billTo: {
      name: customer?.name || '—',
      phone: customer?.phone || '',
      email: customer?.email || '',
      address: customer?.address || '',
      gstin: customer?.gstin || ''
    },
    meta: [
      ['Invoice No', inv.number],
      ['Invoice Date', inv.date?.slice(0, 10)],
      ['Due Date', inv.due_date?.slice(0, 10) || '—'],
      ['GST Type', rate > 0 ? ((cgst + sgst > 0) ? 'Intra-state (CGST+SGST)' : 'Inter-state (IGST)') : '—'],
      ['Status', inv.status]
    ],
    tables,
    bank: config.bank || null,
    note: 'This is a system generated invoice.',
    footer: 'Thank you for your business! For queries contact ' + (config.support?.phone || '') + ' / ' + (config.support?.email || '') + ' — generated by Propease.'
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${inv.number}.pdf"`);
  res.send(doc);
});

// ---- Send invoice through configured channels ----
router.post('/billing/invoices/:id/send', (req, res) => {
  if (!can(req.user, 'finance.invoice')) return res.status(403).json({ error: 'Forbidden' });
  const inv = get('SELECT * FROM invoices WHERE id=? AND company_id=?', req.params.id, billingCompanyId(req));
  if (!inv) return res.status(404).json({ error: 'Not found' });
  const customer = get('SELECT * FROM customers WHERE id=?', inv.customer_id);
  const channels = req.body?.channels || ['email', 'whatsapp', 'sms'];
  const co = hydrate(get('SELECT * FROM companies WHERE id=?', billingCompanyId(req)), ['settings']);
  const settings = co.settings || {};
  const subject = `Invoice ${inv.number} from ${co.name}`;
  const body = `Dear ${customer?.name || 'Customer'}, your invoice ${inv.number} for ₹${inv.amount} is due on ${inv.due_date?.slice(0, 10) || '—'}. Please make the payment at your earliest.`;
  const log = [];
  for (const ch of channels) {
    run(`INSERT INTO reminder_logs (id, company_id, entity_type, entity_id, channel, subject, body, status, sent_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      id(), billingCompanyId(req), 'invoice', inv.id, ch, subject, body, 'sent', ts());
    log.push({ channel: ch, status: 'sent' });
  }
  run('UPDATE invoices SET status=? WHERE id=?', inv.status === 'draft' ? 'sent' : inv.status, inv.id);
  audit({ company_id: billingCompanyId(req), user_id: req.user.id, user_name: req.user.name, action: 'invoice.send', entity: 'invoice', entity_id: inv.id, detail: { channels }, module: 'billing' });
  res.json({ ok: true, log });
});

// ---- Payment due / overdue reminders ----
router.get('/billing/reminders/pending', (req, res) => {
  if (!can(req.user, 'finance.view')) return res.status(403).json({ error: 'Forbidden' });
  const cid = billingCompanyId(req);
  const today = new Date().toISOString().slice(0, 10);
  const due = all(
    `SELECT i.*, c.name customer_name, c.phone, c.email FROM invoices i JOIN customers c ON c.id=i.customer_id
     WHERE i.company_id=? AND i.status NOT IN ('paid','cancelled') AND i.due_date IS NOT NULL AND i.due_date <= ? ORDER BY i.due_date ASC`,
    cid, today);
  const upcoming = all(
    `SELECT i.*, c.name customer_name, c.phone, c.email FROM invoices i JOIN customers c ON c.id=i.customer_id
     WHERE i.company_id=? AND i.status NOT IN ('paid','cancelled') AND i.due_date IS NOT NULL AND i.due_date > ? ORDER BY i.due_date ASC LIMIT 20`,
    cid, today);
  res.json({ overdue: due, upcoming });
});

// Trigger reminder dispatch for all overdue invoices (respecting per-entity automation config)
router.post('/billing/reminders/run', (req, res) => {
  if (!can(req.user, 'finance.view')) return res.status(403).json({ error: 'Forbidden' });
  const cid = billingCompanyId(req);
  const today = new Date().toISOString().slice(0, 10);
  const cfg = autoConfig(cid);
  const rows = all(
    `SELECT i.*, c.name customer_name, c.phone, c.email FROM invoices i JOIN customers c ON c.id=i.customer_id
     WHERE i.company_id=? AND i.status NOT IN ('paid','cancelled') AND i.due_date IS NOT NULL AND i.due_date <= ?`,
    cid, today);
  let sent = 0;
  for (const inv of rows) {
    if (cfg.customers && cfg.customers[inv.customer_id] === false) continue;
    const channels = cfg.channels || { pdf: true, email: true, whatsapp: true, sms: true };
    const picks = [];
    if (channels.email) picks.push('email');
    if (channels.whatsapp) picks.push('whatsapp');
    if (channels.sms) picks.push('sms');
    for (const ch of picks) {
      run(`INSERT INTO reminder_logs (id, company_id, entity_type, entity_id, channel, subject, body, status, sent_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        id(), cid, 'invoice', inv.id, ch, `Payment reminder — Invoice ${inv.number}`, `Dear ${inv.customer_name}, your payment of ₹${inv.amount} is overdue. Please clear it at the earliest.`, 'sent', ts());
      sent++;
    }
  }
  audit({ company_id: cid, user_id: req.user.id, user_name: req.user.name, action: 'billing.reminders.run', entity: 'company', entity_id: cid, detail: { sent }, module: 'billing' });
  res.json({ ok: true, sent });
});

// Reminder logs
router.get('/billing/reminders/logs', (req, res) => {
  if (!can(req.user, 'finance.view')) return res.status(403).json({ error: 'Forbidden' });
  const rows = all('SELECT * FROM reminder_logs WHERE company_id=? ORDER BY sent_at DESC LIMIT 200', billingCompanyId(req));
  res.json(rows);
});

export default router;
