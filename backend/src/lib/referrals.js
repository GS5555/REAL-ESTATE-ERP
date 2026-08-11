// Referral engine: shareable referral links for employees, brokers and sub-brokers,
// click tracking, lead attribution and reward (referral amount) calculation.
import { db, get, all, run, id, ts, notify, audit } from '../db.js';
import { emitCompany } from '../realtime.js';

// ---- company-level referral config (referral_config table) ----
// { enabled, defaultAmount, currency, landingTitle }
export function referralConfig(companyId) {
  try {
    const row = get('SELECT config FROM referral_config WHERE company_id=?', companyId || 'system');
    return row && row.config ? JSON.parse(row.config) : { enabled: true, defaultAmount: 5000 };
  } catch { return { enabled: true, defaultAmount: 5000 }; }
}

export function saveReferralConfig(companyId, cfg) {
  run(`INSERT INTO referral_config (company_id, config) VALUES (?,?)
       ON CONFLICT(company_id) DO UPDATE SET config=excluded.config`,
    companyId || 'system', JSON.stringify(cfg || {}));
}

// ---- code generation ----
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function genRefCode(companyId, referrerType, referrerId) {
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  } while (get('SELECT id FROM referrals WHERE ref_code=?', code));
  return `${referrerType.slice(0, 1).toUpperCase()}-${code}`;
}

// All possible referrers across the three pools: employees, partners (brokers), subbrokers.
export function allReferrers(companyId) {
  const out = [];
  const emps = all('SELECT id, name, phone, email FROM users WHERE company_id=? AND role != ? AND active=1', companyId, 'customer');
  for (const e of emps) out.push({ type: 'employee', id: e.id, name: e.name, phone: e.phone, email: e.email });
  const brokers = all('SELECT id, name, phone, email FROM partners WHERE company_id=?', companyId);
  for (const p of brokers) out.push({ type: 'broker', id: p.id, name: p.name, phone: p.phone, email: p.email });
  const subs = all('SELECT id, name, phone, email FROM subbrokers WHERE company_id=?', companyId);
  for (const s of subs) out.push({ type: 'subbroker', id: s.id, name: s.name, phone: s.phone, email: s.email });
  return out;
}

