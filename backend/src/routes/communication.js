// V2 Communication module: live customer support chat, internal employee messaging,
// and communication channel adapters (WhatsApp/SMS/Email/Messenger/Instagram/Telegram/GBM).
import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { get, run, all, ts, id, audit, notify } from '../db.js';
import { hydrate, hydratelist } from '../lib/helpers.js';
import { requireAuth, can } from '../auth.js';
import { emitCompany, emitUser } from '../realtime.js';

const router = Router();
router.use(requireAuth);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', mp3: 'audio/mpeg', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain', csv: 'text/csv', zip: 'application/zip'
};

// ---- file upload (base64 data-URL JSON, no native multipart deps) ----
router.post('/upload', (req, res) => {
  const { data, filename } = req.body || {};
  if (!data) return res.status(400).json({ error: 'data required (base64 data URL)' });
  const m = /^data:([^;]+);base64,(.+)$/.exec(data);
  const ext = (filename || '').includes('.') ? filename.split('.').pop().toLowerCase() : 'bin';
  const mime = (m && m[1]) || MIME[ext] || 'application/octet-stream';
  const content = m ? Buffer.from(m[2], 'base64') : Buffer.from(data, 'base64');
  if (content.length > 25 * 1024 * 1024) return res.status(400).json({ error: 'Max 25MB' });
  const name = `${id()}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), content);
  const url = `/uploads/${name}`;
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'file.upload', entity: 'file', entity_id: name, module: 'communication' });
  res.json({ ok: true, url, mime, size: content.length, name });
});

// ==================== LIVE CUSTOMER SUPPORT CHAT ====================
router.get('/support/chats', (req, res) => {
  if (!can(req.user, 'support.view') && !can(req.user, 'support.chat')) return res.status(403).json({ error: 'Forbidden' });
  const status = req.query.status || '';
  const where = ['company_id=?'];
  const args = [req.user.company_id];
  if (status) { where.push('status=?'); args.push(status); }
  const rows = all(`SELECT * FROM support_chats WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT 100`, ...args);
  const counts = {};
  for (const c of rows) counts[c.id] = get('SELECT COUNT(*) n FROM support_messages WHERE chat_id=? AND read_at IS NULL AND sender_type=?', c.id, 'customer').n;
  res.json(rows.map((r) => ({ ...r, unread: counts[r.id] || 0 })));
});

router.get('/support/chats/:id', (req, res) => {
  const c = get('SELECT * FROM support_chats WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const msgs = all('SELECT * FROM support_messages WHERE chat_id=? ORDER BY created_at ASC', c.id);
  res.json({ chat: c, messages: msgs });
});

router.post('/support/chats', (req, res) => {
  const b = req.body || {};
  if (!b.customer_name && !b.customer_phone) return res.status(400).json({ error: 'customer name or phone required' });
  const cid = id();
  run(`INSERT INTO support_chats (id, company_id, customer_name, customer_phone, customer_email, subject, status, assigned_to, channel, source, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    cid, req.user.company_id, b.customer_name || null, b.customer_phone || null, b.customer_email || null,
    b.subject || null, b.status || 'open', b.assigned_to || null, b.channel || 'chat', b.source || 'web', ts(), ts());
  if (b.body) {
    run(`INSERT INTO support_messages (id, chat_id, company_id, sender_type, sender_id, sender_name, body, media_url, media_type, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      id(), cid, req.user.company_id, 'agent', req.user.id, req.user.name, b.body, null, null, ts());
  }
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'support.chat.create', entity: 'support_chat', entity_id: cid, module: 'communication' });
  emitCompany(req.user.company_id, 'chat:new', { chatId: cid });
  res.json({ ok: true, id: cid });
});

// assign / transfer chat to another executive
router.post('/support/chats/:id/assign', (req, res) => {
  const assignee = req.body?.assigned_to || null;
  run('UPDATE support_chats SET assigned_to=?, updated_at=? WHERE id=? AND company_id=?', assignee, ts(), req.params.id, req.user.company_id);
  const chat = get('SELECT * FROM support_chats WHERE id=?', req.params.id);
  if (assignee && chat) notify(req.user.company_id, assignee, 'Chat assigned to you', `Support chat with ${chat.customer_name || 'customer'}`);
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'support.chat.assign', entity: 'support_chat', entity_id: req.params.id, detail: { assigned_to: assignee }, module: 'communication' });
  res.json({ ok: true });
});

router.post('/support/chats/:id/status', (req, res) => {
  const status = req.body?.status || 'open';
  run('UPDATE support_chats SET status=?, updated_at=? WHERE id=? AND company_id=?', status, ts(), req.params.id, req.user.company_id);
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'support.chat.status', entity: 'support_chat', entity_id: req.params.id, detail: { status }, module: 'communication' });
  res.json({ ok: true });
});

router.post('/support/chats/:id/messages', (req, res) => {
  const b = req.body || {};
  if (!b.body && !b.media_url) return res.status(400).json({ error: 'body or media_url required' });
  const mid = id();
  run(`INSERT INTO support_messages (id, chat_id, company_id, sender_type, sender_id, sender_name, body, media_url, media_type, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    mid, req.params.id, req.user.company_id, 'agent', req.user.id, req.user.name, b.body || null, b.media_url || null, b.media_type || null, ts());
  run('UPDATE support_chats SET updated_at=? WHERE id=?', ts(), req.params.id);
  emitCompany(req.user.company_id, 'chat:msg', { chatId: req.params.id, message: { id: mid, sender_type: 'agent', sender_name: req.user.name, body: b.body, media_url: b.media_url, created_at: ts() } });
  res.json({ ok: true, id: mid });
});

// ==================== INTERNAL EMPLOYEE MESSAGING ====================
const GROUP_KINDS = ['department', 'project', 'branch', 'announcement', 'general'];

router.get('/conversations', (req, res) => {
  if (!can(req.user, 'chat.use')) return res.status(403).json({ error: 'Forbidden' });
  const moderate = can(req.user, 'chat.moderate');
  const rows = all(
    `SELECT c.*,
       (SELECT COUNT(*) FROM conversation_messages m WHERE m.conversation_id=c.id AND m.deleted=0 AND m.created_at > COALESCE(cm.last_read_at,'0')) unread
     FROM conversations c LEFT JOIN conversation_members cm ON cm.conversation_id=c.id AND cm.user_id=?
     WHERE c.company_id=? ${moderate ? '' : 'AND cm.user_id IS NOT NULL'} ORDER BY c.created_at DESC`,
    req.user.id, req.user.company_id);
  res.json(hydratelist(rows, []));
});

router.post('/conversations', (req, res) => {
  if (!can(req.user, 'chat.use')) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  const members = new Set([req.user.id, ...(Array.isArray(b.member_ids) ? b.member_ids : [])]);
  // prevent duplicate direct chats between the same two people
  if (b.kind === 'direct' && members.size === 2) {
    const other = [...members].find((u) => u !== req.user.id);
    const existing = get(
      `SELECT c.id FROM conversations c
       JOIN conversation_members a ON a.conversation_id=c.id AND a.user_id=?
       JOIN conversation_members b ON b.conversation_id=c.id AND b.user_id=?
       WHERE c.company_id=? AND c.kind='direct' LIMIT 1`,
      req.user.id, other, req.user.company_id);
    if (existing) return res.json({ ok: true, id: existing.id, reopened: true });
  }
  const cid = id();
  run(`INSERT INTO conversations (id, company_id, kind, title, created_by, created_at) VALUES (?,?,?,?,?,?)`,
    cid, req.user.company_id, b.kind || 'direct', b.title || null, req.user.id, ts());
  for (const uid of members) {
    run('INSERT INTO conversation_members (conversation_id, user_id, last_read_at) VALUES (?,?,?)', cid, uid, ts());
  }
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'chat.conversation.create', entity: 'conversation', entity_id: cid, module: 'communication' });
  emitCompany(req.user.company_id, 'chat:conversation', { conversationId: cid, kind: b.kind });
  res.json({ ok: true, id: cid });
});

