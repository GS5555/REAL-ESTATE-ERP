// Sub-broker management: track sub-brokers and the two verticals they bring business in
// — (1) leads we get from them to close, and (2) properties we get from them to close.
import { Router } from 'express';
import { get, all, run, id, ts, audit } from '../db.js';
import { can } from '../auth.js';
import { hydrate, hydratelist } from '../lib/helpers.js';
import { getOrCreateReferral, attributeLead } from '../lib/referrals.js';

const router = Router();

function allowed(req) {
  return req.user.role === 'super_admin' || can(req.user, 'subbroker.view');
}
function editable(req) {
  return req.user.role === 'super_admin' || can(req.user, 'subbroker.edit');
}

function rowToJson(r) {
  if (!r) return r;
  const out = { ...r };
  try { out.verticals = JSON.parse(r.verticals || '[]'); } catch { out.verticals = []; }
  return out;
}

// List sub-brokers with their vertical pipeline counts + referral link.
router.get('/', (req, res) => {
  if (!allowed(req)) return res.status(403).json({ error: 'Forbidden' });
  const cid = req.user.company_id || 'system';
  const rows = all('SELECT * FROM subbrokers WHERE company_id=? ORDER BY created_at DESC', cid);
  const out = rows.map((r) => {
    const s = rowToJson(r);
    const leadStats = get(`SELECT COUNT(*) leads,
      COALESCE(SUM(CASE WHEN status IN ('won','registered','payment') THEN 1 ELSE 0 END),0) won
      FROM leads WHERE company_id=? AND subbroker_id=?`, cid, s.id);
    const propStats = get(`SELECT COUNT(*) props,
      COALESCE(SUM(CASE WHEN status='sold' THEN 1 ELSE 0 END),0) sold
      FROM listings WHERE company_id=? AND subbroker_id=?`, cid, s.id);
    const ref = getOrCreateReferral(cid, { type: 'subbroker', id: s.id, name: s.name, phone: s.phone, email: s.email });
    return { ...s, leads: leadStats.leads, leads_won: leadStats.won, properties: propStats.props, properties_sold: propStats.sold, ref_code: ref.ref_code, ref_amount: ref.amount };
  });
  res.json(out);
});

// Create a sub-broker.
router.post('/', (req, res) => {
  if (!editable(req)) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Name required' });
  const sid = id();
  const verticals = Array.isArray(b.verticals) && b.verticals.length ? b.verticals : ['leads', 'properties'];
  run(`INSERT INTO subbrokers (id, company_id, name, phone, email, company, commission_pct, verticals, status, notes, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    sid, req.user.company_id || 'system', b.name, b.phone || null, b.email || null, b.company || null,
    b.commission_pct || 1, JSON.stringify(verticals), b.status || 'active', b.notes || null, ts());
  getOrCreateReferral(req.user.company_id || 'system', { type: 'subbroker', id: sid, name: b.name, phone: b.phone, email: b.email });
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'subbroker.create', entity: 'subbroker', entity_id: sid, detail: { name: b.name, verticals }, module: 'subbroker' });
  res.json({ ok: true, id: sid });
});

// Update a sub-broker.
router.patch('/:id', (req, res) => {
  if (!editable(req)) return res.status(403).json({ error: 'Forbidden' });
  const cid = req.user.company_id || 'system';
  const s = get('SELECT * FROM subbrokers WHERE id=? AND company_id=?', req.params.id, cid);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const plain = ['name', 'phone', 'email', 'company', 'commission_pct', 'status', 'notes'];
  for (const f of plain) if (b[f] !== undefined) run(`UPDATE subbrokers SET ${f}=? WHERE id=?`, b[f], s.id);
  if (b.verticals !== undefined) run('UPDATE subbrokers SET verticals=? WHERE id=?', JSON.stringify(Array.isArray(b.verticals) ? b.verticals : []), s.id);
  audit({ company_id: cid, user_id: req.user.id, user_name: req.user.name, action: 'subbroker.update', entity: 'subbroker', entity_id: s.id, module: 'subbroker' });
  res.json({ ok: true });
});

// Vertical: leads from a sub-broker (leads attributed with subbroker_id).
router.get('/:id/leads', (req, res) => {
  if (!allowed(req)) return res.status(403).json({ error: 'Forbidden' });
  const rows = all('SELECT * FROM leads WHERE company_id=? AND subbroker_id=? ORDER BY created_at DESC LIMIT 200',
    req.user.company_id || 'system', req.params.id);
  res.json(hydratelist(rows));
});

// Vertical: properties from a sub-broker (listings attributed with subbroker_id).
router.get('/:id/properties', (req, res) => {
  if (!allowed(req)) return res.status(403).json({ error: 'Forbidden' });
  const rows = all('SELECT * FROM listings WHERE company_id=? AND subbroker_id=? ORDER BY created_at DESC LIMIT 200',
    req.user.company_id || 'system', req.params.id);
  res.json(hydratelist(rows));
});

// Attach an existing lead or listing to a sub-broker. body: { type: 'lead'|'listing', id }
router.post('/:id/attach', (req, res) => {
  if (!editable(req)) return res.status(403).json({ error: 'Forbidden' });
  const cid = req.user.company_id || 'system';
  const s = get('SELECT * FROM subbrokers WHERE id=? AND company_id=?', req.params.id, cid);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const { type, id: entityId } = req.body || {};
  if (type === 'lead') {
    const lead = get('SELECT name, phone, subbroker_id FROM leads WHERE id=? AND company_id=?', entityId, cid);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (lead.subbroker_id) return res.status(409).json({ error: 'Lead already attached to a sub-broker' });
    const ok = run('UPDATE leads SET subbroker_id=?, updated_at=? WHERE id=? AND company_id=?', s.id, ts(), entityId, cid).changes;
    if (ok) attributeLead(cid, getOrCreateReferral(cid, { type: 'subbroker', id: s.id, name: s.name, phone: s.phone, email: s.email }).ref_code, entityId, lead.name, lead.phone);
    return res.json({ ok: !!ok });
  }
  if (type === 'listing') {
    const l = get('SELECT subbroker_id FROM listings WHERE id=? AND company_id=?', entityId, cid);
    if (!l) return res.status(404).json({ error: 'Listing not found' });
    if (l.subbroker_id) return res.status(409).json({ error: 'Listing already attached to a sub-broker' });
    const ok = run('UPDATE listings SET subbroker_id=?, updated_at=? WHERE id=? AND company_id=?', s.id, ts(), entityId, cid).changes;
    return res.json({ ok: !!ok });
  }
  res.status(400).json({ error: 'type must be lead or listing' });
});

export default router;
