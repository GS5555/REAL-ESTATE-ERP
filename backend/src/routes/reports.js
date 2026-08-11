import { Router } from 'express';
import { get, all, run, ts, id, audit } from '../db.js';
import { hydratelist } from '../lib/helpers.js';
import { requireAuth, requirePerm, can } from '../auth.js';
import { csv, getStages, stageLabel, BOOKED_STATUSES } from '../lib/helpers.js';
import { forecast, forecastWindows } from '../lib/insights.js';
import { ownerScope, userScope } from '../lib/scope.js';

const router = Router();
router.use(requireAuth);

function scopedUserIds(req) {
  if (can(req.user, 'lead.assign')) return null; // all
  return [req.user.id];
}

const ACTIVE_KEYS = ['new_lead', 'contacted', 'interested', 'site_visit_scheduled', 'site_visit_completed', 'negotiation', 'booking', 'payment', 'registered', 'won'];

router.get('/dashboard', (req, res) => {
  if (!can(req.user, 'dashboard.view')) return res.status(403).json({ error: 'Forbidden' });
  const cid = req.user.company_id;
  const scope = ownerScope(req.user);
  const ownerFilter = scope.clause ? ` AND ${scope.clause}` : '';
  const ownerArgs = scope.args;

  const total = get(`SELECT COUNT(*) n FROM leads WHERE company_id=?${ownerFilter}`, cid, ...ownerArgs).n;
  const hot = get(`SELECT COUNT(*) n FROM leads WHERE company_id=? AND priority='Hot'${ownerFilter}`, cid, ...ownerArgs).n;
  const newToday = get(`SELECT COUNT(*) n FROM leads WHERE company_id=? AND created_at>=?${ownerFilter}`, cid, ts().slice(0, 10), ...ownerArgs).n;
  const booked = get(`SELECT COUNT(*) n FROM leads WHERE company_id=? AND status IN (${BOOKED_STATUSES.map(() => '?').join(',')})${ownerFilter}`, cid, ...BOOKED_STATUSES, ...ownerArgs).n;
  const lost = get(`SELECT COUNT(*) n FROM leads WHERE company_id=? AND status='lost'${ownerFilter}`, cid, ...ownerArgs).n;
  const active = total ? (booked / total) * 100 : 0;

  const stageRows = all(`SELECT status, COUNT(*) n FROM leads WHERE company_id=?${ownerFilter} GROUP BY status`, cid, ...ownerArgs);
  const stages = getStages(cid);
  const funnel = stages
    .filter((s) => !s.is_lost)
    .map((s) => ({ stage: s.key, label: s.label, color: s.color, count: stageRows.find((r) => r.status === s.key)?.n || 0 }));

  const sources = all(`SELECT source, COUNT(*) n FROM leads WHERE company_id=?${ownerFilter} GROUP BY source ORDER BY n DESC LIMIT 10`, cid, ...ownerArgs);

  const recent = all(
    `SELECT a.*, l.name AS lead_name FROM activities a LEFT JOIN leads l ON l.id=a.lead_id
     WHERE a.company_id=? ORDER BY a.created_at DESC LIMIT 8`, cid);

  const actScope = userScope(req.user, 'a');
  const followups = all(
    `SELECT a.*, l.name AS lead_name FROM activities a LEFT JOIN leads l ON l.id=a.lead_id
     WHERE a.company_id=? AND a.done_at IS NULL AND a.scheduled_at IS NOT NULL${actScope.clause ? ` AND ${actScope.clause}` : ''}
     ORDER BY a.scheduled_at ASC LIMIT 8`, cid, ...actScope.args);

  const collected = get(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE company_id=? AND status='received'`, cid).s;

  const trend = [];
  for (let w = 7; w >= 0; w--) {
    const d = new Date(Date.now() - w * 7 * 86400000);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()).toISOString().slice(0, 10);
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay() + 7).toISOString().slice(0, 10);
    const n = get(`SELECT COUNT(*) n FROM leads WHERE company_id=? AND created_at>=? AND created_at<?${ownerFilter}`, cid, start, end, ...ownerArgs).n;
    trend.push({ week: start, count: n });
  }

  const execs = all(
    `SELECT u.id, u.name, u.role,
       (SELECT COUNT(*) FROM leads l WHERE l.owner_id=u.id AND l.company_id=?) my_leads,
       (SELECT COUNT(*) FROM leads l WHERE l.owner_id=u.id AND l.company_id=? AND l.status IN (${BOOKED_STATUSES.map(() => '?').join(',')})) my_bookings,
       (SELECT COUNT(*) FROM site_visits v WHERE v.user_id=u.id AND v.company_id=?) my_visits
     FROM users u WHERE u.company_id=? AND u.active=1 AND u.role IN ('sales_executive','telecaller','team_leader','sales_manager')`,
    cid, cid, ...BOOKED_STATUSES, cid, cid);

  // --- new manager/exec widgets ---
  const responseAvg = get(`SELECT AVG(response_time_mins) a FROM leads WHERE company_id=? AND response_time_mins IS NOT NULL${ownerFilter}`, cid, ...ownerArgs).a || 0;
  const missedFollowups = get(`SELECT COUNT(*) n FROM activities a WHERE a.company_id=? AND a.done_at IS NULL AND a.scheduled_at IS NOT NULL AND a.scheduled_at < ?${actScope.clause ? ` AND ${actScope.clause}` : ''}`, cid, ts(), ...actScope.args).n;

  const aging = [];
  const buckets = [[0, 7, '0-7 days'], [7, 15, '7-15 days'], [15, 30, '15-30 days'], [30, 60, '30-60 days'], [60, 99999, '60+ days']];
  const agingRows = all(`SELECT created_at FROM leads WHERE company_id=? AND status NOT IN ('won','lost','cancelled')${ownerFilter}`, cid, ...ownerArgs);
  for (const [lo, hi, label] of buckets) {
    const n = agingRows.filter((r) => { const age = (Date.now() - new Date(r.created_at).getTime()) / 86400000; return age >= lo && age < hi; }).length;
    aging.push({ label, count: n });
  }

  const convByExec = execs.map((e) => ({ name: e.name, leads: e.my_leads, bookings: e.my_bookings, conversion: e.my_leads ? Math.round((e.my_bookings / e.my_leads) * 100) : 0 }));
  const convByProject = all(
    `SELECT COALESCE(p.name,'(none)') name, COUNT(*) n,
       SUM(CASE WHEN l.status IN (${BOOKED_STATUSES.map(() => '?').join(',')}) THEN 1 ELSE 0 END) bookings
     FROM leads l LEFT JOIN projects p ON p.id=l.project_id WHERE l.company_id=?${ownerFilter}
     GROUP BY p.name`, ...BOOKED_STATUSES, cid, ...ownerArgs)
    .map((r) => ({ name: r.name, leads: r.n, bookings: r.bookings, conversion: r.n ? Math.round((r.bookings / r.n) * 100) : 0 }));

  const today = ts().slice(0, 10);
  const ranking = all(
    `SELECT u.name, u.role,
       (SELECT COUNT(*) FROM activities a WHERE a.user_id=u.id AND a.done_at IS NOT NULL AND a.done_at>=?) acts,
       (SELECT COUNT(*) FROM site_visits v WHERE v.user_id=u.id AND v.checkin_at IS NOT NULL AND v.checkin_at>=?) visits,
       (SELECT COUNT(*) FROM leads l WHERE l.owner_id=u.id AND l.created_at>=?) new_leads
     FROM users u WHERE u.company_id=? AND u.active=1 AND u.role IN ('sales_executive','telecaller','team_leader','sales_manager')`,
    today, today, today, cid).map((r) => ({ ...r, score: r.acts + r.visits * 3 + r.new_leads })).sort((a, b) => b.score - a.score).slice(0, 10);

  res.json({
    kpis: { total, hot, newToday, bookings: booked, lost, active: Math.round(active), collected, responseAvg: Math.round(responseAvg), missedFollowups },
    funnel, sources, recent, followups, trend, execs,
    aging, convByExec, convByProject, ranking,
    forecast: forecast(cid), forecastWindows: forecastWindows(cid)
  });
});

router.get('/dashboard/widgets', (req, res) => {
  if (!can(req.user, 'dashboard.custom') && !can(req.user, 'dashboard.view')) return res.status(403).json({ error: 'Forbidden' });
  const cid = req.user.company_id;
  const scope = ownerScope(req.user);
  const ownerFilter = scope.clause ? ` AND ${scope.clause}` : '';
  const ownerArgs = scope.args;

  const projectWise = all(
    `SELECT COALESCE(p.name,'(none)') name, COUNT(*) n FROM leads l LEFT JOIN projects p ON p.id=l.project_id
     WHERE l.company_id=?${ownerFilter} GROUP BY p.name ORDER BY n DESC LIMIT 8`, cid, ...ownerArgs);
  const areaWise = all(
    `SELECT COALESCE(area,'(none)') name, COUNT(*) n FROM leads WHERE company_id=?${ownerFilter} GROUP BY area ORDER BY n DESC LIMIT 8`, cid, ...ownerArgs);
  const conv = all(
    `SELECT status, COUNT(*) n FROM leads WHERE company_id=?${ownerFilter} GROUP BY status`, cid, ...ownerArgs);
  res.json({ projectWise, areaWise, conversion: conv });
});

// ---- Reports ----
router.get('/reports/lead', (req, res) => {
  if (!can(req.user, 'report.view')) return res.status(403).json({ error: 'Forbidden' });
  const cid = req.user.company_id;
  const scope = ownerScope(req.user);
  const { from, to } = req.query;
  const filter = [];
  const args = [cid];
  if (scope.clause) { filter.push(scope.clause); args.push(...scope.args); }
  if (from) { filter.push('created_at>=?'); args.push(from); }
  if (to) { filter.push('created_at<=?'); args.push(to); }
  const rows = all(`SELECT * FROM leads WHERE company_id=? ${filter.length ? 'AND ' + filter.join(' AND ') : ''}`, ...args);
  const total = rows.length;
  const bySource = {};
  const byStage = {};
  for (const l of rows) {
    bySource[l.source] = (bySource[l.source] || 0) + 1;
    byStage[l.status] = (byStage[l.status] || 0) + 1;
  }
  const bookings = rows.filter((l) => BOOKED_STATUSES.includes(l.status)).length;
  const conversionRate = total ? (bookings / total) * 100 : 0;
  const closed = all(`SELECT created_at, updated_at FROM leads WHERE company_id=? AND status IN ('won','registered','payment','booking')`, cid);
  const avgClosingTime = closed.length ? closed.reduce((s, r) => s + (new Date(r.updated_at) - new Date(r.created_at)) / 86400000, 0) / closed.length : 0;
  const avgCloseBySource = [];
  for (const src of Object.keys(bySource)) {
    const cl = closed.filter((r) => { const l = rows.find((x) => x.id === r.id); return false; });
    void cl;
    avgCloseBySource.push({ source: src, avgDays: null });
  }
  res.json({
    total, bookings, conversionRate: Math.round(conversionRate * 10) / 10,
    avgClosingDays: Math.round(avgClosingTime), bySource, byStage,
    sourceList: Object.entries(bySource).sort((a, b) => b[1] - a[1]),
    stageList: Object.entries(byStage).map(([k, v]) => [stageLabel(cid, k), v])
  });
});

router.get('/reports/executive', (req, res) => {
  if (!can(req.user, 'report.view')) return res.status(403).json({ error: 'Forbidden' });
  const cid = req.user.company_id;
  const rows = all(
    `SELECT u.id, u.name, u.role,
       (SELECT COUNT(*) FROM leads l WHERE l.owner_id=u.id) leads,
       (SELECT COUNT(*) FROM activities a WHERE a.user_id=u.id) activities,
       (SELECT COUNT(*) FROM site_visits v WHERE v.user_id=u.id) visits,
       (SELECT COUNT(*) FROM leads l WHERE l.owner_id=u.id AND l.status IN (${BOOKED_STATUSES.map(() => '?').join(',')})) bookings
     FROM users u WHERE u.company_id=? AND u.active=1 AND u.role IN ('sales_executive','telecaller','team_leader','sales_manager')`,
    ...BOOKED_STATUSES, cid);
  res.json(rows.map((r) => ({ ...r, conversion: r.leads ? Math.round((r.bookings / r.leads) * 100) : 0 })));
});

router.get('/reports/revenue', (req, res) => {
  if (!can(req.user, 'finance.view') && !can(req.user, 'report.view')) return res.status(403).json({ error: 'Forbidden' });
  const cid = req.user.company_id;
  const payments = all('SELECT * FROM payments WHERE company_id=? AND status=?', cid, 'received');
  const monthly = {};
  for (const p of payments) {
    const k = (p.date || '').slice(0, 7);
    monthly[k] = (monthly[k] || 0) + p.amount;
  }
  const total = payments.reduce((s, p) => s + p.amount, 0);
  const bookings = get('SELECT COUNT(*) n FROM bookings WHERE company_id=?', cid).n;
  res.json({ total, bookings, monthly: Object.entries(monthly).sort().map(([m, v]) => ({ month: m, value: v })) });
});

router.get('/reports/funnel', (req, res) => {
  if (!can(req.user, 'report.view')) return res.status(403).json({ error: 'Forbidden' });
  const cid = req.user.company_id;
  const scope = ownerScope(req.user);
  const rows = all(`SELECT status, COUNT(*) n FROM leads WHERE company_id=? ${scope.clause ? `AND ${scope.clause}` : ''} GROUP BY status`, cid, ...scope.args);
  const funnel = getStages(cid).map((s) => ({ stage: s.key, label: s.label, color: s.color, count: rows.find((r) => r.status === s.key)?.n || 0 }));
  res.json(funnel);
});

router.get('/reports/source', (req, res) => {
  if (!can(req.user, 'report.view')) return res.status(403).json({ error: 'Forbidden' });
  const cid = req.user.company_id;
  const scope = ownerScope(req.user);
  const rows = all(
    `SELECT source, COUNT(*) total,
       SUM(CASE WHEN status IN (${BOOKED_STATUSES.map(() => '?').join(',')}) THEN 1 ELSE 0 END) bookings,
       COALESCE(SUM(CASE WHEN status IN (${BOOKED_STATUSES.map(() => '?').join(',')}) THEN budget ELSE 0 END),0) revenue
     FROM leads WHERE company_id=?${scope.clause ? ` AND ${scope.clause}` : ''} GROUP BY source ORDER BY total DESC`,
    ...BOOKED_STATUSES, ...BOOKED_STATUSES, cid, ...scope.args);
  res.json(rows.map((r) => ({ ...r, conversion: r.total ? Math.round((r.bookings / r.total) * 100) : 0 })));
});

router.get('/reports/commission', (req, res) => {
  if (!can(req.user, 'commission.view')) return res.status(403).json({ error: 'Forbidden' });
  const rows = all(
    `SELECT c.*, p.name AS partner_name, u.number AS unit_number FROM commissions c
     LEFT JOIN partners p ON p.id=c.partner_id LEFT JOIN bookings b ON b.id=c.booking_id
     LEFT JOIN units u ON u.id=b.unit_id WHERE c.company_id=?`, req.user.company_id);
  const pending = rows.filter((r) => r.status === 'pending').reduce((s, r) => s + r.amount, 0);
  const paid = rows.filter((r) => r.status === 'paid').reduce((s, r) => s + r.amount, 0);
  res.json({ rows, pending, paid });
});

// ---- Extended reports (spec) ----
router.get('/reports/visit-success', (req, res) => {
  if (!can(req.user, 'report.view')) return res.status(403).json({ error: 'Forbidden' });
  const cid = req.user.company_id;
  const rows = all('SELECT * FROM site_visits WHERE company_id=?', cid);
  const scheduled = rows.length;
  const completed = rows.filter((r) => r.status === 'done' && r.checkin_at).length;
  const rate = scheduled ? Math.round((completed / scheduled) * 100) : 0;
  res.json({ scheduled, completed, rate, byProject: [] });
});

router.get('/reports/lost', (req, res) => {
  if (!can(req.user, 'report.view')) return res.status(403).json({ error: 'Forbidden' });
  const cid = req.user.company_id;
  const rows = all(
    `SELECT l.*, u.name owner FROM leads l LEFT JOIN users u ON u.id=l.owner_id
     WHERE l.company_id=? AND l.status='lost'`, cid);
  const byReason = {};
  for (const l of rows) {
    const reason = (l.notes && l.notes.toLowerCase().includes('price')) ? 'Price' :
      (l.notes && l.notes.toLowerCase().includes('location')) ? 'Location' :
      (l.priority === 'Cold') ? 'Low interest' : 'Other';
    byReason[reason] = (byReason[reason] || 0) + 1;
  }
  res.json({ total: rows.length, byReason: Object.entries(byReason).map(([reason, count]) => ({ reason, count })), rows: rows.map((l) => ({ id: l.id, name: l.name, source: l.source, owner: l.owner, reason: 'Other' })) });
});

router.get('/reports/growth', (req, res) => {
  if (!can(req.user, 'report.view')) return res.status(403).json({ error: 'Forbidden' });
  const cid = req.user.company_id;
  const leads = all('SELECT created_at, status FROM leads WHERE company_id=?', cid);
  const months = {};
  for (const l of leads) {
    const k = l.created_at.slice(0, 7);
    months[k] = months[k] || { month: k, leads: 0, bookings: 0 };
    months[k].leads++;
    if (BOOKED_STATUSES.includes(l.status)) months[k].bookings++;
  }
  res.json(Object.values(months).sort((a, b) => a.month.localeCompare(b.month)));
});

router.get('/reports/heatmap', (req, res) => {
  if (!can(req.user, 'report.view')) return res.status(403).json({ error: 'Forbidden' });
  const cid = req.user.company_id;
  const rows = all(
    `SELECT COALESCE(area,'(none)') area, COALESCE(city,'(none)') city, COUNT(*) n,
       SUM(CASE WHEN status IN (${BOOKED_STATUSES.map(() => '?').join(',')}) THEN 1 ELSE 0 END) bookings
     FROM leads WHERE company_id=? GROUP BY area, city ORDER BY n DESC`,
    ...BOOKED_STATUSES, cid);
  res.json(rows.map((r) => ({ ...r, intensity: Math.min(100, Math.round((r.n / Math.max(1, rows[0]?.n)) * 100)) })));
});

// Custom report builder: dim = source|area|project|exec|stage|city, metric = count|revenue|bookings
router.get('/reports/custom', (req, res) => {
  if (!can(req.user, 'report.view')) return res.status(403).json({ error: 'Forbidden' });
  const cid = req.user.company_id;
  const dim = req.query.dim || 'source';
  const metric = req.query.metric || 'count';
  const joins = { project: 'LEFT JOIN projects p ON p.id=l.project_id', exec: 'LEFT JOIN users u ON u.id=l.owner_id' };
  const select = {
    source: "COALESCE(l.source,'(none)') label",
    area: "COALESCE(l.area,'(none)') label",
    city: "COALESCE(l.city,'(none)') label",
    project: "COALESCE(p.name,'(none)') label",
    exec: "COALESCE(u.name,'(none)') label",
    stage: 'l.status label'
  };
  if (!select[dim]) return res.status(400).json({ error: 'invalid dim' });
  const j = joins[dim] || '';
  let sql = `SELECT ${select[dim]}, COUNT(*) n`;
  if (metric === 'revenue' || metric === 'bookings') sql += `, SUM(CASE WHEN l.status IN (${BOOKED_STATUSES.map(() => '?').join(',')}) THEN 1 ELSE 0 END) booked`;
  sql += ` FROM leads l ${j} WHERE l.company_id=? GROUP BY label ORDER BY n DESC`;
  const params = metric === 'revenue' || metric === 'bookings' ? [...BOOKED_STATUSES, cid] : [cid];
  let rows = all(sql, ...params);
  if (dim === 'stage') rows = rows.map((r) => ({ ...r, label: stageLabel(cid, r.label), key: r.label }));
  const data = rows.map((r) => {
    const value = metric === 'revenue' ? r.booked * 15000000 : metric === 'bookings' ? r.booked : r.n;
    return { dimension: r.label, value, key: r.key || null };
  });
  if (req.query.export === 'csv') {
    const cols = Object.keys(data[0] || {}).map((k) => ({ label: k, accessor: (x) => x[k] }));
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="custom_report.csv"');
    return res.send(csv(data, cols));
  }
  res.json(data);
});

router.get('/reports/export', (req, res) => {
  if (!can(req.user, 'report.export')) return res.status(403).json({ error: 'Forbidden' });
  const kind = req.query.kind || 'leads';
  const cid = req.user.company_id;
  if (kind === 'leads') {
    const rows = all('SELECT * FROM leads WHERE company_id=?', cid);
    const data = rows.map((l) => ({ Name: l.name, Phone: l.phone, Email: l.email, Source: l.source, Stage: stageLabel(cid, l.status), Priority: l.priority, Score: l.score, Budget: l.budget, UTM: l.utm_campaign || '', Created: l.created_at }));
    return sendCsv(res, data, 'leads_report.csv');
  }
  if (kind === 'payments') {
    const rows = all('SELECT * FROM payments WHERE company_id=?', cid);
    const data = rows.map((p) => ({ Receipt: p.receipt_no, Date: p.date, Amount: p.amount, Mode: p.mode, Status: p.status }));
    return sendCsv(res, data, 'payments_report.csv');
  }
  if (kind === 'bookings') {
    const rows = all('SELECT * FROM bookings WHERE company_id=?', cid);
    const data = rows.map((b) => ({ Booking: b.id, Value: b.total_value, Token: b.token_amount, Status: b.status, RERA: b.rera_ref, Created: b.created_at }));
    return sendCsv(res, data, 'bookings_report.csv');
  }
  res.status(400).json({ error: 'unknown kind' });
});

function sendCsv(res, data, filename) {
  const cols = Object.keys(data[0] || {}).map((k) => ({ label: k, accessor: (r) => r[k] }));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv(data, cols));
}

export default router;
