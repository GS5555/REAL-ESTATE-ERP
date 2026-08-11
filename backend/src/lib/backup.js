// Auto & manual backup engine: local DB snapshots, CSV/TXT exports, cloud upload
// (Google Drive / OneDrive / Dropbox / generic webhook), confirmation emails, and a
// per-company daily scheduler. Zero native dependencies (uses node:sqlite + global fetch).
import fs from 'node:fs';
import path from 'node:path';
import { db, get, all, run, id, ts, notify, audit, DATA_DIR } from '../db.js';
import { emitCompany } from '../realtime.js';

export const BACKUP_ROOT = path.join(DATA_DIR, 'backups');
fs.mkdirSync(BACKUP_ROOT, { recursive: true });

function companyDir(companyId) {
  const d = path.join(BACKUP_ROOT, companyId || 'system');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// A company's backup config lives in settings.backup:
// {
//   enabled: bool, time: '02:30', format: 'db'|'csv'|'txt',
//   localPath: 'optional custom destination dir',
//   notifyEmail: 'admin@...',
//   cloud: { provider: 'none'|'gdrive'|'onedrive'|'dropbox'|'webhook', endpoint, token, folder }
// }
export function backupConfig(companyId) {
  const row = get('SELECT config FROM backup_config WHERE company_id=?', companyId || 'system');
  return row ? parseJsonCfg(row.config) : {};
}

function parseJsonCfg(v) {
  try { return v ? JSON.parse(v) : {}; } catch { return {}; }
}

export function saveBackupConfig(companyId, cfg) {
  const cid = companyId || 'system';
  run(`INSERT INTO backup_config (company_id, config) VALUES (?,?)
       ON CONFLICT(company_id) DO UPDATE SET config=excluded.config`,
    cid, JSON.stringify(cfg || {}));
}

// ---- snapshot helpers --------------------------------------------------------
const USER_TABLES = () => all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('sqlite_sequence') AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .map((r) => r.name);

// Consistent single-file DB snapshot via SQLite's VACUUM INTO (no external tools).
export function snapshotDb(filePath) {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  db.exec(`VACUUM INTO '${String(filePath).replace(/'/g, "''")}'`);
  return filePath;
}

// CSV dump of every table (Excel-compatible). One block per table.
export function dumpCsv() {
  const parts = [];
  for (const t of USER_TABLES()) {
    const cols = all(`PRAGMA table_info(${JSON.stringify(t).replace(/"/g, '"')})`).map((c) => c.name);
    if (!cols.length) continue;
    const rows = all(`SELECT * FROM ${JSON.stringify(t)}`);
    const esc = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    parts.push(`=== TABLE: ${t} ===`);
    parts.push(cols.map(esc).join(','));
    for (const r of rows) parts.push(cols.map((c) => esc(r[c])).join(','));
    parts.push('');
  }
  return parts.join('\n');
}

// Human-readable text dump of every table.
export function dumpTxt() {
  const parts = [];
  for (const t of USER_TABLES()) {
    const cols = all(`PRAGMA table_info(${JSON.stringify(t).replace(/"/g, '"')})`).map((c) => c.name);
    if (!cols.length) continue;
    const rows = all(`SELECT * FROM ${JSON.stringify(t)}`);
    parts.push(`\n${'='.repeat(60)}\nTABLE: ${t} (${rows.length} rows)\n${'='.repeat(60)}`);
    for (const r of rows) {
      parts.push(cols.map((c) => `${c}=${r[c] ?? ''}`).join(' | '));
    }
  }
  return parts.join('\n');
}

// ---- cloud upload -------------------------------------------------------------
// provider: gdrive | onedrive | dropbox | webhook | none
// Config fields: endpoint (API base or full webhook URL), token (Bearer token),
// folder (target folder/path). Uploads the raw bytes with Bearer auth.
export async function uploadToCloud(companyId, filePath, cfg = {}) {
  const provider = cfg.provider || 'none';
  if (provider === 'none') return { status: 'skipped', note: 'no cloud provider configured' };
  const data = fs.readFileSync(filePath);
  const filename = path.basename(filePath);
  const token = cfg.token || '';
  const folder = (cfg.folder || '').trim();
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    if (provider === 'dropbox') {
      const target = folder ? `${folder.replace(/\/+$/, '')}/${filename}` : `/${filename}`;
      headers['Content-Type'] = 'application/octet-stream';
      headers['Dropbox-API-Arg'] = JSON.stringify({ path: target, mode: 'add', autorename: true, mute: true });
      const res = await fetch(cfg.endpoint || 'https://content.dropboxapi.com/2/files/upload', {
        method: 'POST', headers, body: data
      });
      if (!res.ok) throw new Error(`Dropbox upload failed (${res.status}): ${await res.text().catch(() => '')}`);
      return { status: 'uploaded', provider, detail: target };
    }

    if (provider === 'gdrive') {
      const base = (cfg.endpoint || 'https://www.googleapis.com/upload/drive/v3/files').replace(/\/+$/, '');
      const qs = new URLSearchParams({ uploadType: 'media' });
      if (folder) qs.set('uploadType', 'media');
      headers['Content-Type'] = 'application/octet-stream';
      const res = await fetch(`${base}?${qs}`, { method: 'POST', headers, body: data });
      if (!res.ok) throw new Error(`Google Drive upload failed (${res.status}): ${await res.text().catch(() => '')}`);
      return { status: 'uploaded', provider, detail: filename };
    }

    if (provider === 'onedrive') {
      const root = (cfg.endpoint || 'https://graph.microsoft.com/v1.0/me/drive').replace(/\/+$/, '');
      const folderPath = folder ? `root:/${folder.replace(/^\/+|\/+$/g, '')}/${filename}:/content` : `root:/${filename}:/content`;
      headers['Content-Type'] = 'application/octet-stream';
      const res = await fetch(`${root}/${folderPath}`, { method: 'PUT', headers, body: data });
      if (!res.ok) throw new Error(`OneDrive upload failed (${res.status}): ${await res.text().catch(() => '')}`);
      return { status: 'uploaded', provider, detail: folderPath };
    }

    // webhook: POST JSON { filename, data: base64 } to a custom endpoint
    const endpoint = cfg.endpoint || '';
    if (!endpoint) throw new Error('webhook endpoint not configured');
    headers['Content-Type'] = 'application/json';
    const res = await fetch(endpoint, {
      method: 'POST', headers,
      body: JSON.stringify({ filename, data: data.toString('base64'), size: data.length, uploadedAt: ts() })
    });
    if (!res.ok) throw new Error(`webhook upload failed (${res.status})`);
    return { status: 'uploaded', provider: 'webhook', detail: filename };
  } catch (e) {
    return { status: 'failed', provider, error: e.message };
  }
}

