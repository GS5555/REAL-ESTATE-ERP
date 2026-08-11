// Referral management routes.
// Admin/super-admin/company-admin can configure default referral amounts, edit per-referrer
// amounts, view stats and mark rewards paid. Any user can fetch their own shareable link.
import { Router } from 'express';
import { get, all, run, id, ts, audit } from '../db.js';
import { can } from '../auth.js';
import {
  referralConfig, saveReferralConfig, getOrCreateReferral, sharePayloads,
  trackClick, attributeLead, referralStats, referrersWithLinks
} from '../lib/referrals.js';

const router = Router();

function adminOf(req) {
  return req.user.role === 'super_admin' || can(req.user, 'subbroker.view') || can(req.user, 'settings.edit');
}// ---- config (default referral amount etc.) ----
router.get('/config', (req, res) => {
  if (!adminOf(req)) return res.status(403).json({ error: 'Forbidden' });
  res.json({ config: referralConfig(req.user.company_id) });
});
router.put('/config', (req, res) => {
  if (!adminOf(req)) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  saveReferralConfig(req.user.company_id, {
    enabled: b.enabled !== false,
    defaultAmount: Math.max(0, Number(b.defaultAmount) || 0),
    currency: b.currency || 'INR',
    landingTitle: b.landingTitle || ''
  });
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'referral.config', entity: 'company', detail: b, module: 'referral' });
  res.json({ ok: true, config: referralConfig(req.user.company_id) });
});

// ---- my own referral link (any logged-in user) ----
router.get('/my', (req, res) => {
  const person = { type: 'employee', id: req.user.id, name: req.user.name, phone: req.user.phone, email: req.user.email };
  const r = getOrCreateReferral(req.user.company_id || 'system', person);
  res.json({ referral: r, share: sharePayloads(req.user.company_id || 'system', r.ref_code) });
});

// ---- all referrers with links + stats (admin) ----
router.get('/links', (req, res) => {
  if (!adminOf(req)) return res.status(403).json({ error: 'Forbidden' });
  const cid = req.user.company_id || 'system';
  res.json({ people: referrersWithLinks(cid), stats: referralStats(cid) });
});

// ---- edit a referrer's referral amount (admin) ----
router.patch('/links/:code', (req, res) => {
  if (!adminOf(req)) return res.status(403).json({ error: 'Forbidden' });
  const r = get('SELECT * FROM referrals WHERE ref_code=? AND company_id=?', req.params.code, req.user.company_id || 'system');
  if (!r) return res.status(404).json({ error: 'Not found' });
  const next = {
    amount: req.body.amount !== undefined ? Math.max(0, Number(req.body.amount) || 0) : r.amount,
    status: req.body.status !== undefined ? req.body.status : r.status,
  };
  run('UPDATE referrals SET amount=?, status=? WHERE id=?', next.amount, next.status, r.id);
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'referral.edit', entity: 'referral', entity_id: r.id, detail: next, module: 'referral' });
  res.json({ ok: true, referral: get('SELECT * FROM referrals WHERE id=?', r.id) });
});

// ---- stats (admin) ----
router.get('/stats', (req, res) => {
  if (!adminOf(req)) return res.status(403).json({ error: 'Forbidden' });
  res.json({ stats: referralStats(req.user.company_id || 'system') });
});

// ---- rewards ledger (admin) ----
router.get('/rewards', (req, res) => {
  if (!adminOf(req)) return res.status(403).json({ error: 'Forbidden' });
  const rows = all('SELECT * FROM referral_rewards WHERE company_id=? ORDER BY created_at DESC LIMIT 300', req.user.company_id || 'system');
  res.json({ rewards: rows });
});
router.patch('/rewards/:id', (req, res) => {
  if (!adminOf(req)) return res.status(403).json({ error: 'Forbidden' });
  const status = req.body?.status === 'paid' ? 'paid' : 'pending';
  const paidAt = status === 'paid' ? ts() : null;
  run('UPDATE referral_rewards SET status=?, paid_at=? WHERE id=? AND company_id=?', status, paidAt, req.params.id, req.user.company_id || 'system');
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'referral.reward', entity: 'referral_reward', entity_id: req.params.id, detail: { status }, module: 'referral' });
  res.json({ ok: true });
});

export default router;
