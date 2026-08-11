import { Router } from 'express';
import { get, run, all, ts, id, audit, notify } from '../db.js';
import { hydrate, hydratelist } from '../lib/helpers.js';
import { requireAuth, requirePerm, can } from '../auth.js';
import { paginate, csv, getStages, stageLabel, DEFAULT_STAGES } from '../lib/helpers.js';
import { findDuplicates, scoreLead, suggestNextAction } from '../lib/insights.js';
import { assignLead } from '../lib/assignment.js';
import { companySettings } from '../lib/helpers.js';
import { ownerScope } from '../lib/scope.js';
import { attributeLead } from '../lib/referrals.js';

const router = Router();
router.use(requireAuth);

export const STAGES = DEFAULT_STAGES.map((s) => s.key);
export const STAGE_LABELS = Object.fromEntries(DEFAULT_STAGES.map((s) => [s.key, s.label]));
export const PRIORITIES = ['Hot', 'Warm', 'Cold', 'Lost', 'Junk'];

router.get('/pipeline', (req, res) => {
  if (!can(req.user, 'pipeline.view')) return res.status(403).json({ error: 'Forbidden' });
  const scope = ownerScope(req.user);
  const where = scope.clause ? ` AND ${scope.clause}` : '';
  const args = [req.user.company_id, ...scope.args];
  const stages = getStages(req.user.company_id);
  const rows = all(
    `SELECT * FROM leads WHERE company_id=? ${where}`,
    ...args
  );
  const counts = {};
  const groups = {};
  for (const s of stages) {
    const inGroup = rows.filter((r) => r.status === s.key);
    groups[s.key] = hydratelist(inGroup, ['tags', 'score_reason']);
    counts[s.key] = inGroup.length;
  }
  const labels = Object.fromEntries(stages.map((s) => [s.key, s.label]));
  res.json({ stages: stages.map((s) => ({ key: s.key, label: s.label, color: s.color })), labels, counts, groups });
});

