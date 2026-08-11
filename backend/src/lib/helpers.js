import { get, all } from '../db.js';

export function parseJson(v, fallback) {
  try {
    if (v == null || v === '') return fallback;
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

// Parse JSON columns on a row in place
export function hydrate(row, cols = ['meta', 'detail', 'settings', 'amenities', 'photos', 'nearby', 'tags', 'documents', 'bank', 'attachments', 'payment_plan', 'kyc_docs', 'events', 'scopes']) {
  if (!row) return row;
  for (const c of cols) {
    if (row[c] !== undefined) row[c] = parseJson(row[c], Array.isArray(row[c]) ? [] : {});
  }
  return row;
}

export function hydratelist(rows, cols) {
  return rows.map((r) => hydrate(r, cols));
}

export function paginate(req) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(500, parseInt(req.query.limit, 10) || 50);
  return { page, limit, offset: (page - 1) * limit };
}

export function csv(rows, columns) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const head = columns.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(c.accessor(r))).join(',')).join('\n');
  return head + '\n' + body;
}

export function companySettings(companyId) {
  const co = get('SELECT * FROM companies WHERE id=?', companyId);
  return co ? hydrate(co, ['settings']).settings || {} : {};
}

// ---- Configurable pipeline stages (per company) ----
export const DEFAULT_STAGES = [
  { key: 'new_lead', label: 'New Lead', color: '#94a3b8' },
  { key: 'contacted', label: 'Contacted', color: '#64748b' },
  { key: 'interested', label: 'Interested', color: '#3b82f6' },
  { key: 'site_visit_scheduled', label: 'Site Visit Scheduled', color: '#0ea5e9' },
  { key: 'site_visit_completed', label: 'Site Visit Completed', color: '#06b6d4' },
  { key: 'negotiation', label: 'Negotiation', color: '#f59e0b' },
  { key: 'booking', label: 'Booking', color: '#f97316' },
  { key: 'payment', label: 'Payment', color: '#10b981' },
  { key: 'registered', label: 'Registered', color: '#22c55e' },
  { key: 'won', label: 'Won', color: '#16a34a', is_win: 1 },
  { key: 'lost', label: 'Lost', color: '#ef4444', is_lost: 1 }
];

export function getStages(companyId) {
  const rows = all('SELECT * FROM pipeline_stages WHERE company_id=? ORDER BY sort ASC, created_at ASC', companyId);
  if (rows.length) return rows.map((r) => ({ ...r, is_win: !!r.is_win, is_lost: !!r.is_lost }));
  return DEFAULT_STAGES;
}

export function stageLabel(companyId, key) {
  const s = getStages(companyId).find((x) => x.key === key);
  return s ? s.label : (key || 'Unknown');
}

export const WON_STATUSES = ['won', 'completed', 'possession', 'registered'];
export const BOOKED_STATUSES = ['booking', 'payment', 'token_received', 'registered', 'won', 'agreement', 'loan_processing', 'registration', 'possession', 'completed'];
export const LOST_STATUSES = ['lost', 'cancelled'];

export function getUnitQr(unit) {
  return JSON.stringify({ u: unit.number, p: unit.project_id, id: unit.id });
}