router.get('/conversations/:id', (req, res) => {
  if (!can(req.user, 'chat.use')) return res.status(403).json({ error: 'Forbidden' });
  const conv = get('SELECT * FROM conversations WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!conv) return res.status(404).json({ error: 'Not found' });
  const moderate = can(req.user, 'chat.moderate');
  const isMember = get('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?', conv.id, req.user.id);
  if (!isMember && !moderate) return res.status(403).json({ error: 'Not a member' });
  const q = req.query.q || '';
  const msgs = all(
    `SELECT * FROM conversation_messages WHERE conversation_id=? AND deleted=0
       ${q ? 'AND (body LIKE ? OR sender_name LIKE ?)' : ''} ORDER BY created_at DESC LIMIT 200`,
    ...(q ? [conv.id, `%${q}%`, `%${q}%`] : [conv.id]));
  const members = all(`SELECT u.id, u.name, u.role, u.last_seen_at FROM conversation_members cm JOIN users u ON u.id=cm.user_id WHERE cm.conversation_id=?`, conv.id);
  res.json({ conversation: conv, messages: msgs.reverse(), members });
});

router.post('/conversations/:id/messages', (req, res) => {
  if (!can(req.user, 'chat.use')) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  if (!b.body && !b.media_url) return res.status(400).json({ error: 'body or media_url required' });
  const conv = get('SELECT * FROM conversations WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!conv) return res.status(404).json({ error: 'Not found' });
  const moderate = can(req.user, 'chat.moderate');
  const isMember = get('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?', conv.id, req.user.id);
  if (!isMember && !moderate) return res.status(403).json({ error: 'Not a member' });
  const mid = id();
  run(`INSERT INTO conversation_messages (id, conversation_id, company_id, sender_id, sender_name, body, media_url, media_type, reply_to, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    mid, conv.id, req.user.company_id, req.user.id, req.user.name, b.body || null, b.media_url || null, b.media_type || null, b.reply_to || null, ts());
  emitCompany(req.user.company_id, 'chat:msg', { conversationId: conv.id, message: { id: mid, sender_id: req.user.id, sender_name: req.user.name, body: b.body, media_url: b.media_url, media_type: b.media_type, reply_to: b.reply_to, created_at: ts() } });
  for (const m of all('SELECT user_id FROM conversation_members WHERE conversation_id=?', conv.id)) {
    if (m.user_id !== req.user.id) notify(req.user.company_id, m.user_id, `New message in ${conv.title || 'chat'}`, (b.body || '').slice(0, 80) || '📎 attachment');
  }
  res.json({ ok: true, id: mid });
});

// typing indicator
router.post('/conversations/:id/typing', (req, res) => {
  emitCompany(req.user.company_id, 'chat:typing', { conversationId: req.params.id, userId: req.user.id, name: req.user.name, typing: !!req.body?.typing });
  res.json({ ok: true });
});

// mark read (read receipts)
router.post('/conversations/:id/read', (req, res) => {
  run(`UPDATE conversation_members SET last_read_at=? WHERE conversation_id=? AND user_id=?`, ts(), req.params.id, req.user.id);
  emitCompany(req.user.company_id, 'chat:read', { conversationId: req.params.id, userId: req.user.id, at: ts() });
  res.json({ ok: true });
});

// reactions
router.post('/conversations/:id/messages/:mid/react', (req, res) => {
  const emoji = req.body?.emoji || '👍';
  const msg = get('SELECT * FROM conversation_messages WHERE id=? AND conversation_id=?', req.params.mid, req.params.id);
  if (!msg) return res.status(404).json({ error: 'Not found' });
  const reactions = (() => { try { return JSON.parse(msg.reactions || '{}'); } catch { return {}; } })();
  reactions[req.user.id] = emoji;
  run('UPDATE conversation_messages SET reactions=? WHERE id=?', JSON.stringify(reactions), msg.id);
  emitCompany(req.user.company_id, 'chat:react', { conversationId: req.params.id, messageId: msg.id, userId: req.user.id, emoji });
  res.json({ ok: true });
});

// admin moderation: hide a message
router.delete('/conversations/:id/messages/:mid', (req, res) => {
  if (!can(req.user, 'chat.moderate')) return res.status(403).json({ error: 'Forbidden' });
  run('UPDATE conversation_messages SET deleted=1 WHERE id=? AND conversation_id=?', req.params.mid, req.params.id);
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'chat.message.delete', entity: 'chat_message', entity_id: req.params.mid, module: 'communication' });
  emitCompany(req.user.company_id, 'chat:delete', { conversationId: req.params.id, messageId: req.params.mid });
  res.json({ ok: true });
});

// presence heartbeat (online/offline status)
router.post('/presence', (req, res) => {
  run('UPDATE users SET last_seen_at=? WHERE id=?', ts(), req.user.id);
  emitCompany(req.user.company_id, 'chat:presence', { userId: req.user.id, name: req.user.name, at: ts() });
  res.json({ ok: true });
});

// ==================== COMMUNICATION API INTEGRATION ====================
const CHANNELS = ['whatsapp', 'sms', 'email', 'messenger', 'instagram', 'telegram', 'gbm'];

// channel config lives in company settings.channels = { whatsapp: {provider,...}, ... }
function channelConfig(companyId) {
  const co = get('SELECT * FROM companies WHERE id=?', companyId);
  const settings = co ? hydrate(co, ['settings']).settings || {} : {};
  return settings.channels || {};
}

router.get('/channels', (req, res) => {
  const cfg = channelConfig(req.user.company_id);
  res.json(CHANNELS.map((c) => ({ channel: c, configured: !!(cfg[c] && cfg[c].enabled), config: cfg[c] || {} })));
});

router.post('/channels', (req, res) => {
  if (!can(req.user, 'settings.edit')) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  if (!CHANNELS.includes(b.channel)) return res.status(400).json({ error: 'invalid channel' });
  const co = get('SELECT * FROM companies WHERE id=?', req.user.company_id);
  const settings = hydrate(co, ['settings']).settings || {};
  settings.channels = settings.channels || {};
  settings.channels[b.channel] = { ...(settings.channels[b.channel] || {}), ...(b.config || {}), enabled: b.config?.enabled ?? settings.channels[b.channel]?.enabled ?? false };
  run('UPDATE companies SET settings=? WHERE id=?', JSON.stringify(settings), req.user.company_id);
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'channel.configure', entity: 'channel', entity_id: b.channel, module: 'communication' });
  res.json({ ok: true });
});

// Send a message through a channel to a lead/customer, and record it in `messages`
router.post('/send', (req, res) => {
  if (!can(req.user, 'activity.create')) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  const channel = b.channel || 'whatsapp';
  if (!CHANNELS.includes(channel)) return res.status(400).json({ error: 'invalid channel' });
  if (!b.body) return res.status(400).json({ error: 'body required' });
  if (!b.to) return res.status(400).json({ error: 'to (phone/email) required' });

  const cfg = channelConfig(req.user.company_id);
  const cc = cfg[channel] || {};
  const meta = { to: b.to, provider: cc.provider || 'internal', messageId: id() };

  // Deliver via configured provider, otherwise record as simulated (demo/offline mode).
  let status = 'sent';
  let delivered = true;
  const endpoint = cc.endpoint || '';
  if (cc.enabled && endpoint && (cc.apiKey || cc.token)) {
    try {
      // fire-and-forget webhook-style delivery (no native deps)
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cc.apiKey || cc.token}` },
        body: JSON.stringify({ channel, to: b.to, body: b.body, from: cc.from })
      }).then((r) => {
        if (!r.ok) run('UPDATE messages SET status=? WHERE id=?', 'failed', meta.messageId);
      }).catch(() => run('UPDATE messages SET status=? WHERE id=?', 'failed', meta.messageId));
      meta.webhook = endpoint;
    } catch { delivered = false; }
  } else if (cc.enabled) {
    // no endpoint configured — record as queued
    status = 'queued';
  }

  const mid = id();
  run(`INSERT INTO messages (id, company_id, lead_id, user_id, channel, direction, body, status, meta, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    mid, req.user.company_id, b.lead_id || null, req.user.id, channel, 'outbound', b.body, status, JSON.stringify(meta), ts());
  if (b.lead_id) {
    run('UPDATE leads SET last_activity_at=? WHERE id=?', ts(), b.lead_id);
    run(`INSERT INTO activities (id, company_id, lead_id, user_id, type, subject, note, outcome, mode, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      id(), req.user.company_id, b.lead_id, req.user.id, 'message', `${channel} sent`, b.body.slice(0, 120), 'Sent', channel, ts());
  }
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'communication.send', entity: 'message', entity_id: mid, detail: { channel, to: b.to }, module: 'communication' });
  emitCompany(req.user.company_id, 'msg:sent', { messageId: mid, channel, status });
  res.json({ ok: true, id: mid, status });
});

// conversation history for a lead / customer across all channels
router.get('/history', (req, res) => {
  if (!can(req.user, 'lead.view')) return res.status(403).json({ error: 'Forbidden' });
  const { lead_id, customer_id, limit = 100 } = req.query;
  let rows = [];
  if (lead_id) {
    rows = all('SELECT * FROM messages WHERE company_id=? AND lead_id=? ORDER BY created_at DESC LIMIT ?', req.user.company_id, lead_id, Number(limit));
  } else if (customer_id) {
    const c = get('SELECT * FROM customers WHERE id=? AND company_id=?', customer_id, req.user.company_id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    rows = all(`SELECT * FROM messages WHERE company_id=? AND (lead_id IN (SELECT id FROM leads WHERE phone=?) OR lead_id IN (SELECT id FROM leads WHERE email=?)) ORDER BY created_at DESC LIMIT ?`,
      req.user.company_id, c.phone, c.email || '__none__', Number(limit));
  }
  res.json(hydratelist(rows, ['meta']));
});

export default router;