// ---- confirmation email -------------------------------------------------------
// Uses the company's configured email channel (settings.config.emailConfig) as a
// webhook-style SMTP endpoint if present, otherwise records in-app notification.
export async function sendBackupEmail(companyId, backup, cfg = {}) {
  const co = get('SELECT * FROM companies WHERE id=?', companyId);
  const settings = parseJsonCfg(co?.settings || '{}');
  const emailCfg = settings.config?.emailConfig || {};
  const to = cfg.notifyEmail || emailCfg.from || emailCfg.smtpUser || (co && co.billing_email);
  const subject = `Backup completed — ${backup.filename}`;
  const body = `Your ${backup.kind} backup completed successfully.\n\nFile: ${backup.filename}\nSize: ${Math.round(backup.size / 1024)} KB\nTime: ${backup.created_at}\nCloud: ${backup.cloud_status || 'local only'}\n\n— Propease Backup Service`;
  try {
    notify(companyId, null, subject, body.slice(0, 160), 'info', 'inapp');
    if (emailCfg.endpoint && (emailCfg.apiKey || emailCfg.token)) {
      await fetch(emailCfg.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${emailCfg.apiKey || emailCfg.token}` },
        body: JSON.stringify({ to, subject, body, from: emailCfg.from })
      });
    }
    run(`INSERT INTO reminder_logs (id, company_id, entity_type, entity_id, channel, subject, body, status, sent_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      id(), companyId, 'backup', backup.id, 'email', subject, body, 'sent', ts());
  } catch (e) { /* email failures never break backup flow */ }
}

// ---- backup runner -------------------------------------------------------------
// kind: 'auto' | 'manual'; format: 'db' | 'csv' | 'txt'
// Returns the backups row.
export function runBackup(companyId, kind = 'manual', overrides = {}) {
  const cfg = { ...backupConfig(companyId), ...overrides };
  const format = cfg.format || 'db';
  const stamp = ts().replace(/[:.]/g, '-');
  const ext = format === 'db' ? 'db' : format === 'csv' ? 'csv' : 'txt';
  const filename = `propease-backup-${kind}-${stamp}.${ext}`;
  const dir = cfg.localPath && cfg.localPath.trim()
    ? (fs.existsSync(cfg.localPath) ? cfg.localPath : (fs.mkdirSync(cfg.localPath, { recursive: true }), cfg.localPath))
    : companyDir(companyId);
  const filePath = path.join(dir, filename);

  try {
    if (format === 'db') snapshotDb(filePath);
    else if (format === 'csv') fs.writeFileSync(filePath, dumpCsv());
    else fs.writeFileSync(filePath, dumpTxt());
  } catch (e) {
    const bid = id();
    run(`INSERT INTO backups (id, company_id, kind, format, filename, size, status, local_path, cloud_status, cloud_error, schedule_time, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      bid, companyId, kind, format, filename, 0, 'failed', null, 'failed', e.message, cfg.time || null, ts());
    return { id: bid, status: 'failed', error: e.message };
  }

  const size = fs.statSync(filePath).size;
  const bid = id();

  const doUpload = async () => {
    const up = await uploadToCloud(companyId, filePath, cfg.cloud || {});
    run(`UPDATE backups SET cloud_status=?, cloud_error=? WHERE id=?`, up.status, up.error || null, bid);
    const row = get('SELECT * FROM backups WHERE id=?', bid);
    if (up.status === 'uploaded') emitCompany(companyId, 'backup:done', { id: row.id, filename: row.filename, kind: row.kind });
    if (cfg.notifyEmail || cfg.cloud?.provider && cfg.cloud.provider !== 'none') await sendBackupEmail(companyId, { ...row, kind: row.kind || kind }, cfg);
  };

  run(`INSERT INTO backups (id, company_id, kind, format, filename, size, status, local_path, cloud_status, schedule_time, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    bid, companyId, kind, format, filename, size, 'completed', filePath, 'pending', cfg.time || null, ts());

  emitCompany(companyId, 'backup:done', { id: bid, filename, kind });
  audit({ company_id: companyId, user_id: null, user_name: 'system', action: 'backup.run', entity: 'backup', entity_id: bid, detail: { kind, format, size }, module: 'backup' });
  void doUpload();
  return { id: bid, status: 'completed', filename, size, format };
}

// ---- scheduler ----------------------------------------------------------------
// Every 60s, scan companies with backup.enabled && time == current HH:MM and run.
const LAST_AUTO = new Map(); // companyId -> 'YYYY-MM-DD HH:MM' last auto run

export function startBackupScheduler() {
  const check = () => {
    try {
      const companies = all('SELECT id FROM companies WHERE status=?', 'active');
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const hhmm = `${hh}:${mm}`;
      const dayKey = `${now.toISOString().slice(0, 10)} ${hhmm}`;
      for (const c of companies) {
        const cfg = backupConfig(c.id);
        if (!cfg.enabled || !cfg.time) continue;
        if (cfg.time !== hhmm) continue;
        if (LAST_AUTO.get(c.id) === dayKey) continue;
        LAST_AUTO.set(c.id, dayKey);
        try { runBackup(c.id, 'auto'); } catch { /* isolate per company */ }
      }
    } catch (e) { /* scheduler must never crash */ }
  };
  check();
  setInterval(check, 60000);
}

export default { runBackup, backupConfig, startBackupScheduler, uploadToCloud };
