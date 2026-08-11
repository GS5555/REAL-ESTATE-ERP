import { Router } from 'express';
import { get, run, all, ts, id, audit, notify } from '../db.js';
import { hydrate, hydratelist } from '../lib/helpers.js';
import { requireAuth, requirePerm, can, hashPw, issueApiKey } from '../auth.js';
import { ROLES, ROLE_LABELS, DEFAULT_PERMISSIONS, PERMISSION_CATALOG, normalizePerms } from '../rbac.js';
import { accessibleUserIds } from '../lib/scope.js';

const router = Router();
router.use(requireAuth);

const ADMIN_ROLES = ['super_admin', 'company_admin', 'director'];

// super_admin manages roles per company: fall back to first company if none implied
function roleCompanyId(req) {
  if (req.user.company_id) return req.user.company_id;
  const first = get('SELECT id FROM companies ORDER BY created_at LIMIT 1');
  return first ? first.id : null;
}

function settingsOf(co) {
  return hydrate(co, ['settings']).settings || {};
}

// ---- Company settings / white-label branding ----
router.get('/settings', (req, res) => {
  if (!can(req.user, 'settings.view')) return res.status(403).json({ error: 'Forbidden' });
  const co = get('SELECT * FROM companies WHERE id=?', req.user.company_id);
  res.json(hydrate(co, ['settings']));
});

router.put('/settings', (req, res) => {
  if (!can(req.user, 'settings.edit')) return res.status(403).json({ error: 'Forbidden' });
  const co = get('SELECT * FROM companies WHERE id=?', req.user.company_id);
  const current = settingsOf(co);
  const next = { ...current, ...(req.body || {}) };
  run('UPDATE companies SET settings=? WHERE id=?', JSON.stringify(next), req.user.company_id);
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'settings.update', entity: 'company', entity_id: req.user.company_id, detail: Object.keys(req.body || {}) });
  res.json({ ok: true, settings: next });
});

