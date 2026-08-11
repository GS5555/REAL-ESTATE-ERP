import { Router } from 'express';
import { get, run, all, ts, id, audit, notify } from '../db.js';
import { hydrate, hydratelist } from '../lib/helpers.js';
import { requireAuth, requirePerm, can } from '../auth.js';
import { paginate } from '../lib/helpers.js';
import { userScope } from '../lib/scope.js';

const router = Router();
router.use(requireAuth);

const TYPES = ['call', 'meeting', 'whatsapp', 'email', 'note', 'voice', 'site_visit', 'booking', 'negotiation', 'task', 'sms', 'chat', 'video_call', 'office_visit'];
const MODES = ['Phone Call', 'WhatsApp', 'SMS', 'Email', 'Live Chat', 'Office Visit', 'Site Visit', 'Video Call'];

// ---- Activities / follow-ups ----
router.get('/', (req, res) => {
  if (!can(req.user, 'activity.view')) return res.status(403).json({ error: 'Forbidden' });
  const where = ['a.company_id=?'];
  const args = [req.user.company_id];
  const scope = userScope(req.user, 'a');
  if (scope.clause) { where.push(scope.clause); args.push(...scope.args); }
  if (req.query.lead_id) { where.push('a.lead_id=?'); args.push(req.query.lead_id); }
  if (req.query.user_id) { where.push('a.user_id=?'); args.push(req.query.user_id); }
  if (req.query.due) { where.push('a.done_at IS NULL AND a.scheduled_at IS NOT NULL'); }
  if (req.query.mode) { where.push('a.mode=?'); args.push(req.query.mode); }
  if (req.query.q) { where.push('(a.subject LIKE ? OR a.note LIKE ?)'); args.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const rows = all(
    `SELECT a.*, l.name AS lead_name, u.name AS user_name FROM activities a
     LEFT JOIN leads l ON l.id=a.lead_id LEFT JOIN users u ON u.id=a.user_id
     WHERE ${where.join(' AND ')} ORDER BY COALESCE(a.scheduled_at, a.created_at) DESC LIMIT 200`, ...args);
  res.json(rows);
});

router.post('/', (req, res) => {
  if (!can(req.user, 'activity.create')) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  if (!b.type || !TYPES.includes(b.type)) return res.status(400).json({ error: 'Invalid type' });
  if (!b.lead_id && !b.subject) return res.status(400).json({ error: 'lead_id or subject required' });
  const aid = id();
  run(`INSERT INTO activities (id, company_id, lead_id, user_id, type, direction, subject, note, voice_url, location, outcome, mode, recording_url, scheduled_at, next_followup_at, reminder_enabled, done_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    aid, req.user.company_id, b.lead_id || null, b.user_id || req.user.id, b.type, b.direction || 'outbound',
    b.subject || null, b.note || null, b.voice_url || null, b.location || null, b.outcome || null,
    b.mode || null, b.recording_url || null, b.scheduled_at || null, b.next_followup_at || null,
    b.reminder_enabled ? 1 : 0, b.done ? ts() : (b.scheduled_at ? null : ts()), ts());
  if (b.lead_id) {
    const lead = get('SELECT name, owner_id FROM leads WHERE id=?', b.lead_id);
    if (lead) {
      run('UPDATE leads SET updated_at=?, last_activity_at=? WHERE id=?', ts(), ts(), b.lead_id);
      if (lead.owner_id && lead.owner_id !== req.user.id && b.notifyOwner !== false) {
        notify(req.user.company_id, lead.owner_id, 'Activity on your lead', `${req.user.name} logged a ${b.type} on ${lead.name}`);
      }
      if (b.scheduled_at) {
        notify(req.user.company_id, b.user_id || req.user.id, 'Follow-up scheduled', `Follow-up ${b.subject || b.type} on ${lead.name}`);
      }
    }
  }
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'activity.create', entity: 'activity', entity_id: aid, detail: { type: b.type, lead: b.lead_id, mode: b.mode } });
  res.json({ ok: true, id: aid });
});

router.patch('/:id', (req, res) => {
  if (!can(req.user, 'activity.edit')) return res.status(403).json({ error: 'Forbidden' });
  const a = get('SELECT * FROM activities WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  const fields = ['subject', 'note', 'outcome', 'scheduled_at', 'location', 'voice_url', 'mode', 'recording_url', 'next_followup_at'];
  for (const f of fields) if (req.body[f] !== undefined) run(`UPDATE activities SET ${f}=? WHERE id=?`, req.body[f], a.id);
  if (req.body.reminder_enabled !== undefined) run('UPDATE activities SET reminder_enabled=? WHERE id=?', req.body.reminder_enabled ? 1 : 0, a.id);
  if (req.body.done) run('UPDATE activities SET done_at=? WHERE id=?', ts(), a.id);
  if (req.body.done === false) run('UPDATE activities SET done_at=NULL WHERE id=?', a.id);
  res.json({ ok: true });
});

// ---- Site visits ----
router.get('/site-visits', (req, res) => {
  if (!can(req.user, 'sitevisit.view')) return res.status(403).json({ error: 'Forbidden' });
  const scope = can(req.user, 'lead.assign') ? '' : ' AND user_id=?';
  const args = can(req.user, 'lead.assign') ? [req.user.company_id] : [req.user.company_id, req.user.id];
  const rows = all(
    `SELECT v.*, l.name AS lead_name, u.name AS user_name, p.name AS project_name FROM site_visits v
     LEFT JOIN leads l ON l.id=v.lead_id LEFT JOIN users u ON u.id=v.user_id
     LEFT JOIN projects p ON p.id=v.project_id
     WHERE v.company_id=? ${scope} ORDER BY v.scheduled_at DESC LIMIT 200`, ...args);
  res.json(rows);
});

router.post('/site-visits', (req, res) => {
  if (!can(req.user, 'activity.create')) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  if (!b.lead_id || !b.scheduled_at) return res.status(400).json({ error: 'lead_id and scheduled_at required' });
  const vid = id();
  run(`INSERT INTO site_visits (id, company_id, lead_id, project_id, user_id, scheduled_at, status, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    vid, req.user.company_id, b.lead_id, b.project_id || null, req.user.id, b.scheduled_at, 'scheduled', ts());
  const lead = get('SELECT name, owner_id FROM leads WHERE id=?', b.lead_id);
  if (lead && lead.owner_id) {
    notify(req.user.company_id, lead.owner_id, 'Site visit scheduled', `Visit for ${lead.name} on ${new Date(b.scheduled_at).toLocaleString()}`);
  }
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'sitevisit.create', entity: 'sitevisit', entity_id: vid, detail: { lead: b.lead_id } });
  res.json({ ok: true, id: vid });
});