router.get('/', (req, res) => {
  if (!can(req.user, 'lead.view')) return res.status(403).json({ error: 'Forbidden' });
  const { page, limit, offset } = paginate(req);
  const where = ['company_id=?'];
  const args = [req.user.company_id];
  const scope = ownerScope(req.user);
  if (scope.clause) { where.push(scope.clause); args.push(...scope.args); }
  if (req.query.status) { where.push('status=?'); args.push(req.query.status); }
  if (req.query.priority) { where.push('priority=?'); args.push(req.query.priority); }
  if (req.query.source) { where.push('source=?'); args.push(req.query.source); }
  if (req.query.owner_id) { where.push('owner_id=?'); args.push(req.query.owner_id); }
  if (req.query.project) { where.push('project_id IN (SELECT id FROM projects WHERE company_id=? AND name=?)'); args.push(req.user.company_id, req.query.project); }
  if (req.query.city) { where.push('city=?'); args.push(req.query.city); }
  if (req.query.area) { where.push('area=?'); args.push(req.query.area); }
  if (req.query.campaign) { where.push('(utm_campaign=? OR campaign_id IN (SELECT id FROM campaigns WHERE company_id=? AND name=?))'); args.push(req.query.campaign, req.user.company_id, req.query.campaign); }
  if (req.query.from) { where.push('created_at>=?'); args.push(req.query.from); }
  if (req.query.to) { where.push('created_at<=?'); args.push(req.query.to + 'T23:59:59'); }
  if (req.query.q) { where.push('(name LIKE ? OR phone LIKE ? OR email LIKE ?)'); args.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`); }
  const total = get(`SELECT COUNT(*) n FROM leads WHERE ${where.join(' AND ')}`, ...args).n;
  const rows = hydratelist(
    all(`SELECT * FROM leads WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT ? OFFSET ?`, ...args, limit, offset),
    ['tags', 'score_reason']
  );
  res.json({ items: rows, total, page, limit });
});

router.get('/:id', (req, res) => {
  const lead = hydrate(get('SELECT * FROM leads WHERE id=? AND company_id=?', req.params.id, req.user.company_id), ['tags', 'score_reason']);
  if (!lead) return res.status(404).json({ error: 'Not found' });
  const scope = ownerScope(req.user);
  if (scope.clause) {
    const visible = get(`SELECT id FROM leads WHERE id=? AND company_id=? AND ${scope.clause}`, lead.id, req.user.company_id, ...scope.args);
    if (!visible) return res.status(403).json({ error: 'Forbidden' });
  }
  const activities = hydratelist(all('SELECT * FROM activities WHERE lead_id=? ORDER BY created_at DESC', lead.id));
  const visits = all('SELECT * FROM site_visits WHERE lead_id=? ORDER BY scheduled_at DESC', lead.id);
  const duplicates = can(req.user, 'lead.merge') ? findDuplicates(req.user.company_id, lead, lead.id) : [];
  res.json({ lead, activities, visits, duplicates, suggestions: suggestNextAction(lead) });
});

router.post('/', (req, res) => {
  if (!can(req.user, 'lead.create')) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Name required' });

  const settings = companySettings(req.user.company_id);
  const lid = id();
  const stageKeys = getStages(req.user.company_id).map((s) => s.key);
  const status = stageKeys.includes(b.status) ? b.status : 'new_lead';
  const lead = {
    ...b,
    id: lid,
    company_id: req.user.company_id,
    status,
    priority: PRIORITIES.includes(b.priority) ? b.priority : 'Warm',
    tags: Array.isArray(b.tags) ? b.tags : [],
    owner_id: b.owner_id || null,
    created_at: ts(), updated_at: ts()
  };

  // Duplicate detection (if a dup is found and lead is created anyway, mark duplicate_of)
  const dups = findDuplicates(req.user.company_id, lead, '');
  let dupMarked = null;
  if (dups.length && b.autoMerge !== false) {
    dupMarked = dups[0].lead.id;
    run('UPDATE leads SET duplicate_of=?, updated_at=? WHERE id=?', dupMarked, ts(), lid);
  }

  run(`INSERT INTO leads (id, company_id, name, phone, email, source, medium, project_id, city, area, budget, requirement,
        priority, status, owner_id, tags, address, notes, latitude, longitude, campaign_id, utm_source, utm_medium,
        utm_campaign, utm_term, utm_content, landing_page, response_time_mins, last_activity_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    lead.id, lead.company_id, lead.name, lead.phone || null, lead.email || null, lead.source || 'Manual',
    lead.medium || null, lead.project_id || null, lead.city || null, lead.area || null, lead.budget || null,
    lead.requirement || null, lead.priority, lead.status, null, JSON.stringify(lead.tags), lead.address || null,
    lead.notes || null, lead.latitude || null, lead.longitude || null, b.campaign_id || null,
    b.utm_source || null, b.utm_medium || null, b.utm_campaign || null, b.utm_term || null, b.utm_content || null,
    b.landing_page || null, b.response_time_mins || null, lead.created_at, lead.created_at, lead.updated_at);

  // Automatic assignment
  const assigned = assignLead(lead.company_id, { ...lead, id: lid }, settings.assignment || {});
  if (assigned) {
    run('UPDATE leads SET owner_id=?, updated_at=? WHERE id=?', assigned, ts(), lid);
    const owner = get('SELECT name FROM users WHERE id=?', assigned);
    notify(lead.company_id, assigned, 'New lead assigned', `Lead ${lead.name} (${lead.source}) assigned to you`);
  }

  // Score
  const scored = scoreLead(get('SELECT * FROM leads WHERE id=?', lid), lead.company_id);
  run('UPDATE leads SET score=?, score_reason=? WHERE id=?', scored.score, JSON.stringify(scored.reasons), lid);

  if (lead.source && lead.source !== 'Manual') {
    const camp = lead.campaign_id ? get('SELECT * FROM campaigns WHERE id=?', lead.campaign_id)
      : get('SELECT * FROM campaigns WHERE company_id=? AND channel=? ORDER BY created_at DESC LIMIT 1', lead.company_id, lead.source);
    if (camp) run('UPDATE campaigns SET leads_count=leads_count+1 WHERE id=?', camp.id);
  }

  audit({ company_id: lead.company_id, user_id: req.user.id, user_name: req.user.name, action: 'lead.create', entity: 'lead', entity_id: lid, detail: { name: lead.name, source: lead.source, dup: dupMarked } });
  // Referral attribution — if the lead was created with a referral code, reserve the reward.
  if (b.referral_code) {
    try {
      attributeLead(lead.company_id, b.referral_code, lid, lead.name, lead.phone, { amount: b.referral_amount });
    } catch { /* attribution must not break lead creation */ }
  }
  res.json({ ok: true, id: lid, assignedTo: assigned, duplicate_of: dupMarked, duplicates: dups.slice(0, 3), score: scored });
});

router.patch('/:id', (req, res) => {
  if (!can(req.user, 'lead.edit')) return res.status(403).json({ error: 'Forbidden' });
  const lead = get('SELECT * FROM leads WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!lead) return res.status(404).json({ error: 'Not found' });
  if (!can(req.user, 'lead.assign') && lead.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  const fields = ['name', 'phone', 'email', 'source', 'medium', 'project_id', 'city', 'area', 'budget', 'requirement', 'priority', 'status', 'address', 'notes', 'latitude', 'longitude', 'campaign_id', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'landing_page'];
  for (const f of fields) if (req.body[f] !== undefined) run(`UPDATE leads SET ${f}=? WHERE id=?`, req.body[f], lead.id);
  if (req.body.tags !== undefined) run('UPDATE leads SET tags=? WHERE id=?', JSON.stringify(req.body.tags), lead.id);
  run('UPDATE leads SET updated_at=?, last_activity_at=? WHERE id=?', ts(), ts(), lead.id);

  if (req.body.status !== undefined && req.body.status !== lead.status) {
    const n = get('SELECT name FROM users WHERE id=?', lead.owner_id);
    notify(req.user.company_id, lead.owner_id, 'Lead stage updated',
      `${lead.name} moved to ${stageLabel(req.user.company_id, req.body.status)}`);
    audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'lead.stage', entity: 'lead', entity_id: lead.id, detail: { from: lead.status, to: req.body.status } });
  }

  const updated = get('SELECT * FROM leads WHERE id=?', lead.id);
  const scored = scoreLead(updated, req.user.company_id);
  run('UPDATE leads SET score=?, score_reason=? WHERE id=?', scored.score, JSON.stringify(scored.reasons), lead.id);
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'lead.update', entity: 'lead', entity_id: lead.id, detail: Object.keys(req.body || {}) });
  res.json({ ok: true, score: scored });
});

