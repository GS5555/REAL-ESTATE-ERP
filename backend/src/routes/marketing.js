import { Router } from 'express';
import { get, run, all, ts, id, audit } from '../db.js';
import { hydratelist, BOOKED_STATUSES } from '../lib/helpers.js';
import { requireAuth, requirePerm, can } from '../auth.js';

const router = Router();
router.use(requireAuth);

router.get('/campaigns', (req, res) => {
  if (!can(req.user, 'marketing.view')) return res.status(403).json({ error: 'Forbidden' });
  const rows = all('SELECT * FROM campaigns WHERE company_id=? ORDER BY created_at DESC', req.user.company_id);
  const enriched = rows.map((c) => {
    const leads = get('SELECT COUNT(*) n FROM leads WHERE company_id=? AND source=?', req.user.company_id, c.channel).n;
    const bookings = get(`SELECT COUNT(*) n FROM leads WHERE company_id=? AND source=? AND status IN (${BOOKED_STATUSES.map(() => '?').join(',')})`, req.user.company_id, c.channel, ...BOOKED_STATUSES).n;
    const cpl = leads ? (c.spent || c.budget || 0) / leads : 0;
    return { ...c, actual_leads: leads, actual_bookings: bookings, cost_per_lead: Math.round(cpl) };
  });
  res.json(enriched);
});

router.post('/campaigns', (req, res) => {
  if (!can(req.user, 'marketing.create')) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Name required' });
  const cid = id();
  run(`INSERT INTO campaigns (id, company_id, name, channel, budget, spent, leads_count, bookings_count, start_date, end_date, created_at)
       VALUES (?,?,?,?,?,?,0,0,?,?,?)`,
    cid, req.user.company_id, b.name, b.channel || 'Facebook', b.budget || 0, b.spent || 0,
    b.start_date || null, b.end_date || null, ts());
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'campaign.create', entity: 'campaign', entity_id: cid, detail: { name: b.name } });
  res.json({ ok: true, id: cid });
});

router.patch('/campaigns/:id', (req, res) => {
  if (!can(req.user, 'marketing.edit')) return res.status(403).json({ error: 'Forbidden' });
  const f = ['name', 'budget', 'spent', 'start_date', 'end_date', 'channel'];
  for (const ff of f) if (req.body[ff] !== undefined) run(`UPDATE campaigns SET ${ff}=? WHERE id=? AND company_id=?`, req.body[ff], req.params.id, req.user.company_id);
  res.json({ ok: true });
});

export default router;
