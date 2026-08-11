import { Router } from 'express';
import { get, run, all, ts, id, audit, notify } from '../db.js';
import { hydrate, hydratelist } from '../lib/helpers.js';
import { requireAuth, requireRole, hashPw, issueApiKey } from '../auth.js';
import { ROLES, ROLE_LABELS } from '../rbac.js';

const router = Router();

// ---- everything below requires super admin ----
const sa = [requireAuth, requireRole('super_admin')];

router.get('/companies', ...sa, (req, res) => {
  const rows = hydratelist(all('SELECT * FROM companies ORDER BY created_at DESC'), ['settings']);
  res.json(rows.map((c) => ({ ...c, license_key: c.license_key ? c.license_key.slice(0, 8) + '...' : null })));
});

router.post('/companies', ...sa, (req, res) => {
  const { name, slug, plan, billing_email } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Company name required' });
  const cid = id();
  const slugVal = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const exists = get('SELECT id FROM companies WHERE slug=?', slugVal);
  if (exists) return res.status(400).json({ error: 'Slug already taken' });
  run(`INSERT INTO companies (id,name,slug,license_key,plan,status,billing_email,settings,created_at,expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    cid, name, slugVal, 'LIC-' + crypto.randomUUID().slice(0, 12).toUpperCase(), plan || 'standard', 'active',
    billing_email || '', JSON.stringify({
      branding: { companyName: name, logo: '', theme: { primary: '#7c3aed' }, loginScreen: null, splashScreen: null },
      config: {}, contact: {}, modules: {}
    }), ts(), new Date(Date.now() + 365 * 86400000).toISOString());
  audit({ company_id: null, user_id: req.user.id, user_name: req.user.name, action: 'company.create', entity: 'company', entity_id: cid, detail: { name } });
  res.json({ id: cid, name, slug: slugVal });
});

router.patch('/companies/:id', ...sa, (req, res) => {
  const { status, plan, expires_at, name, billing_email } = req.body || {};
  const co = get('SELECT * FROM companies WHERE id=?', req.params.id);
  if (!co) return res.status(404).json({ error: 'Not found' });
  if (status !== undefined) run('UPDATE companies SET status=? WHERE id=?', status, co.id);
  if (plan !== undefined) run('UPDATE companies SET plan=? WHERE id=?', plan, co.id);
  if (name !== undefined) run('UPDATE companies SET name=? WHERE id=?', name, co.id);
  if (billing_email !== undefined) run('UPDATE companies SET billing_email=? WHERE id=?', billing_email, co.id);
  if (expires_at !== undefined) run('UPDATE companies SET expires_at=? WHERE id=?', expires_at, co.id);
  audit({ company_id: co.id, user_id: req.user.id, user_name: req.user.name, action: 'company.update', entity: 'company', entity_id: co.id, detail: req.body });
  res.json({ ok: true });
});

// Feature toggles per company
router.get('/feature-flags', ...sa, (req, res) => {
  const rows = all('SELECT * FROM feature_flags');
  res.json(rows);
});

router.post('/feature-flags', ...sa, (req, res) => {
  const { company_id, key, enabled } = req.body || {};
  if (!company_id || !key) return res.status(400).json({ error: 'company_id and key required' });
  run(`INSERT INTO feature_flags (company_id,key,enabled) VALUES (?,?,?)
       ON CONFLICT(company_id,key) DO UPDATE SET enabled=excluded.enabled`,
    company_id, key, enabled ? 1 : 0);
  res.json({ ok: true });
});

// Global support tickets from all companies (developer panel)
router.get('/tickets', ...sa, (req, res) => {
  const rows = hydratelist(all('SELECT * FROM tickets ORDER BY created_at DESC LIMIT 200'), ['attachments']);
  res.json(rows);
});

router.patch('/tickets/:id', ...sa, (req, res) => {
  const t = get('SELECT * FROM tickets WHERE id=?', req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const { status, developer_notes, resolution } = req.body || {};
  if (status !== undefined) run('UPDATE tickets SET status=? WHERE id=?', status, t.id);
  if (developer_notes !== undefined) run('UPDATE tickets SET developer_notes=? WHERE id=?', developer_notes, t.id);
  if (resolution !== undefined) run('UPDATE tickets SET resolution=? WHERE id=?', resolution, t.id);
  run('UPDATE tickets SET updated_at=? WHERE id=?', ts(), t.id);
  audit({ company_id: t.company_id, user_id: req.user.id, user_name: req.user.name, action: 'ticket.update', entity: 'ticket', entity_id: t.id, detail: req.body });
  res.json({ ok: true });
});

export default router;