// Check-in / check-out with geo + photo verification
router.post('/site-visits/:id/checkin', (req, res) => {
  const v = get('SELECT * FROM site_visits WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  run(`UPDATE site_visits SET status='done', checkin_at=?, latitude=?, longitude=?, photo_url=? WHERE id=?`,
    ts(), req.body?.latitude || null, req.body?.longitude || null, req.body?.photo_url || v.photo_url || null, v.id);
  run(`INSERT INTO attendance (id, company_id, employee_id, date, status, checkin, latitude, longitude, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    id(), req.user.company_id, req.user.id, new Date().toISOString().slice(0, 10), 'present', ts(), req.body?.latitude || null, req.body?.longitude || null, ts());
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'sitevisit.checkin', entity: 'sitevisit', entity_id: v.id });
  res.json({ ok: true });
});

router.post('/site-visits/:id/checkout', (req, res) => {
  run(`UPDATE site_visits SET checkout_at=?, feedback=? WHERE id=? AND company_id=?`, ts(), req.body?.feedback || null, req.params.id, req.user.company_id);
  res.json({ ok: true });
});

router.post('/site-visits/:id/verify', (req, res) => {
  if (!can(req.user, 'sitevisit.approve')) return res.status(403).json({ error: 'Forbidden' });
  run(`UPDATE site_visits SET status='verified' WHERE id=? AND company_id=?`, req.params.id, req.user.company_id);
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'sitevisit.verify', entity: 'sitevisit', entity_id: req.params.id });
  res.json({ ok: true });
});

export default router;
