import { all, get } from '../db.js';
import { BOOKED_STATUSES, getStages } from './helpers.js';

// Normalize contact fields for comparison
function norm(v) {
  if (v == null) return '';
  return String(v).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function nameSimilar(a, b) {
  if (!a || !b) return false;
  const x = a.toLowerCase().replace(/\s+/g, '');
  const y = b.toLowerCase().replace(/\s+/g, '');
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

// Find duplicate leads for a new lead. Returns { lead, match_score, reason }[]
export function findDuplicates(companyId, lead, existingId) {
  const phone = norm(lead.phone);
  const email = norm(lead.email);
  const rows = all('SELECT * FROM leads WHERE company_id=? AND id != ? AND duplicate_of IS NULL', companyId, existingId || '');
  const out = [];
  for (const r of rows) {
    let score = 0;
    const reasons = [];
    const rp = norm(r.phone);
    const re = norm(r.email);
    if (phone && rp && phone === rp) { score += 60; reasons.push('same phone'); }
    if (email && re && email === re) { score += 30; reasons.push('same email'); }
    if (nameSimilar(lead.name, r.name)) { score += 20; reasons.push('similar name'); }
    if (score >= 60) {
      out.push({ lead: r, match_score: score, reason: reasons.join(', ') });
    }
  }
  out.sort((a, b) => b.match_score - a.match_score);
  return out;
}

// Heuristic lead scoring (0-100)
export function scoreLead(lead, companyId) {
  let score = 0;
  const reasons = [];

  if (BOOKED_STATUSES.includes(lead.status)) {
    score += 40; reasons.push('already advanced in pipeline');
  }
  if (lead.budget && lead.budget > 0) { score += 15; reasons.push('has budget'); }
  if (lead.priority === 'Hot') { score += 20; reasons.push('hot priority'); }
  else if (lead.priority === 'Warm') { score += 10; reasons.push('warm priority'); }

  const activities = all('SELECT COUNT(*) n FROM activities WHERE lead_id=? AND done_at IS NOT NULL', lead.id);
  const n = activities[0]?.n || 0;
  if (n >= 3) { score += 15; reasons.push('engaged (' + n + ' activities)'); }
  else if (n >= 1) { score += 8; reasons.push('has activity history'); }

  const visits = all('SELECT COUNT(*) n FROM site_visits WHERE lead_id=?', lead.id);
  if (visits[0]?.n > 0) { score += 15; reasons.push('did site visit'); }

  const hasProj = lead.project_id ? 5 : 0;
  if (hasProj) { score += 5; reasons.push('project interest'); }

  const ageDays = lead.created_at ? (Date.now() - new Date(lead.created_at).getTime()) / 86400000 : 99;
  if (ageDays <= 2) { score += 10; reasons.push('fresh lead'); }
  else if (ageDays > 30) { score -= 10; reasons.push('stale'); }

  score = Math.max(0, Math.min(100, score));
  return { score, reasons };
}

// AI next-best-action suggestions
export function suggestNextAction(lead) {
  const suggestions = [];
  const ageDays = lead.created_at ? (Date.now() - new Date(lead.created_at).getTime()) / 86400000 : 0;

  if (lead.priority === 'Hot' && ageDays > 1) {
    suggestions.push({ action: 'Call', due: 'now', reason: 'Hot lead should be contacted within 24h' });
  }
  const openFollowUps = all(
    'SELECT COUNT(*) n FROM activities WHERE lead_id=? AND done_at IS NULL AND scheduled_at <= ?',
    lead.id, new Date().toISOString()
  );
  if (openFollowUps[0]?.n > 0) {
    suggestions.push({ action: 'Follow-up', due: 'today', reason: 'Pending scheduled follow-up is overdue' });
  }
  const stage = lead.status;
  const flow = {
    new_lead: 'Qualify the lead — ask budget, area and timeline',
    contacted: 'Send project brochures and schedule a call',
    interested: 'Offer a site visit slot this week',
    site_visit_scheduled: 'Confirm the visit a day before and send directions',
    site_visit_completed: 'Follow up within 24h after the visit',
    negotiation: 'Prepare final price offer and payment plan',
    booking: 'Collect token amount and issue receipt',
    payment: 'Drive agreement, registration and loan processing',
    registered: 'Hand over possession documents and welcome kit'
  };
  if (flow[stage]) {
    suggestions.push({ action: 'Next step: ' + stage.replace(/_/g, ' '), due: 'this week', reason: flow[stage] });
  }
  if (!lead.budget) {
    suggestions.push({ action: 'Collect budget', due: 'soon', reason: 'Missing budget information lowers conversion odds' });
  }
  if (!lead.owner_id) {
    suggestions.push({ action: 'Assign owner', due: 'now', reason: 'Lead is unassigned — no owner is working it' });
  }
  return suggestions.slice(0, 4);
}

// Simple linear sales forecast based on pipeline value and conversion
export function forecast(companyId) {
  const rows = all(
    `SELECT status, COUNT(*) n, COALESCE(SUM(budget),0) value FROM leads
     WHERE company_id=? GROUP BY status`, companyId
  );
  const conv = {
    new_lead: 0.05, contacted: 0.08, interested: 0.15, site_visit_scheduled: 0.22,
    site_visit_completed: 0.30, negotiation: 0.40, booking: 0.55, payment: 0.70,
    registered: 0.85, won: 1
  };
  let projected = 0;
  let expectedBookings = 0;
  const stages = {};
  for (const r of rows) {
    stages[r.status] = { count: r.n, value: r.value };
    const c = conv[r.status] || 0.05;
    projected += r.value * c;
    expectedBookings += r.n * c;
  }
  return { stages, projected, expectedBookings: Math.round(expectedBookings) };
}

// Bookings/revenue forecast over 30 / 60 / 90 day windows
export function forecastWindows(companyId) {
  const nowT = Date.now();
  const base = forecast(companyId);
  const recent = all(
    `SELECT status, COUNT(*) n, COALESCE(SUM(budget),0) value FROM leads
     WHERE company_id=? AND created_at >= ? GROUP BY status`,
    companyId, new Date(nowT - 30 * 86400000).toISOString()
  );
  const monthlyRunRate = recent.reduce((s, r) => {
    const c = { new_lead: 0.05, contacted: 0.08, interested: 0.15, site_visit_scheduled: 0.22, site_visit_completed: 0.30, negotiation: 0.40, booking: 0.55, payment: 0.70, registered: 0.85, won: 1 }[r.status] || 0.05;
    return s + r.value * c;
  }, 0);
  const factor = Math.max(0.5, monthlyRunRate / Math.max(1, base.projected / 3));
  const mk = (days) => ({ bookings: Math.round(base.expectedBookings * (days / 30) * factor), revenue: Math.round(base.projected * (days / 30) * factor) });
  return { d30: mk(30), d60: mk(60), d90: mk(90), pipelineValue: base.projected };
}

// Customer lifetime value estimate
export function estimateLtv(customerId) {
  const c = get('SELECT * FROM customers WHERE id=?', customerId);
  if (!c) return 0;
  const sum = get('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE customer_id=?', customerId);
  const bookings = get('SELECT COUNT(*) n FROM bookings WHERE customer_id=?', customerId);
  const refer = c.referred_by ? 0.15 : 0;
  return Math.round(sum.s * (1 + refer) * Math.max(1, bookings.n));
}

// ---- Expanded AI helpers ---------------------------------------------------
const TONES = ['Warm and professional', 'Formal', 'Friendly', 'Persuasive'];
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function aiWhatsapp(lead, projectName) {
  const templates = [
    `Hi ${lead.name}, thank you for your interest in ${projectName || 'our projects'}! Based on your requirement, I have put together the best options. Could we connect for a quick call today?`,
    `Hello ${lead.name}! Great news — we have a few units matching your budget. Would you like to see the floor plans or schedule a site visit this weekend?`,
    `Hi ${lead.name}, this is a quick follow-up on your enquiry. We are running a limited-period offer on ${projectName || 'our inventory'} — happy to share the details on WhatsApp.`
  ];
  return rand(templates);
}

export function aiEmail(lead, projectName) {
  return `Dear ${lead.name},\n\nThank you for reaching out regarding ${projectName || 'our real estate projects'}. We have matched your requirement of ${lead.requirement || 'a suitable property'} within a budget of ₹${(lead.budget / 100000).toFixed(1)} L (if applicable).\n\nI have attached our latest brochure and a payment plan for your reference. I would be happy to schedule a site visit or a call at your convenience.\n\nWarm regards,\nSales Team\nSkyline Developers`;
}

export function meetingSummary(notes, name) {
  const body = notes || 'No notes provided.';
  const words = body.split(/\s+/).filter(Boolean).length;
  return {
    title: `Meeting summary for ${name || 'lead'}`,
    keyPoints: [
      words ? `Discussion covered approximately ${words} words of detail.` : 'Discussion covered requirements, budget and timeline.',
      'Customer showed interest in payment-plan options and possession timeline.',
      'Action items: share brochure, schedule follow-up within 48 hours.'
    ],
    sentiment: words > 120 ? 'positive' : 'neutral',
    actionItems: ['Send brochure & payment plan', 'Book site visit', 'Follow up in 2 days']
  };
}

export function sentiment(text) {
  const t = (text || '').toLowerCase();
  const pos = ['interested', 'great', 'good', 'yes', 'like', 'buy', 'confirm', 'thanks', 'thank', 'perfect', 'ready'];
  const neg = ['no', 'not', 'expensive', 'costly', 'worried', 'bad', 'later', 'cancel', 'unhappy', 'refund'];
  let score = 0;
  for (const w of pos) if (t.includes(w)) score += 1;
  for (const w of neg) if (t.includes(w)) score -= 1;
  const label = score > 1 ? 'positive' : score < 0 ? 'negative' : 'neutral';
  return { label, score, confidence: Math.min(0.95, 0.5 + Math.abs(score) * 0.1) };
}

// Leads at risk of going cold
export function riskAlerts(companyId, days = 3) {
  const rows = all(
    `SELECT * FROM leads WHERE company_id=? AND status NOT IN ('won','lost','cancelled')
     ORDER BY updated_at ASC LIMIT 20`, companyId
  );
  const out = [];
  for (const l of rows) {
    const ageDays = (Date.now() - new Date(l.created_at).getTime()) / 86400000;
    const lastAct = l.last_activity_at ? (Date.now() - new Date(l.last_activity_at).getTime()) / 86400000 : ageDays;
    const followups = get('SELECT COUNT(*) n FROM activities WHERE lead_id=? AND scheduled_at > ?', l.id, new Date().toISOString()).n;
    if (lastAct >= days && followups === 0) {
      const risk = Math.min(95, Math.round(40 + lastAct * 8 + (l.priority === 'Hot' ? 15 : 0)));
      out.push({
        lead_id: l.id, name: l.name, phone: l.phone, priority: l.priority, score: l.score,
        last_activity_days: Math.round(lastAct * 10) / 10, risk,
        action: risk > 75 ? 'Call immediately or move to cold' : 'Send a re-engagement WhatsApp'
      });
    }
  }
  out.sort((a, b) => b.risk - a.risk);
  return out.slice(0, 15);
}

// Executive productivity score (follow-ups, meetings, response time, conversions)
export function productivityScore(companyId, userId) {
  const u = get('SELECT * FROM users WHERE id=?', userId);
  if (!u) return null;
  const acts = get('SELECT COUNT(*) n FROM activities WHERE user_id=? AND done_at IS NOT NULL AND done_at >= ?', userId, new Date(Date.now() - 30 * 86400000).toISOString()).n;
  const calls = get('SELECT COUNT(*) n FROM activities WHERE user_id=? AND type IN (\'call\',\'voice\') AND done_at IS NOT NULL', userId).n;
  const visits = get('SELECT COUNT(*) n FROM site_visits WHERE user_id=? AND checkin_at IS NOT NULL', userId).n;
  const leads = get('SELECT COUNT(*) n FROM leads WHERE owner_id=? AND company_id=?', userId, companyId).n;
  const booked = get('SELECT COUNT(*) n FROM leads WHERE owner_id=? AND company_id=? AND status IN (\'booking\',\'payment\',\'registered\',\'won\')', userId, companyId).n;
  const conv = leads > 0 ? Math.round((booked / leads) * 100) : 0;
  const responseAvg = get('SELECT AVG(response_time_mins) a FROM leads WHERE owner_id=? AND response_time_mins IS NOT NULL', userId).a || 0;
  const followups = acts;
  const score = Math.min(100, Math.round(
    35 * Math.min(1, followups / 20) +
    25 * Math.min(1, calls / 15) +
    20 * Math.min(1, visits / 6) +
    20 * Math.min(1, conv / 25)
  ));
  return {
    user: u.name, score, followups_30d: followups, calls, visits, leads, booked, conversion: conv,
    avg_response_mins: Math.round(responseAvg),
    grade: score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D'
  };
}
