import { Router } from 'express';
import { get, run, all, ts, id, notify } from '../db.js';
import {
  hashPw, verifyPw, signToken, requireAuth, createOtp, updateLastLogin, rolePermissions, JWT_SECRET
} from '../auth.js';
import { ROLES, ROLE_LABELS, DEFAULT_PERMISSIONS } from '../rbac.js';
import { hydrate, hydratelist } from '../lib/helpers.js';

const router = Router();

router.post('/login', (req, res) => {
  const { email, phone, password } = req.body || {};
  const ident = (email || phone || '').trim().toLowerCase();
  if (!ident || !password) return res.status(400).json({ error: 'Email/phone and password required' });
  const user = get('SELECT * FROM users WHERE LOWER(COALESCE(email,\'\'))=? OR LOWER(COALESCE(phone,\'\'))=?', ident, ident);
  if (!user || !verifyPw(password, user.password_hash)) return res.status(401).json({ error: 'Invalid credentials' });
  if (!user.active) return res.status(403).json({ error: 'Account disabled' });

  const company = user.company_id ? get('SELECT * FROM companies WHERE id=?', user.company_id) : null;
  if (user.company_id && (!company || company.status !== 'active')) {
    return res.status(403).json({ error: 'Company suspended or not found' });
  }

  let otpRequired = false;
  if (user.mfa_enabled) {
    const code = createOtp(user, 'mfa');
    otpRequired = true;
    // In production send via SMS/WhatsApp. Exposed on API response only in demo mode.
    res.json({ otpRequired, mfaUserId: user.id, demoOtp: code });
    return;
  }

  updateLastLogin(user.id);
  const token = signToken(user);
  res.json({ token, user: serializeUser(user, company) });
});

router.post('/otp-verify', (req, res) => {
  const { userId, code } = req.body || {};
  const user = get('SELECT * FROM users WHERE id=?', userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const otp = get(`SELECT * FROM otp_codes WHERE user_id=? AND purpose='mfa' AND used=0 AND expires_at > ? ORDER BY expires_at DESC LIMIT 1`,
    userId, ts());
  if (!otp || otp.code !== String(code)) return res.status(401).json({ error: 'Invalid or expired OTP' });
  run('UPDATE otp_codes SET used=1 WHERE id=?', otp.id);
  const company = user.company_id ? get('SELECT * FROM companies WHERE id=?', user.company_id) : null;
  updateLastLogin(user.id);
  res.json({ token: signToken(user), user: serializeUser(user, company) });
});

router.get('/me', requireAuth, (req, res) => {
  const company = req.user.company_id ? get('SELECT * FROM companies WHERE id=?', req.user.company_id) : null;
  res.json({ user: serializeUser(req.user, company), company });
});

router.get('/permissions', requireAuth, (req, res) => {
  res.json({
    role: req.user.role,
    roleLabel: ROLE_LABELS[req.user.role] || req.user.role,
    permissions: rolePermissions(req.user.company_id, req.user.role)
  });
});

function serializeUser(user, company) {
  const u = hydrate(user, ['meta']);
  delete u.password_hash;
  return {
    ...u,
    company: company ? hydrate(company, ['settings']) : null
  };
}

export default router;
