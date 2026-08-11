// Rule-based AI chat: answer natural-language questions about the company's own
// data (leads, sales, finance, loans, customers, marketing, referrals, employees).
// No external API — everything is computed from the local SQLite database.
import { all, get } from '../db.js';
import { getStages, BOOKED_STATUSES } from './helpers.js';
import { forecast, forecastWindows, riskAlerts, productivityScore } from './insights.js';
import { referralStats, referrersWithLinks } from './referrals.js';

const fmt = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const pct = (n) => Math.round((n || 0) * 100) + '%';

function has(q, ...words) {
  return words.some((w) => q.includes(w));
}

export function chatAnswer(companyId, question, user) {
  const q = ' ' + String(question || '').toLowerCase().replace(/\s+/g, ' ') + ' ';
  const cid = companyId || 'system';
  const stages = getStages(cid);
  const booked = BOOKED_STATUSES || ['booking', 'payment', 'registered', 'won'];

  // ---- greeting / help ----
  if (has(q, 'hello', 'hi ', 'hey', 'good morning', 'good evening', 'good afternoon')) {
    return { text: `Hello ${user?.name?.split(' ')[0] || 'there'}! I can answer questions about your business — try things like "how many leads do we have?", "what's our total sales?", "pending payments", "top performing executive", or "loan pipeline".` };
  }
  if (has(q, 'help', 'what can you do', 'how do you work', 'how does this work', 'commands')) {
    return {
      text: 'I can pull live answers from your CRM data. Examples:',
      bullets: [
        '"how many leads do we have" / "leads by source"',
        '"total sales" / "bookings this month" / "revenue collected"',
        '"pending payments" / "outstanding invoices" / "expenses"',
        '"top executive" / "who has the best conversion"',
        '"home loan pipeline" / "loans by status"',
        '"referral performance" / "campaign leads" / "customers count"'
      ]
    };
  }

  // ---- leads ----
  if (has(q, 'total lead', 'how many lead', 'number of lead', 'lead count', 'all leads', 'leads do we have', 'total number of leads')) {
    const total = get('SELECT COUNT(*) c FROM leads WHERE company_id=?', cid).c;
    const fresh = get(`SELECT COUNT(*) c FROM leads WHERE company_id=? AND status NOT IN (${booked.map(() => '?').join(',')},'lost','junk','cancelled')`, cid, ...booked).c;
    return { text: `You have ${total} total leads in the system, of which ${fresh} are still active (not yet booked or lost).` };
  }
  if (has(q, 'lead by source', 'leads from', 'source wise', 'by source')) {
    const rows = all('SELECT source, COUNT(*) c FROM leads WHERE company_id=? GROUP BY source ORDER BY c DESC LIMIT 8', cid);
    if (!rows.length) return { text: 'No leads recorded yet.' };
    return { text: 'Leads by source:', bullets: rows.map((r) => `${r.source || 'Other'}: ${r.c} leads (${Math.round(r.c / rows.reduce((s, x) => s + x.c, 0) * 100)}%)`) };
  }
  if (has(q, 'lead by status', 'lead by stage', 'by status', 'by stage')) {
    const rows = all('SELECT status, COUNT(*) c FROM leads WHERE company_id=? GROUP BY status ORDER BY c DESC', cid);
    if (!rows.length) return { text: 'No leads yet.' };
    return { text: 'Leads by stage:', bullets: rows.map((r) => `${stages.find((s) => s.key === r.status)?.label || r.status}: ${r.c}`) };
  }
  if (has(q, 'new lead', 'lead this week', 'lead this month', 'lead today', 'recent lead', 'lead in the last')) {
    const m = q.match(/last (\d+)/);
    const days = m ? Number(m[1]) : 7;
    const n = get('SELECT COUNT(*) c FROM leads WHERE company_id=? AND created_at>=?', cid, new Date(Date.now() - days * 86400000).toISOString()).c;
    return { text: `${n} new lead${n === 1 ? '' : 's'} created in the last ${days} days.` };
  }
  if (has(q, 'hot lead', 'priority')) {
    const rows = all('SELECT COUNT(*) c FROM leads WHERE company_id=? AND priority=?', cid, 'Hot');
    return { text: `${rows[0]?.c || 0} hot-priority leads are in your pipeline right now.` };
  }

  // ---- sales / bookings ----
  if (has(q, 'total sales', 'total booking', 'sales value', 'booking value', 'how much sold', 'total revenue', 'sale done')) {
    const sum = get(`SELECT COALESCE(SUM(total_value),0) s FROM bookings WHERE company_id=? AND status IN (${booked.map(() => '?').join(',')})`, cid, ...booked);
    const count = get(`SELECT COUNT(*) c FROM bookings WHERE company_id=? AND status IN (${booked.map(() => '?').join(',')})`, cid, ...booked);
    return { text: `Total closed sales: ${fmt(sum.s)} across ${count.c} bookings.` };
  }
  if (has(q, 'booking this month', 'sale this month', 'bookings this month', 'this month booking', 'monthly sale')) {
    const m = new Date().toISOString().slice(0, 7);
    const rows = all(`SELECT * FROM bookings WHERE company_id=? AND created_at LIKE ?`, cid, m + '%');
    const sum = rows.reduce((s, b) => s + (b.total_value || 0), 0);
    return { text: `${rows.length} booking${rows.length === 1 ? '' : 's'} this month totalling ${fmt(sum)}.` };
  }
  if (has(q, 'forecast', 'projection', 'expected sale', 'target')) {
    const f = forecast(cid);
    const w = forecastWindows(cid);
    return { text: `Projected sales value: ${fmt(f.projected)} with ${f.expectedBookings} expected bookings. Next 90 days: ${fmt(w.d90?.revenue || 0)} revenue and ${w.d90?.bookings || 0} bookings.` };
  }
  if (has(q, 'conversion', 'close rate', 'conversion rate')) {
    const total = get('SELECT COUNT(*) c FROM leads WHERE company_id=?', cid).c;
    const bookedN = get(`SELECT COUNT(*) c FROM leads WHERE company_id=? AND status IN (${booked.map(() => '?').join(',')})`, cid, ...booked).c;
    return { text: total ? `Your overall conversion rate is ${pct(bookedN / total)} (${bookedN} bookings out of ${total} leads).` : 'No leads to measure yet.' };
  }

  // ---- finance ----
  if (has(q, 'collected', 'payment received', 'received amount', 'collection')) {
    const s = get("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE company_id=? AND status='received'", cid);
    return { text: `Total amount collected: ${fmt(s.s)}.` };
  }
  if (has(q, 'pending payment', 'outstanding', 'due payment', 'unpaid', 'receivable')) {
    const inv = get("SELECT COALESCE(SUM(amount),0) s FROM invoices WHERE company_id=? AND status IN ('sent','overdue')", cid);
    const pay = get("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE company_id=? AND status='pending'", cid);
    return { text: `Outstanding invoices: ${fmt(inv.s)}. Pending payment records: ${fmt(pay.s)}.` };
  }
  if (has(q, 'expense', 'spent', 'cost this')) {
    const s = get("SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE company_id=? AND status='approved'", cid);
    const cat = all('SELECT category, COALESCE(SUM(amount),0) s FROM expenses WHERE company_id=? AND status=\'approved\' GROUP BY category ORDER BY s DESC LIMIT 5', cid);
    return { text: `Approved expenses total ${fmt(s.s)}.`, bullets: cat.map((c) => `${c.category || 'other'}: ${fmt(c.s)}`) };
  }
  if (has(q, 'invoice') && !has(q, 'outstanding')) {
    const total = get('SELECT COUNT(*) c FROM invoices WHERE company_id=?', cid).c;
    const paid = get("SELECT COUNT(*) c FROM invoices WHERE company_id=? AND status='paid'", cid).c;
    return { text: `${total} invoices generated, ${paid} paid.` };
  }
  if (has(q, 'net cash', 'cash flow', 'netflow')) {
    const coll = get("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE company_id=? AND status='received'", cid).s;
    const exp = get("SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE company_id=? AND status='approved'", cid).s;
    return { text: `Net cash flow: ${fmt(coll - exp)} (collected ${fmt(coll)} minus expenses ${fmt(exp)}).` };
  }
  if (has(q, 'commission')) {
    const pend = get("SELECT COALESCE(SUM(amount),0) s FROM commissions WHERE company_id=? AND status='pending'", cid);
    const paid = get("SELECT COALESCE(SUM(amount),0) s FROM commissions WHERE company_id=? AND status='paid'", cid);
    return { text: `Pending commissions: ${fmt(pend.s)}. Paid: ${fmt(paid.s)}.` };
  }

  // ---- referrals / sub-brokers (before generic "performance") ----
  if (has(q, 'referral')) {
    const s = referralStats(cid);
    return { text: `${s.total} referral links active. ${s.clicks} clicks, ${s.leads} referred leads. Pending payout ${fmt(s.pending_amount)}, paid ${fmt(s.paid_amount)}.` };
  }
  if (has(q, 'subbroker', 'sub broker')) {
    const rows = all('SELECT * FROM subbrokers WHERE company_id=?', cid);
    if (!rows.length) return { text: 'No sub-brokers registered yet.' };
    const leads = rows.reduce((s, r) => s + (r.leads || 0), 0);
    return { text: `${rows.length} sub-brokers registered, contributing ${leads} leads.` };
  }

  // ---- executives / performance ----
  if (has(q, 'top executive', 'top performer', 'best executive', 'best performer', 'top sales', 'who is doing well', 'performance')) {
    const rows = all(`SELECT u.id, u.name,
      (SELECT COUNT(*) FROM leads l WHERE l.owner_id=u.id) leads,
      (SELECT COUNT(*) FROM leads l WHERE l.owner_id=u.id AND l.status IN (${booked.map(() => '?').join(',')})) booked
      FROM users u WHERE u.company_id=? AND u.active=1 AND u.role IN ('sales_executive','sr_executive','team_leader','sales_manager')`,
      cid, ...booked);
    const ranked = rows.filter((r) => r.leads > 0).sort((a, b) => (b.booked / b.leads) - (a.booked / a.leads)).slice(0, 3);
    if (!ranked.length) return { text: 'No executive performance data yet.' };
    return { text: 'Top executives by conversion:', bullets: ranked.map((r) => `${r.name}: ${r.booked} bookings / ${r.leads} leads (${pct(r.booked / r.leads)})`) };
  }
  if (has(q, 'productivity', 'score')) {
    const rows = productivityScore(cid);
    if (!rows.length) return { text: 'No productivity data yet.' };
    const best = rows.slice().sort((a, b) => b.score - a.score)[0];
    return { text: `Average productivity score is ${Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length)}. ${best?.user} leads with score ${best?.score} (grade ${best?.grade}).` };
  }
  if (has(q, 'at risk', 'risk alert', 'risk lead', 'inactive lead', 'stale lead')) {
    const alerts = riskAlerts(cid);
    return { text: alerts.length ? `${alerts.length} leads currently flagged at risk (inactive).` : 'No leads at risk right now. Good follow-up discipline!' };
  }

  // ---- customers ----
  if (has(q, 'customer count', 'total customer', 'how many customer', 'number of customer')) {
    const c = get('SELECT COUNT(*) c FROM customers WHERE company_id=?', cid).c;
    return { text: `You have ${c} customers in your CRM.` };
  }
  if (has(q, 'customer') && has(q, 'new')) {
    const n = get('SELECT COUNT(*) c FROM customers WHERE company_id=? AND created_at>=?', cid, new Date(Date.now() - 30 * 86400000).toISOString()).c;
    return { text: `${n} customers added in the last 30 days.` };
  }

  // ---- loans ----
  if (has(q, 'loan', 'home loan')) {
    const total = get('SELECT COUNT(*) c FROM loans WHERE company_id=?', cid).c;
    const statuses = all('SELECT status, COUNT(*) c FROM loans WHERE company_id=? GROUP BY status ORDER BY c DESC', cid);
    const active = all("SELECT COUNT(*) c FROM loans WHERE company_id=? AND status IN ('application','documents','processing','approved','sanctioned')", cid)[0].c;
    return { text: `${total} home loans tracked (${active} active).`, bullets: statuses.map((r) => `${r.status}: ${r.c}`) };
  }
  if (has(q, 'loan disburs', 'disbursed')) {
    const s = get("SELECT COALESCE(SUM(loan_amount),0) s FROM loans WHERE company_id=? AND status='disbursed'", cid);
    const c = get("SELECT COUNT(*) c FROM loans WHERE company_id=? AND status='disbursed'", cid).c;
    return { text: `${c} loans disbursed totalling ${fmt(s.s)}.` };
  }

  // ---- marketing / campaigns ----
  if (has(q, 'campaign', 'marketing')) {
    const rows = all('SELECT * FROM campaigns WHERE company_id=?', cid);
    if (!rows.length) return { text: 'No marketing campaigns yet.' };
    const spent = rows.reduce((s, c) => s + (c.spent || 0), 0);
    const leads = all(`SELECT source, COUNT(*) c FROM leads WHERE company_id=? GROUP BY source`, cid);
    const best = rows.slice().sort((a, b) => (b.actual_leads || 0) - (a.actual_leads || 0))[0];
    return { text: `${rows.length} campaigns, ${fmt(spent)} spent.${best ? ` Best performer: ${best.name} (${best.actual_leads || 0} leads).` : ''}` };
  }

  // ---- inventory / projects ----
  if (has(q, 'inventory', 'unit available', 'available unit', 'inventory left')) {
    const avail = get("SELECT COUNT(*) c FROM units WHERE company_id=? AND availability IN ('Available','available') AND booking_status IN ('Unsold','unsold','Available','available')", cid).c;
    const total = get('SELECT COUNT(*) c FROM units WHERE company_id=?', cid).c;
    return { text: `${avail} units available out of ${total} total in inventory.` };
  }
  if (has(q, 'project')) {
    const c = get('SELECT COUNT(*) c FROM projects WHERE company_id=?', cid).c;
    return { text: `You have ${c} projects configured.` };
  }

  // ---- employees ----
  if (has(q, 'employee', 'team size', 'how many people', 'staff')) {
    const c = get('SELECT COUNT(*) c FROM users WHERE company_id=? AND active=1 AND role != ?', cid, 'customer').c;
    return { text: `You have ${c} active employees on the platform.` };
  }

  return {
    text: `I couldn't map that to a metric I can query. Try asking about leads, sales/bookings, collections, expenses, invoices, loans, campaigns, referrals, customers, or executives.`
  };
}

export default chatAnswer;