// ---- Users ----
router.get('/users', (req, res) => {
  if (!can(req.user, 'settings.users') && !ADMIN_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  let rows;
  if (req.user.role === 'super_admin') {
    rows = all('SELECT * FROM users ORDER BY created_at DESC');
  } else {
    const ids = accessibleUserIds(req.user);
    rows = ids
      ? all(`SELECT * FROM users WHERE company_id=? AND id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at DESC`, req.user.company_id, ...ids)
      : all('SELECT * FROM users WHERE company_id=? ORDER BY created_at DESC', req.user.company_id);
  }
  res.json(rows.map((u) => { const x = { ...u }; delete x.password_hash; return hydrate(x, ['meta']); }));
});

router.post('/users', (req, res) => {
  if (!can(req.user, 'settings.users') && !ADMIN_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const { name, email, phone, password, role, company_id, meta, active } = req.body || {};
  if (!name || !password) return res.status(400).json({ error: 'Name and password required' });
  const validRole = ROLES.includes(role) || !!get('SELECT 1 FROM custom_roles WHERE company_id=? AND role=?', req.user.company_id, role);
  if (!validRole) return res.status(400).json({ error: 'Invalid role' });
  const cid = req.user.role === 'super_admin' && company_id ? company_id : req.user.company_id;
  if (req.user.role !== 'super_admin' && role === 'super_admin') return res.status(403).json({ error: 'Cannot create super admin' });
  const uid = id();
  run(`INSERT INTO users (id,company_id,name,email,phone,password_hash,role,active,mfa_enabled,meta,created_at)
       VALUES (?,?,?,?,?,?,?,?,0,?,?)`,
    uid, cid, name, email || null, phone || null, hashPw(password), role, active === false ? 0 : 1,
    JSON.stringify(meta || {}), ts());
  audit({ company_id: cid, user_id: req.user.id, user_name: req.user.name, action: 'user.create', entity: 'user', entity_id: uid, detail: { name, role } });
  res.json({ ok: true, id: uid });
});

router.patch('/users/:id', (req, res) => {
  if (!can(req.user, 'settings.users') && !ADMIN_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const u = get('SELECT * FROM users WHERE id=?', req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'super_admin' && u.company_id !== req.user.company_id) return res.status(403).json({ error: 'Forbidden' });
  const { name, email, phone, role, active, mfa_enabled, password, meta, device_id } = req.body || {};
  if (name !== undefined) run('UPDATE users SET name=? WHERE id=?', name, u.id);
  if (email !== undefined) run('UPDATE users SET email=? WHERE id=?', email || null, u.id);
  if (phone !== undefined) run('UPDATE users SET phone=? WHERE id=?', phone || null, u.id);
  if (role !== undefined && role !== 'super_admin') {
    const validRole = ROLES.includes(role) || !!get('SELECT 1 FROM custom_roles WHERE company_id=? AND role=?', roleCompanyId(req), role);
    if (validRole) run('UPDATE users SET role=? WHERE id=?', role, u.id);
  }
  if (active !== undefined) run('UPDATE users SET active=? WHERE id=?', active ? 1 : 0, u.id);
  if (mfa_enabled !== undefined) run('UPDATE users SET mfa_enabled=? WHERE id=?', mfa_enabled ? 1 : 0, u.id);
  if (device_id !== undefined) run('UPDATE users SET device_id=? WHERE id=?', device_id, u.id);
  if (password) run('UPDATE users SET password_hash=? WHERE id=?', hashPw(password), u.id);
  if (meta !== undefined) run('UPDATE users SET meta=? WHERE id=?', JSON.stringify(meta), u.id);
  audit({ company_id: u.company_id, user_id: req.user.id, user_name: req.user.name, action: 'user.update', entity: 'user', entity_id: u.id, detail: { name } });
  res.json({ ok: true });
});

// ---- Roles & permission configuration ----
// catalog entries are augmented with `action` (last segment of the key) so the
// UI can render compact header labels like "Lv" (Leads · view).
function catalogWithAction() {
  return PERMISSION_CATALOG.map((p) => ({
    ...p,
    action: (p.key.split('.')[1] || '').slice(0, 4)
  }));
}

router.get('/roles', (req, res) => {
  if (!can(req.user, 'settings.users') && !ADMIN_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const cid = roleCompanyId(req);
  const list = ROLES.filter((r) => r !== 'super_admin');
  const overrides = all('SELECT role, perms FROM role_perms WHERE company_id=?', cid);
  const overrideMap = Object.fromEntries(overrides.map((o) => [o.role, JSON.parse(o.perms)]));
  const customs = all('SELECT * FROM custom_roles WHERE company_id=?', cid);
  const allRoles = [
    ...list.map((r) => ({ role: r, label: ROLE_LABELS[r], custom: false, permissions: overrideMap[r] || DEFAULT_PERMISSIONS[r] || [] })),
    ...customs.map((c) => ({ role: c.role, label: c.label, custom: true, permissions: normalizePerms(JSON.parse(c.perms)) }))
  ];
  res.json({ roles: allRoles, catalog: catalogWithAction() });
});

router.post('/roles', (req, res) => {
  if (!can(req.user, 'settings.users') && !ADMIN_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const cid = roleCompanyId(req);
  const { label, permissions } = req.body || {};
  if (!label || !String(label).trim()) return res.status(400).json({ error: 'Role title required' });
  const perms = normalizePerms(Array.isArray(permissions) ? permissions : []);
  const role = `custom_${id().slice(0, 8)}`;
  run('INSERT INTO custom_roles (company_id, role, label, perms, created_at) VALUES (?,?,?,?,?)',
    cid, role, String(label).trim(), JSON.stringify(perms), ts());
  audit({ company_id: cid, user_id: req.user.id, user_name: req.user.name, action: 'role.create', entity: 'role', entity_id: role, detail: { label } });
  res.json({ ok: true, role, label: String(label).trim(), permissions: perms });
});

router.put('/roles/:role', (req, res) => {
  if (!can(req.user, 'settings.users') && !ADMIN_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const cid = roleCompanyId(req);
  const { role } = req.params;
  const custom = get('SELECT * FROM custom_roles WHERE company_id=? AND role=?', cid, role);
  if (custom) {
    const perms = normalizePerms(req.body?.permissions);
    const label = req.body?.label !== undefined ? String(req.body.label).trim() : custom.label;
    run('UPDATE custom_roles SET label=?, perms=? WHERE company_id=? AND role=?', label, JSON.stringify(perms), cid, role);
    audit({ company_id: cid, user_id: req.user.id, user_name: req.user.name, action: 'role.update', entity: 'role', entity_id: role, detail: { label, permissions: perms } });
    return res.json({ ok: true, role, label, permissions: perms });
  }
  if (!ROLES.includes(role) || role === 'super_admin') return res.status(400).json({ error: 'Invalid role' });
  const perms = normalizePerms(req.body?.permissions);
  run(`INSERT INTO role_perms (company_id, role, perms) VALUES (?,?,?)
       ON CONFLICT(company_id,role) DO UPDATE SET perms=excluded.perms`,
    cid, role, JSON.stringify(perms));
  audit({ company_id: cid, user_id: req.user.id, user_name: req.user.name, action: 'role.update', entity: 'role', entity_id: role, detail: { permissions: perms } });
  res.json({ ok: true, role, permissions: perms });
});

router.delete('/roles/:role', (req, res) => {
  if (!can(req.user, 'settings.users') && !ADMIN_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const cid = roleCompanyId(req);
  const { role } = req.params;
  const custom = get('SELECT * FROM custom_roles WHERE company_id=? AND role=?', cid, role);
  if (!custom) return res.status(404).json({ error: 'Custom role not found' });
  run('DELETE FROM custom_roles WHERE company_id=? AND role=?', cid, role);
  run('UPDATE users SET role=? WHERE company_id=? AND role=?', 'sales_executive', cid, role);
  audit({ company_id: cid, user_id: req.user.id, user_name: req.user.name, action: 'role.delete', entity: 'role', entity_id: role });
  res.json({ ok: true });
});

// ---- API keys ----
router.get('/api-keys', (req, res) => {
  if (!can(req.user, 'api.key') && !ADMIN_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const rows = all('SELECT id, name, scopes, last_used, created_at FROM api_keys WHERE company_id=?', req.user.company_id);
  res.json(rows);
});

router.post('/api-keys', (req, res) => {
  if (!can(req.user, 'api.key') && !ADMIN_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const { name, scopes } = req.body || {};
  const key = issueApiKey();
  run(`INSERT INTO api_keys (id, company_id, name, key_hash, scopes, created_at) VALUES (?,?,?,?,?,?)`,
    id(), req.user.company_id, name || 'API Key', key, JSON.stringify(scopes || ['lead.import']), ts());
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'apikey.create', entity: 'apikey', entity_id: req.user.company_id, detail: { name } });
  res.json({ ok: true, key });
});

// ---- Notifications ----
router.get('/notifications', (req, res) => {
  const rows = all('SELECT * FROM notifications WHERE company_id=? AND user_id=? ORDER BY created_at DESC LIMIT 100',
    req.user.company_id, req.user.id);
  const unread = get('SELECT COUNT(*) n FROM notifications WHERE company_id=? AND user_id=? AND read=0',
    req.user.company_id, req.user.id);
  res.json({ items: hydratelist(rows), unread: unread.n });
});

router.post('/notifications/read', (req, res) => {
  const { id: nid } = req.body || {};
  if (nid) run('UPDATE notifications SET read=1 WHERE id=? AND user_id=?', nid, req.user.id);
  else run('UPDATE notifications SET read=1 WHERE user_id=?', req.user.id);
  res.json({ ok: true });
});

// ---- Subscription plan + feature availability (white-label gating) ----
export const PLAN_FEATURES = {
  standard: ['leads', 'pipeline', 'customers', 'projects', 'reports', 'notifications'],
  pro: ['leads', 'pipeline', 'customers', 'projects', 'inventory', 'reports', 'ai', 'voice', 'notifications', 'marketing'],
  enterprise: ['leads', 'pipeline', 'customers', 'projects', 'inventory', 'reports', 'ai', 'voice', 'notifications', 'marketing', 'hr', 'finance', 'fieldforce', 'portal', 'offline', 'whitelabel', 'qrcode', 'biometric', 'digital_sign']
};
const PLAN_LABELS = { standard: 'Starter', pro: 'Professional', enterprise: 'Enterprise' };

router.get('/subscription', (req, res) => {
  const co = get('SELECT * FROM companies WHERE id=?', req.user.company_id);
  const plan = co?.plan || 'standard';
  const flags = {};
  for (const row of all('SELECT key, enabled FROM feature_flags WHERE company_id=?', req.user.company_id)) flags[row.key] = !!row.enabled;
  const features = PLAN_FEATURES[plan] || PLAN_FEATURES.standard;
  const enabled = Object.fromEntries(features.map((f) => [f, flags[f] !== false]));
  res.json({ plan, planLabel: PLAN_LABELS[plan] || plan, features: enabled, expires_at: co?.expires_at, customDomain: co?.custom_domain });
});

router.put('/subscription', (req, res) => {
  if (!ADMIN_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const plan = req.body?.plan;
  if (!PLAN_FEATURES[plan]) return res.status(400).json({ error: 'invalid plan' });
  run('UPDATE companies SET plan=? WHERE id=?', plan, req.user.company_id);
  if (typeof req.body?.custom_domain === 'string') {
    run('UPDATE companies SET custom_domain=? WHERE id=?', req.body.custom_domain.trim() || null, req.user.company_id);
  }
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'subscription.update', entity: 'company', entity_id: req.user.company_id, detail: { plan } });
  res.json({ ok: true, plan });
});

// ---- Reminder dispatcher: in-app + WhatsApp/email alert channels ----
router.post('/notifications/remind', (req, res) => {
  const b = req.body || {};
  const target = b.user_id || req.user.id;
  const channels = Array.isArray(b.channels) && b.channels.length ? b.channels : ['inapp'];
  for (const ch of channels) {
    notify(req.user.company_id, target, b.title || 'Reminder', b.body || '', b.type || 'reminder', ch);
  }
  res.json({ ok: true, sent: channels });
});

// ---- Audit logs ----
router.get('/audit', (req, res) => {
  if (!can(req.user, 'audit.view')) return res.status(403).json({ error: 'Forbidden' });
  const rows = all('SELECT * FROM audit_log WHERE company_id=? ORDER BY created_at DESC LIMIT 200', req.user.company_id);
  res.json(rows.map((r) => hydrate(r, ['detail'])));
});

// ---- Webhooks ----
router.get('/webhooks', (req, res) => {
  if (!can(req.user, 'settings.view') && !ADMIN_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  res.json(all('SELECT * FROM webhooks WHERE company_id=?', req.user.company_id));
});
router.post('/webhooks', (req, res) => {
  if (!can(req.user, 'settings.edit') && !ADMIN_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const { url, events } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });
  run(`INSERT INTO webhooks (id, company_id, url, events, created_at) VALUES (?,?,?,?,?)`,
    id(), req.user.company_id, url, JSON.stringify(events || ['lead.created']), ts());
  res.json({ ok: true });
});

// ---- Support tickets (within company) ----
router.get('/tickets', (req, res) => {
  const rows = hydratelist(all('SELECT * FROM tickets WHERE company_id=? ORDER BY created_at DESC', req.user.company_id), ['attachments']);
  res.json(rows);
});
router.post('/tickets', (req, res) => {
  const { subject, body, priority, type, attachments } = req.body || {};
  if (!subject) return res.status(400).json({ error: 'subject required' });
  const tid = id();
  run(`INSERT INTO tickets (id, company_id, user_id, subject, body, priority, type, status, attachments, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    tid, req.user.company_id, req.user.id, subject, body || '', priority || 'normal', type || 'bug', 'open',
    JSON.stringify(attachments || []), ts(), ts());
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'ticket.create', entity: 'ticket', entity_id: tid });
  res.json({ ok: true, id: tid });
});

// ---- Scheduled reports ----
router.get('/scheduled-reports', (req, res) => {
  if (!can(req.user, 'report.schedule')) return res.status(403).json({ error: 'Forbidden' });
  res.json(all('SELECT * FROM scheduled_reports WHERE company_id=?', req.user.company_id));
});
router.post('/scheduled-reports', (req, res) => {
  if (!can(req.user, 'report.schedule')) return res.status(403).json({ error: 'Forbidden' });
  const { name, frequency, email } = req.body || {};
  run(`INSERT INTO scheduled_reports (id, company_id, name, frequency, email, created_at) VALUES (?,?,?,?,?,?)`,
    id(), req.user.company_id, name || 'Report', frequency || 'weekly', email || '', ts());
  res.json({ ok: true });
});

export default router;
