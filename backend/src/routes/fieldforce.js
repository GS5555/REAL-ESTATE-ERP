import { Router } from 'express';
import { get, run, all, ts, id, audit, notify } from '../db.js';
import { requireAuth, can } from '../auth.js';
import { haversine } from '../lib/assignment.js';
import { accessibleUserIds, gpsScope, userScope } from '../lib/scope.js';
import { emitCompany } from '../realtime.js';

const router = Router();
router.use(requireAuth);

const EXEC_ROLES = ['sales_executive', 'telecaller', 'team_leader', 'sales_manager', 'field_executive'];

// Live team map: executives with last known location + project anchors
 router.get('/map', (req, res) => {
   const cid = req.user.company_id;
   const ids = accessibleUserIds(req.user);
   let args = [cid, ...EXEC_ROLES];
   let idClause = ids ? `AND u.id IN (${ids.map(() => '?').join(',')})` : '';
   args.push(...(ids || []));
   if (req.query.user_id) {
     const allowed = ids ? ids.includes(Number(req.query.user_id)) : req.user.id === Number(req.query.user_id);
     if (!allowed && !can(req.user, 'gps.view')) return res.status(403).json({ error: 'Forbidden' });
     idClause = 'AND u.id=?';
     args = [cid, ...EXEC_ROLES, Number(req.query.user_id)];
   }
   const rows = all(
     `SELECT u.id, u.name, u.role, u.lat, u.lng, u.last_seen_at FROM users u
      WHERE u.company_id=? AND u.active=1 AND u.role IN (${EXEC_ROLES.map(() => '?').join(',')}) ${idClause}`,
     ...args
   );
  // enrich with latest checkin location if user has no live coords
  const execs = rows.map((u) => {
    if (u.lat == null) {
      const v = get('SELECT latitude, longitude, checkin_at FROM site_visits WHERE user_id=? AND checkin_at IS NOT NULL ORDER BY checkin_at DESC LIMIT 1', u.id);
      if (v && v.latitude) return { ...u, lat: v.latitude, lng: v.longitude, last_seen_at: v.checkin_at };
    }
    return u;
  });
  const projects = all('SELECT id, name, area, city, google_map FROM projects WHERE company_id=?', cid);
  res.json({ execs, projects });
});

// Executives update their live location (called by mobile/web voice + GPS)
router.post('/location', (req, res) => {
  const { lat, lng, gps_enabled, accuracy, battery, speed } = req.body || {};
  if (lat == null || lng == null) return res.status(400).json({ error: 'lat/lng required' });
  const now = ts();
  run('UPDATE users SET lat=?, lng=?, last_seen_at=? WHERE id=?', lat, lng, now, req.user.id);
  run(`INSERT INTO location_trace (id, company_id, user_id, lat, lng, gps_enabled, accuracy, battery, speed, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    id(), req.user.company_id, req.user.id, lat, lng, gps_enabled !== undefined ? (gps_enabled ? 1 : 0) : null,
    accuracy != null ? Math.round(accuracy) : null, battery != null ? Math.round(battery) : null,
    speed != null ? Math.round(speed * 100) / 100 : null, now);
  emitCompany(req.user.company_id, 'gps', { type: 'gps', userId: req.user.id, lat, lng, at: now });
  res.json({ ok: true });
});

// Route history for an executive (check-in/out trail)
router.get('/route/:userId', (req, res) => {
  const uid = req.params.userId;
  if (uid !== req.user.id && !can(req.user, 'gps.view')) return res.status(403).json({ error: 'Forbidden' });
  const visits = all(
    `SELECT v.*, l.name AS lead_name, p.name AS project_name FROM site_visits v
     LEFT JOIN leads l ON l.id=v.lead_id LEFT JOIN projects p ON p.id=v.project_id
     WHERE v.user_id=? AND v.company_id=? AND v.checkin_at IS NOT NULL
     ORDER BY v.checkin_at DESC`, uid, req.user.company_id);
  const attendance = all(
    `SELECT a.*, e.name AS employee_name FROM attendance a
     LEFT JOIN employees e ON e.id=a.employee_id
     WHERE a.company_id=? AND (a.latitude IS NOT NULL) AND e.user_id=? ORDER BY a.date DESC`, req.user.company_id, uid);
  res.json({ visits, attendance });
});

// GPS movement trace for movement reports (gps.view) or self (gps.own)
router.get('/trace', (req, res) => {
  if (!can(req.user, 'gps.view') && !can(req.user, 'gps.own')) return res.status(403).json({ error: 'Forbidden' });
  const scope = gpsScope(req.user);
  const args = [req.user.company_id, ...scope.args];
  const start = req.query.start || ts().slice(0, 10) + 'T00:00:00';
  const end = req.query.end || ts().slice(0, 10) + 'T23:59:59';
  const rows = all(
    `SELECT t.*, u.name AS user_name FROM location_trace t LEFT JOIN users u ON u.id=t.user_id
     WHERE t.company_id=? ${scope.clause ? `AND ${scope.clause}` : ''} AND t.created_at >= ? AND t.created_at <= ?
     ORDER BY t.created_at ASC LIMIT 5000`, ...args, start, end);
  res.json(rows);
});

// Daily visit plan
router.get('/plan', (req, res) => {
  const date = req.query.date || ts().slice(0, 10);
  const scope = userScope(req.user, 'v');
  const args = [req.user.company_id, date, ...scope.args];
  const rows = all(
    `SELECT v.*, l.name AS lead_name, p.name AS project_name, u.name AS user_name FROM site_visits v
     LEFT JOIN leads l ON l.id=v.lead_id LEFT JOIN projects p ON p.id=v.project_id LEFT JOIN users u ON u.id=v.user_id
     WHERE v.company_id=? AND date(v.scheduled_at)=date(?)${scope.clause ? ` AND ${scope.clause}` : ''} ORDER BY v.scheduled_at ASC`,
    ...args);
  res.json({ date, visits: rows });
});

// Missed visit alerts (scheduled in the past, never checked in)
router.get('/missed', (req, res) => {
  const cid = req.user.company_id;
  const scope = userScope(req.user, 'v');
  const args = [cid, ts(), ...scope.args];
  const rows = all(
    `SELECT v.*, l.name AS lead_name, p.name AS project_name, u.name AS user_name FROM site_visits v
     LEFT JOIN leads l ON l.id=v.lead_id LEFT JOIN projects p ON p.id=v.project_id LEFT JOIN users u ON u.id=v.user_id
     WHERE v.company_id=? AND v.status='scheduled' AND v.scheduled_at < ? AND v.missed=0${scope.clause ? ` AND ${scope.clause}` : ''}`,
    ...args);
  res.json({ count: rows.length, rows });
});

// Create a site visit (plan)
router.post('/visits', (req, res) => {
  if (!can(req.user, 'sitevisit.view') && !can(req.user, 'activity.create')) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  if (!b.lead_id || !b.scheduled_at) return res.status(400).json({ error: 'lead_id and scheduled_at required' });
  const vid = id();
  run(`INSERT INTO site_visits (id, company_id, lead_id, project_id, user_id, scheduled_at, status, plan_date, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    vid, req.user.company_id, b.lead_id, b.project_id || null, b.user_id || req.user.id,
    new Date(b.scheduled_at).toISOString(), 'scheduled', (b.scheduled_at || '').slice(0, 10), ts());
  const lead = get('SELECT name FROM leads WHERE id=?', b.lead_id);
  notify(req.user.company_id, b.user_id || req.user.id, 'Site visit planned', `Site visit for ${lead?.name} on ${(b.scheduled_at || '').slice(0, 10)}`);
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'visit.plan', entity: 'site_visit', entity_id: vid, detail: { lead_id: b.lead_id } });
  res.json({ ok: true, id: vid });
});

