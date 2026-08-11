import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { get, run, ts, id, flagEnabled } from './db.js';
import { DEFAULT_PERMISSIONS, normalizePerms, ROLES } from './rbac.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'propease-dev-secret-change-me';

export const hashPw = (pw) => bcrypt.hashSync(pw, 10);
export const verifyPw = (pw, hash) => (hash ? bcrypt.compareSync(pw, hash) : false);

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, cid: user.company_id, role: user.role },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export function genOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Resolve effective permissions for a role within a company.
export function rolePermissions(companyId, role) {
  if (role === 'super_admin') return DEFAULT_PERMISSIONS.super_admin;
  const custom = get('SELECT perms FROM custom_roles WHERE company_id=? AND role=?', companyId, role);
  if (custom) return normalizePerms(JSON.parse(custom.perms));
  const ov = get('SELECT perms FROM role_perms WHERE company_id=? AND role=?', companyId, role);
  if (ov) return normalizePerms(JSON.parse(ov.perms));
  return normalizePerms(DEFAULT_PERMISSIONS[role] || []);
}

export function can(user, perm) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  const perms = rolePermissions(user.company_id, user.role);
  return perms.includes(perm);
}

export function hasRole(user, roles) {
  return roles.includes(user.role);
}

// Auth middleware: resolves user from Bearer token
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.status(401).json({ error: 'Unauthorized' });
  const user = get('SELECT * FROM users WHERE id=?', payload.sub);
  if (!user || !user.active) return res.status(401).json({ error: 'Account disabled' });
  if (user.company_id) {
    const co = get('SELECT * FROM companies WHERE id=?', user.company_id);
    if (!co || co.status !== 'active') return res.status(403).json({ error: 'Company suspended or not found' });
  }
  req.user = user;
  req.payload = payload;
  next();
}

// Permission guard
export function requirePerm(perm) {
  return (req, res, next) => {
    if (!can(req.user, perm)) {
      return res.status(403).json({ error: `Forbidden: requires permission "${perm}"` });
    }
    next();
  };
}

// Role guard
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!ROLES.includes(roles[0])) roles = roles;
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden: role not allowed' });
    next();
  };
}

export function updateLastLogin(userId) {
  run('UPDATE users SET last_login=? WHERE id=?', ts(), userId);
}

export function createOtp(user, purpose = 'login') {
  const code = genOtp();
  run(`INSERT INTO otp_codes (id, company_id, user_id, code, purpose, expires_at, used)
       VALUES (?,?,?,?,?,?,0)`,
    id(), user.company_id, user.id, code, purpose, new Date(Date.now() + 10 * 60000).toISOString());
  return code;
}

export function issueApiKey() {
  const key = `pp_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  return key;
}
