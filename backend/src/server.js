import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { initSchema, run, get, all, ts, id, notify, audit } from './db.js';
import authRoutes from './routes/auth.js';
import systemRoutes from './routes/system.js';
import orgRoutes from './routes/org.js';
import masterRoutes from './routes/master.js';
import leadRoutes from './routes/leads.js';
import activityRoutes from './routes/activities.js';
import customerRoutes from './routes/customers.js';
import financeRoutes from './routes/finance.js';
import hrRoutes from './routes/hr.js';
import marketingRoutes from './routes/marketing.js';
import reportRoutes from './routes/reports.js';
import aiRoutes from './routes/ai.js';
import portalRoutes from './routes/portal.js';
import fieldforceRoutes from './routes/fieldforce.js';
import communicationRoutes from './routes/communication.js';
import listingRoutes from './routes/listings.js';
import loanRoutes from './routes/loans.js';
import billingRoutes from './routes/billing.js';
import orgchartRoutes from './routes/orgchart.js';
import backupRoutes from './routes/backups.js';
import referralRoutes from './routes/referrals.js';
import subbrokerRoutes from './routes/subbrokers.js';
import { startBackupScheduler } from './lib/backup.js';
import { sseHub } from './realtime.js';
import { JWT_SECRET } from './auth.js';

initSchema();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ---------- security headers ----------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self' 'unsafe-inline' https:; connect-src 'self' https: ws: wss:; media-src 'self' blob: https:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'");
  next();
});

// ---------- simple in-memory rate limiter (no native deps) ----------
const buckets = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
}, 120000).unref();
function rateLimit({ windowMs = 60000, max = 120, label = '' } = {}) {
  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    const key = `${label}${ip}`;
    const now = Date.now();
    const b = buckets.get(key);
    if (!b || b.reset < now) {
      buckets.set(key, { count: 1, reset: now + windowMs });
      return next();
    }
    b.count += 1;
    if (b.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((b.reset - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests, slow down' });
    }
    next();
  };
}

// ---------- CSRF / origin check for state-changing authed requests ----------
const ORIGIN_EXEMPT_PREFIXES = ['/api/auth', '/api/portal', '/api/public', '/api/webhook', '/api/forms', '/api/intake', '/api/events', '/api/health'];
app.use((req, res, next) => {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next(); // curl / same-origin server-to-server
  if (ORIGIN_EXEMPT_PREFIXES.some((p) => req.path.startsWith(p))) return next();
  try {
    const originHost = new URL(origin).host;
    const host = req.headers.host;
    const allowed = originHost === host || originHost.endsWith('.monkeycode-ai.live');
    if (!allowed) return res.status(403).json({ error: 'Cross-origin request rejected' });
  } catch {
    return res.status(403).json({ error: 'Invalid Origin header' });
  }
  next();
});

// strict rate limit on login to deter brute force
app.use('/api/auth/login', rateLimit({ windowMs: 60000, max: 10, label: 'login:' }));
// general API rate limit
app.use('/api', rateLimit({ windowMs: 60000, max: 600, label: 'api:' }));

// request logging to audit (optional light log)
app.use((req, res, next) => { next(); });

// heartbeat
app.get('/api/health', (req, res) => res.json({ ok: true, time: ts(), db: 'sqlite' }));

// public routes (no auth) + customer portal
app.use('/api', portalRoutes);      // /api/portal/*, /api/intake, /api/webhook/lead, /api/forms/intake, /api/public/*
app.use('/api/auth', authRoutes);   // /api/auth/*

// super admin developer panel
app.use('/api/admin', systemRoutes); // /api/admin/companies, /api/admin/feature-flags, /api/admin/tickets

// server-sent events (realtime) — must be registered before authenticated /api routers so the
// browser EventSource can connect via ?token= without requiring an Authorization header
app.get('/api/events', sseHub);

// authenticated org/master domain routes
app.use('/api', masterRoutes);      // /api/projects*, /api/units*, /api/meta/*
app.use('/api/leads', leadRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/hr', hrRoutes);
app.use('/api', marketingRoutes);   // /api/campaigns*
app.use('/api', reportRoutes);      // /api/dashboard, /api/reports/*
app.use('/api', aiRoutes);          // /api/score/*, /api/forecast, /api/recommend/*, ...
app.use('/api/field-force', fieldforceRoutes); // /api/field-force/*
app.use('/api', orgRoutes);         // /api/settings, /api/users, /api/roles, /api/audit, /api/tickets, ...

// ---- V2 modules ----
app.use('/api', communicationRoutes); // /api/support/chats, /api/conversations, /api/channels, /api/send, /api/presence, /api/upload
app.use('/api', listingRoutes);       // /api/listings*, /api/listings/import*
app.use('/api', loanRoutes);          // /api/loans*
app.use('/api', billingRoutes);       // /api/billing*
app.use('/api/orgchart', orgchartRoutes); // /api/orgchart/*
app.use('/api/backups', backupRoutes);    // /api/backups/* (admin only)
app.use('/api/referrals', referralRoutes); // /api/referrals/* (public attribution + admin)
app.use('/api/subbrokers', subbrokerRoutes); // /api/subbrokers/* (admin)

// scheduled automatic backups (per-company daily)
startBackupScheduler();

// uploaded files (from /api/upload) served at /uploads/<file>
app.use('/uploads', express.static(join(dirname(fileURLToPath(import.meta.url)), '../uploads')));

// ---- Combined single-port serving: serve built frontend + SPA fallback ----
const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '../../frontend/dist');
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  // SPA fallback: any non-API GET returns index.html so client routing works.
  // Asset paths (/assets/*, /uploads/*, sw.js, etc.) are excluded so a missing
  // hashed chunk returns 404 (JSON) instead of text/html, which previously
  // broke module scripts with "MIME type text/html" errors after a rebuild.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    if (req.path.startsWith('/assets/') || req.path.startsWith('/uploads/') || /\.[a-z0-9]{1,5}$/i.test(req.path)) return next();
    res.sendFile(join(distDir, 'index.html'));
  });
  console.log(`[propease] serving frontend from ${distDir}`);
} else {
  console.log('[propease] frontend dist not found — run `npm run build` to serve UI from the API port');
}

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found: ' + req.path }));

// error handler
app.use((err, req, res, next) => {
  console.error('ERR', err);
  res.status(500).json({ error: err.message || 'Internal error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[propease] API listening on http://localhost:${PORT}`);
});