export function getOrCreateReferral(companyId, person) {
  let r = get('SELECT * FROM referrals WHERE company_id=? AND referrer_type=? AND referrer_id=?', companyId, person.type, person.id);
  const cfg = referralConfig(companyId);
  if (!r) {
    const rid = id();
    run(`INSERT INTO referrals (id, company_id, ref_code, referrer_type, referrer_id, referrer_name, referrer_phone, referrer_email, amount, status, clicks, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      rid, companyId, genRefCode(companyId, person.type, person.id), person.type, person.id,
      person.name || '', person.phone || null, person.email || null, cfg.defaultAmount || 0, 'active', 0, ts());
    r = get('SELECT * FROM referrals WHERE id=?', rid);
  }
  return r;
}

// ---- public share payloads ----
export function sharePayloads(companyId, refCode) {
  const r = get('SELECT * FROM referrals WHERE ref_code=? AND company_id=?', refCode, companyId);
  if (!r) return null;
  const co = get('SELECT name, settings FROM companies WHERE id=?', companyId);
  let brand = {};
  try { brand = co?.settings ? (JSON.parse(co.settings).branding || {}) : {}; } catch {}
  const url = `${process.env.PUBLIC_BASE_URL || 'https://3001-c35a811a77633745.monkeycode-ai.live'}/ref/${refCode}`;
  const text = `Hi, I'm referring you to ${brand.companyName || co?.name || 'us'} for real estate. Get personalised guidance here: ${url}`;
  return {
    ref_code: refCode,
    referrer_name: r.referrer_name,
    url,
    text,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(text)}`,
    email: `mailto:?subject=${encodeURIComponent('Referral — ' + (brand.companyName || 'Real estate'))}&body=${encodeURIComponent(text)}`,
    twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`
  };
}

// ---- attribution ----
// Record a click on a referral link.
export function trackClick(companyId, refCode) {
  run('UPDATE referrals SET clicks=clicks+1 WHERE ref_code=? AND company_id=?', refCode, companyId);
}

// Attribute an incoming lead to a referral code. Creates the reward row.
export function attributeLead(companyId, refCode, leadId, leadName, leadPhone, opts = {}) {
  if (!refCode) return null;
  const r = get('SELECT * FROM referrals WHERE ref_code=? AND company_id=?', refCode, companyId);
  if (!r) return null;
  run('UPDATE leads SET referral_code=?, referrer_type=?, referrer_id=?, subbroker_id=? WHERE id=?',
    refCode, r.referrer_type, r.referrer_id, r.referrer_type === 'subbroker' ? r.referrer_id : null, leadId);
  const rid = id();
  run(`INSERT INTO referral_rewards (id, company_id, referral_id, lead_id, lead_name, lead_phone, referrer_type, referrer_id, referrer_name, amount, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    rid, companyId, r.id, leadId, leadName || null, leadPhone || null, r.referrer_type, r.referrer_id,
    r.referrer_name, opts.amount ?? r.amount ?? 0, opts.status || 'pending', ts());
  audit({ company_id: companyId, user_id: null, user_name: 'referral', action: 'referral.attributed', entity: 'lead', entity_id: leadId, detail: { ref_code: refCode, referrer: r.referrer_name }, module: 'referral' });
  try { notify(companyId, null, 'New referral reward', `Reward of ₹${opts.amount ?? r.amount ?? 0} reserved for ${r.referrer_name} on lead ${leadName || ''}`, 'success', 'inapp'); } catch {}
  emitCompany(companyId, 'referral:reward', { id: rid, lead_id: leadId, referrer: r.referrer_name, amount: opts.amount ?? r.amount ?? 0 });
  return { reward_id: rid, referral_id: r.id, amount: opts.amount ?? r.amount ?? 0 };
}

// ---- stats / calculation ----
export function referralStats(companyId) {
  const total = all('SELECT COUNT(*) c FROM referrals WHERE company_id=?', companyId)[0].c;
  const active = all('SELECT COUNT(*) c FROM referrals WHERE company_id=? AND status=?', companyId, 'active')[0].c;
  const clicks = all('SELECT COALESCE(SUM(clicks),0) c FROM referrals WHERE company_id=?', companyId)[0].c;
  const leads = all('SELECT COUNT(*) c FROM leads WHERE company_id=? AND referral_code IS NOT NULL', companyId)[0].c;
  const won = all(`SELECT COUNT(*) c FROM leads WHERE company_id=? AND referral_code IS NOT NULL AND status IN ('won','registered','payment')`, companyId)[0].c;
  const rewardTotals = all(`SELECT COALESCE(SUM(CASE WHEN status='pending' THEN amount ELSE 0 END),0) pending,
    COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END),0) paid,
    COALESCE(SUM(amount),0) total FROM referral_rewards WHERE company_id=?`, companyId)[0];
  return { total, active, clicks, leads, won, pending_amount: rewardTotals.pending, paid_amount: rewardTotals.paid, total_amount: rewardTotals.total };
}

// Enrich each referrer row with its referral link + reward totals.
export function referrersWithLinks(companyId) {
  return allReferrers(companyId).map((p) => {
    const r = getOrCreateReferral(companyId, p);
    const totals = get(`SELECT COALESCE(SUM(CASE WHEN status='pending' THEN amount ELSE 0 END),0) pending,
      COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END),0) paid,
      COUNT(*) leads FROM referral_rewards WHERE company_id=? AND referrer_type=? AND referrer_id=?`,
      companyId, p.type, p.id);
    return { ...p, referral: r, pending: totals.pending, paid: totals.paid, lead_count: totals.leads };
  });
}

export default { referralConfig, getOrCreateReferral, sharePayloads, trackClick, attributeLead, referralStats, referrersWithLinks, allReferrers };