router.delete('/:id', (req, res) => {
  if (!can(req.user, 'lead.delete')) return res.status(403).json({ error: 'Forbidden' });
  run('DELETE FROM leads WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  run('DELETE FROM activities WHERE lead_id=?', req.params.id);
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'lead.delete', entity: 'lead', entity_id: req.params.id });
  res.json({ ok: true });
});

// Assign / transfer lead
router.post('/:id/assign', (req, res) => {
  if (!can(req.user, 'lead.assign') && !can(req.user, 'lead.transfer')) return res.status(403).json({ error: 'Forbidden' });
  const lead = get('SELECT * FROM leads WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!lead) return res.status(404).json({ error: 'Not found' });
  const { owner_id } = req.body || {};
  const newOwner = owner_id || assignLead(req.user.company_id, lead, companySettings(req.user.company_id).assignment || {});
  if (!newOwner) return res.status(400).json({ error: 'No assignable users' });
  run('UPDATE leads SET owner_id=?, updated_at=? WHERE id=?', newOwner, ts(), lead.id);
  const owner = get('SELECT name FROM users WHERE id=?', newOwner);
  notify(req.user.company_id, newOwner, 'Lead assigned', `${lead.name} assigned to you`);
  if (lead.owner_id) notify(req.user.company_id, lead.owner_id, 'Lead transferred', `${lead.name} was transferred to ${owner?.name || 'another user'}`);
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'lead.assign', entity: 'lead', entity_id: lead.id, detail: { from: lead.owner_id, to: newOwner } });
  res.json({ ok: true, owner_id: newOwner });
});

// Merge duplicates
router.post('/:id/merge', (req, res) => {
  if (!can(req.user, 'lead.merge')) return res.status(403).json({ error: 'Forbidden' });
  const primary = get('SELECT * FROM leads WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  const dup = get('SELECT * FROM leads WHERE id=? AND company_id=?', req.body?.with, req.user.company_id);
  if (!primary || !dup) return res.status(404).json({ error: 'Lead not found' });
  // move activities & visits, prefer non-empty fields
  run('UPDATE activities SET lead_id=? WHERE lead_id=?', primary.id, dup.id);
  run('UPDATE site_visits SET lead_id=? WHERE lead_id=?', primary.id, dup.id);
  run('UPDATE customers SET lead_id=? WHERE lead_id=?', primary.id, dup.id);
  const merged = {};
  for (const f of ['phone', 'email', 'source', 'budget', 'requirement', 'project_id', 'city', 'area', 'address', 'notes']) {
    merged[f] = primary[f] || dup[f];
    if (merged[f] !== undefined) run(`UPDATE leads SET ${f}=? WHERE id=?`, merged[f], primary.id);
  }
  run('UPDATE leads SET duplicate_of=?, updated_at=? WHERE id=?', primary.id, ts(), dup.id);
  run(`INSERT INTO lead_merges (id, company_id, primary_lead_id, merged_lead_id, by_user, created_at) VALUES (?,?,?,?,?,?)`,
    id(), req.user.company_id, primary.id, dup.id, req.user.name, ts());
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'lead.merge', entity: 'lead', entity_id: primary.id, detail: { merged: dup.id } });
  res.json({ ok: true, merged: dup.id });
});

