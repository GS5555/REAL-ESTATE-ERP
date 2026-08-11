import { Router } from 'express';
import { get, run, all, ts, id, notify } from '../db.js';
import { hydrate } from '../lib/helpers.js';
import { requireAuth, requirePerm, can } from '../auth.js';
import {
  scoreLead, suggestNextAction, forecast, forecastWindows, estimateLtv,
  aiWhatsapp, aiEmail, meetingSummary, sentiment, riskAlerts, productivityScore
} from '../lib/insights.js';
import { chatAnswer } from '../lib/chat.js';

const router = Router();
router.use(requireAuth);

// AI Q&A chat — answers natural-language questions about the company's own data.
router.post('/chat', (req, res) => {
  const q = String(req.body?.question || '').trim();
  if (!q) return res.status(400).json({ error: 'question required' });
  const answer = chatAnswer(req.user.company_id, q, req.user);
  res.json({ ...answer, question: q });
});

// AI Lead scoring for a specific lead
router.get('/score/:leadId', (req, res) => {
  const lead = get('SELECT * FROM leads WHERE id=? AND company_id=?', req.params.leadId, req.user.company_id);
  if (!lead) return res.status(404).json({ error: 'Not found' });
  const { score, reasons } = scoreLead(lead, req.user.company_id);
  res.json({ score, reasons, suggestions: suggestNextAction(lead) });
});

// Next-best-action across all my leads
router.get('/next-best-action', (req, res) => {
  const scope = can(req.user, 'lead.assign') ? '' : ' AND owner_id=?';
  const args = can(req.user, 'lead.assign') ? [req.user.company_id] : [req.user.company_id, req.user.id];
  const leads = all(`SELECT * FROM leads WHERE company_id=? ${scope} AND status NOT IN ('lost','cancelled') LIMIT 100`, ...args);
  const out = [];
  for (const l of leads) {
    const { score, reasons } = scoreLead(l, req.user.company_id);
    const suggestions = suggestNextAction(l);
    if (suggestions.length) {
      out.push({ lead: hydrate(l, ['tags']), score, reasons, suggestions: suggestions.slice(0, 2) });
    }
  }
  out.sort((a, b) => b.score - a.score);
  res.json(out.slice(0, 15));
});

// Sales forecast
router.get('/forecast', (req, res) => {
  res.json(forecast(req.user.company_id));
});

// 30/60/90 day bookings + revenue forecast
router.get('/forecast/windows', (req, res) => {
  res.json(forecastWindows(req.user.company_id));
});

// AI WhatsApp reply generator
router.post('/whatsapp', (req, res) => {
  const lead = get('SELECT * FROM leads WHERE id=? AND company_id=?', req.body?.lead_id, req.user.company_id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  const project = req.body?.project_id ? get('SELECT name FROM projects WHERE id=?', req.body.project_id) : null;
  res.json({ text: aiWhatsapp(lead, project?.name) });
});

// AI email generator
router.post('/email', (req, res) => {
  const lead = get('SELECT * FROM leads WHERE id=? AND company_id=?', req.body?.lead_id, req.user.company_id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  const project = req.body?.project_id ? get('SELECT name FROM projects WHERE id=?', req.body.project_id) : null;
  res.json({ subject: `Re: Your enquiry about ${project?.name || 'our projects'}`, body: aiEmail(lead, project?.name) });
});

// One-tap meeting summary
router.post('/summary', (req, res) => {
  const { notes, lead_id } = req.body || {};
  const lead = lead_id ? get('SELECT name FROM leads WHERE id=?', lead_id) : null;
  res.json(meetingSummary(notes, lead?.name));
});

// Sentiment analysis
router.post('/sentiment', (req, res) => {
  res.json(sentiment(req.body?.text));
});

// Lead risk alerts (going cold)
router.get('/risk', (req, res) => {
  const days = parseInt(req.query.days, 10) || 3;
  res.json({ alerts: riskAlerts(req.user.company_id, days) });
});

// Executive productivity score
router.get('/productivity', (req, res) => {
  if (!can(req.user, 'lead.assign')) {
    const s = productivityScore(req.user.company_id, req.user.id);
    return res.json({ rows: s ? [s] : [] });
  }
  const execs = all("SELECT id FROM users WHERE company_id=? AND active=1 AND role IN ('sales_executive','telecaller','team_leader','sales_manager','field_executive')", req.user.company_id);
  res.json({ rows: execs.map((e) => productivityScore(req.user.company_id, e.id)).filter(Boolean) });
});

// Property recommendations for a lead
router.get('/recommend/:leadId', (req, res) => {
  const lead = get('SELECT * FROM leads WHERE id=? AND company_id=?', req.params.leadId, req.user.company_id);
  if (!lead) return res.status(404).json({ error: 'Not found' });
  const units = all('SELECT * FROM units WHERE company_id=? AND availability IN (?,?)', req.user.company_id, 'Available', 'Reserved');
  const budget = lead.budget || 0;
  const recs = units
    .filter((u) => (budget ? Math.abs(u.price - budget) / budget <= 0.5 : true))
    .sort((a, b) => (budget ? Math.abs(a.price - budget) - Math.abs(b.price - budget) : a.price - b.price))
    .slice(0, 6)
    .map((u) => ({ ...u, match: budget ? Math.max(0, Math.round(100 - (Math.abs(u.price - budget) / budget) * 100)) : 50 }));
  res.json(recs);
});

// Executive performance analysis
router.get('/exec-analysis', (req, res) => {
  const cid = req.user.company_id;
  const rows = all(
    `SELECT u.id, u.name,
       (SELECT COUNT(*) FROM leads l WHERE l.owner_id=u.id) leads,
       (SELECT COUNT(*) FROM site_visits v WHERE v.user_id=u.id) visits,
       (SELECT COUNT(*) FROM leads l WHERE l.owner_id=u.id AND l.status IN ('booking','payment','registered','won')) bookings
     FROM users u WHERE u.company_id=? AND u.active=1 AND u.role IN ('sales_executive','telecaller','team_leader','sales_manager')`,
    cid);
  const analysis = rows.map((r) => {
    const conv = r.leads ? r.bookings / r.leads : 0;
    const visitRate = r.leads ? r.visits / r.leads : 0;
    let level = 'Needs coaching';
    let tip = 'Increase call quality and follow-up consistency to boost conversion.';
    if (conv >= 0.15) { level = 'Top performer'; tip = 'Great conversion rate. Mentor peers and focus on high-value deals.'; }
    else if (conv >= 0.07) { level = 'On track'; tip = 'Keep momentum. Prioritize hot leads and shorten follow-up cycles.'; }
    if (visitRate < 0.1 && r.leads > 3) tip = 'Too few site visits. Convert interest into scheduled visits.';
    return { ...r, conversion: Math.round(conv * 100), level, tip };
  });
  res.json(analysis);
});

export default router;
