// In-memory SSE pub/sub hub for real-time events (chat, typing, presence, notifications).
// No external deps. Each connected client subscribes to company/user-scoped channels.
import { verifyToken } from './auth.js';

const clients = new Map(); // clientId -> { res, channels: Set, userId }

export function sseHub(req, res) {
  const token = (req.query.token || '');
  const claims = token ? verifyToken(token) : null;
  if (!claims || !claims.sub) return res.status(401).end();
  const userId = claims.sub;
  const companyId = claims.cid;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 3000\n\n');
  const id = userId + ':' + Math.random().toString(36).slice(2);
  clients.set(id, { res, channels: new Set([`co:${companyId}`, `u:${userId}`]), userId });
  req.on('close', () => clients.delete(id));
  // heartbeat every 25s keeps proxies from closing the connection
  const hb = setInterval(() => { try { res.write(':hb\n\n'); } catch { /* closed */ } }, 25000);
  res.on('close', () => clearInterval(hb));
}

export function subscribe(clientId, channel) {
  const c = clients.get(clientId);
  if (c) c.channels.add(channel);
}

export function publish(channel, event, data) {
  for (const c of clients.values()) {
    if (c.channels.has(channel)) {
      try {
        c.res.write(`event: ${event}\n`);
        c.res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch { /* drop */ }
    }
  }
}

// Company-wide + per-user delivery helpers
export function emitCompany(companyId, event, data) {
  publish(`co:${companyId}`, event, data);
}
export function emitUser(userId, event, data) {
  publish(`u:${userId}`, event, data);
}

export default { sseHub, subscribe, publish, emitCompany, emitUser };