// Messages (WhatsApp / email / SMS history) for a lead
router.get('/:id/messages', (req, res) => {
  const lead = get('SELECT * FROM leads WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!lead) return res.status(404).json({ error: 'Not found' });
  const rows = hydratelist(
    all('SELECT * FROM messages WHERE lead_id=? AND company_id=? ORDER BY created_at DESC LIMIT 100', lead.id, req.user.company_id),
    ['meta']);
  res.json({ items: rows });
});

router.post('/:id/messages', (req, res) => {
  const lead = get('SELECT * FROM leads WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!lead) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  if (!b.body) return res.status(400).json({ error: 'body required' });
  const mid = id();
  run(`INSERT INTO messages (id, company_id, lead_id, user_id, channel, direction, body, status, meta, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    mid, req.user.company_id, lead.id, req.user.id, b.channel || 'whatsapp', b.direction || 'outbound',
    b.body, b.status || 'sent', JSON.stringify(b.meta || {}), ts());
  run('UPDATE leads SET last_activity_at=? WHERE id=?', ts(), lead.id);
  if (b.direction === 'outbound') {
    const actId = id();
    run(`INSERT INTO activities (id, company_id, lead_id, user_id, type, subject, note, outcome, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      actId, req.user.company_id, lead.id, req.user.id, b.channel === 'email' ? 'email' : 'whatsapp',
      (b.channel === 'email' ? 'Email sent' : 'WhatsApp message sent'), b.body.slice(0, 120), 'Sent', ts());
  }
  res.json({ ok: true, id: mid });
});

router.post('/:id/messages/bulk', (req, res) => {
  if (!can(req.user, 'activity.create')) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  const ids = Array.isArray(b.lead_ids) ? b.lead_ids : [];
  if (!b.body || !ids.length) return res.status(400).json({ error: 'body and lead_ids required' });
  const channel = b.channel || 'whatsapp';
  let sent = 0;
  for (const lid of ids.slice(0, 500)) {
    run(`INSERT INTO messages (id, company_id, lead_id, user_id, channel, direction, body, status, meta, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      id(), req.user.company_id, lid, req.user.id, channel, 'outbound', b.body, 'sent', '{}', ts());
    run('UPDATE leads SET last_activity_at=? WHERE id=?', ts(), lid);
    sent++;
  }
  res.json({ ok: true, sent });
});

// CSV import
router.post('/import', (req, res) => {
  if (!can(req.user, 'lead.import')) return res.status(403).json({ error: 'Forbidden' });
  const { rows } = req.body || {};
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows array required' });
  let created = 0;
  for (const r of rows.slice(0, 2000)) {
    if (!r.name) continue;
    run(`INSERT INTO leads (id, company_id, name, phone, email, source, city, area, budget, requirement, priority, status, tags, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id(), req.user.company_id, r.name, r.phone || null, r.email || null, r.source || 'CSV Import', r.city || null,
      r.area || null, r.budget || null, r.requirement || null, 'Warm', 'new_lead', '[]', ts(), ts());
    created++;
  }
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'lead.import', entity: 'lead', entity_id: req.user.company_id, detail: { count: created } });
  res.json({ ok: true, created });
});

// Export CSV
router.get('/export/csv', (req, res) => {
  if (!can(req.user, 'lead.export')) return res.status(403).json({ error: 'Forbidden' });
  const scope = ownerScope(req.user);
  const extra = [];
  const args = [req.user.company_id, ...scope.args];
  if (scope.clause) extra.push(scope.clause);
  if (req.query.source) { extra.push('source=?'); args.push(req.query.source); }
  if (req.query.status) { extra.push('status=?'); args.push(req.query.status); }
  if (req.query.priority) { extra.push('priority=?'); args.push(req.query.priority); }
  if (req.query.owner_id) { extra.push('owner_id=?'); args.push(req.query.owner_id); }
  if (req.query.project) { extra.push('project_id IN (SELECT id FROM projects WHERE company_id=? AND name=?)'); args.push(req.user.company_id, req.query.project); }
  if (req.query.city) { extra.push('city=?'); args.push(req.query.city); }
  if (req.query.area) { extra.push('area=?'); args.push(req.query.area); }
  if (req.query.from) { extra.push('created_at>=?'); args.push(req.query.from); }
  if (req.query.to) { extra.push('created_at<=?'); args.push(req.query.to + 'T23:59:59'); }
  const rows = all(`SELECT * FROM leads WHERE company_id=? ${extra.length ? 'AND ' + extra.join(' AND ') : ''}`, ...args);
  const data = rows.map((l) => ({
    Name: l.name, Phone: l.phone, Email: l.email, Source: l.source, Priority: l.priority,
    Stage: stageLabel(req.user.company_id, l.status), Score: l.score, Budget: l.budget, City: l.city, Area: l.area,
    'UTM Campaign': l.utm_campaign || '', Source: l.source,
    Created: l.created_at
  }));
  const cols = Object.keys(data[0] || {}).map((k) => ({ label: k, accessor: (r) => r[k] }));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
  res.send(csv(data, cols));
});

export default router;
