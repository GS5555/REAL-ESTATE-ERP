// Backup management routes (admin only): config, manual run, history, download.
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { get, all } from '../db.js';
import { can } from '../auth.js';
import { runBackup, backupConfig, saveBackupConfig, BACKUP_ROOT } from '../lib/backup.js';

const router = Router();

function adminOf(req) {
  return req.user.role === 'super_admin' || can(req.user, 'backup.manage');
}

router.get('/config', (req, res) => {
  if (!adminOf(req)) return res.status(403).json({ error: 'Forbidden' });
  res.json({ config: backupConfig(req.user.company_id || 'system') });
});

router.put('/config', (req, res) => {
  if (!adminOf(req)) return res.status(403).json({ error: 'Forbidden' });
  const body = req.body || {};
  const cfg = {
    enabled: !!body.enabled,
    time: body.time || '02:00',
    format: ['db', 'csv', 'txt'].includes(body.format) ? body.format : 'db',
    localPath: body.localPath || '',
    notifyEmail: body.notifyEmail || '',
    cloud: {
      provider: body.cloud?.provider || 'none',
      endpoint: body.cloud?.endpoint || '',
      token: body.cloud?.token || '',
      folder: body.cloud?.folder || '',
    },
  };
  saveBackupConfig(req.user.company_id || 'system', cfg);
  res.json({ ok: true, config: cfg });
});

// Manual backup run. format overrides the scheduled default.
router.post('/run', async (req, res) => {
  if (!adminOf(req)) return res.status(403).json({ error: 'Forbidden' });
  const companyId = req.user.company_id || 'system';
  const format = ['db', 'csv', 'txt'].includes(req.body?.format) ? req.body.format : backupConfig(companyId).format || 'db';
  const result = runBackup(companyId, 'manual', { format });
  res.json(result);
});

router.get('/history', (req, res) => {
  if (!adminOf(req)) return res.status(403).json({ error: 'Forbidden' });
  const companyId = req.user.company_id || 'system';
  const rows = all('SELECT * FROM backups WHERE company_id=? ORDER BY created_at DESC LIMIT 200', companyId);
  res.json({ backups: rows });
});

// Download a backup artifact (admin only). Supports .db/.csv/.txt formats.
router.get('/:id/download', (req, res) => {
  if (!adminOf(req)) return res.status(403).json({ error: 'Forbidden' });
  const companyId = req.user.company_id || 'system';
  const b = get('SELECT * FROM backups WHERE id=? AND company_id=?', req.params.id, companyId);
  if (!b) return res.status(404).json({ error: 'Backup not found' });
  if (b.status !== 'completed') return res.status(400).json({ error: 'Backup did not complete' });

  const localPath = b.local_path;
  const filePath = localPath && fs.existsSync(localPath)
    ? localPath
    : path.join(BACKUP_ROOT, companyId, b.filename);

  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing on disk' });

  const types = {
    db: 'application/octet-stream',
    csv: 'text/csv',
    txt: 'text/plain',
  };
  res.setHeader('Content-Type', types[b.format] || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${b.filename}"`);
  fs.createReadStream(filePath).pipe(res);
});

export default router;