// Check-in with geo + photo verification
router.post('/visits/:id/checkin', (req, res) => {
  const v = get('SELECT * FROM site_visits WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const distanceKm = (v.latitude && b.latitude) ? haversine(v.latitude, v.longitude, b.latitude, b.longitude) : null;
  run(`UPDATE site_visits SET status='done', checkin_at=?, latitude=?, longitude=?, photo_url=?, distance_km=?, route_points=?, missed=0 WHERE id=?`,
    ts(), b.latitude || v.latitude, b.longitude || v.longitude, b.photo_url || v.photo_url, distanceKm,
    JSON.stringify(b.route_points || []), v.id);
  // also update executive live location
  if (b.latitude) run('UPDATE users SET lat=?, lng=?, last_seen_at=? WHERE id=?', b.latitude, b.longitude, ts(), v.user_id);
  res.json({ ok: true, distance_km: distanceKm ? Math.round(distanceKm * 100) / 100 : null });
});

// Checkout with feedback
router.post('/visits/:id/checkout', (req, res) => {
  const v = get('SELECT * FROM site_visits WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const durationMins = v.checkin_at ? Math.round((Date.now() - new Date(v.checkin_at).getTime()) / 60000) : null;
  run(`UPDATE site_visits SET checkout_at=?, feedback=?, duration_mins=? WHERE id=?`,
    ts(), b.feedback || v.feedback, durationMins, v.id);
  res.json({ ok: true, duration_mins: durationMins });
});

// Manager verification of a visit (geo + photo)
router.post('/visits/:id/verify', (req, res) => {
  if (!can(req.user, 'sitevisit.approve')) return res.status(403).json({ error: 'Forbidden' });
  run(`UPDATE site_visits SET status='verified' WHERE id=? AND company_id=?`, req.params.id, req.user.company_id);
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'visit.verify', entity: 'site_visit', entity_id: req.params.id });
  res.json({ ok: true });
});

// Geo-fenced attendance check-in/out
router.post('/attendance', (req, res) => {
  const b = req.body || {};
  const today = ts().slice(0, 10);
  const emp = get('SELECT * FROM employees WHERE user_id=?', req.user.id);
  const empId = emp ? emp.id : null;
  const existing = get('SELECT * FROM attendance WHERE employee_id=? AND date=?', empId || '', today);
  if (b.action === 'checkin') {
    if (existing) return res.json({ ok: true, msg: 'Already checked in' });
    run(`INSERT INTO attendance (id, company_id, employee_id, date, checkin, latitude, longitude, status, geofenced, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      id(), req.user.company_id, empId, today, new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      b.latitude || null, b.longitude || null, 'present', b.geofenced ? 1 : 0, ts());
  } else {
    if (!existing) return res.status(400).json({ error: 'No check-in found for today' });
    run(`UPDATE attendance SET checkout=?, verified=1 WHERE id=?`,
      new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }), existing.id);
  }
  res.json({ ok: true });
});

// Auto-mark missed scheduled visits (internal helper exposed for managers)
router.post('/mark-missed', (req, res) => {
  if (!can(req.user, 'sitevisit.approve')) return res.status(403).json({ error: 'Forbidden' });
  const rows = all(
    `SELECT * FROM site_visits WHERE company_id=? AND status='scheduled' AND scheduled_at < ?`,
    req.user.company_id, ts());
  for (const v of rows) {
    run(`UPDATE site_visits SET missed=1 WHERE id=?`, v.id);
    notify(req.user.company_id, v.user_id, 'Missed site visit', `You missed a scheduled site visit. Reschedule or update the lead.`, 'alert', 'whatsapp');
  }
  res.json({ ok: true, marked: rows.length });
});

export default router;
