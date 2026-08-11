import { Router } from 'express';
import { get, run, all, ts, id, audit } from '../db.js';
import { hydrate, hydratelist } from '../lib/helpers.js';
import { sharePayloads, trackClick, attributeLead } from '../lib/referrals.js';

const router = Router();

// ---- Public: branding for a company slug (no auth) ----
router.get('/public/branding/:slug', (req, res) => {
  const co = get('SELECT * FROM companies WHERE slug=?', req.params.slug);
  if (!co) return res.status(404).json({ error: 'Company not found' });
  const settings = hydrate(co, ['settings']).settings || {};
  res.json({
    name: co.name,
    logo: settings.branding?.logo || null,
    theme: settings.branding?.theme || { primary: '#7c3aed' },
    loginScreen: settings.branding?.loginScreen || null,
    supportContact: settings.contact?.support || null,
    customDomain: settings.customDomain || null
  });
});

router.get('/public/company/list', (req, res) => {
  const rows = all('SELECT id, name, slug FROM companies WHERE status=?', 'active');
  res.json(rows);
});

// ---- Public: project catalogue share page (no auth) ----
router.get('/public/catalogue/:slug', (req, res) => {
  const p = get('SELECT * FROM projects WHERE share_slug=?', req.params.slug);
  if (!p) return res.status(404).json({ error: 'Catalogue not found' });
  const project = hydrate(p, ['amenities', 'photos', 'nearby']);
  const co = get('SELECT * FROM companies WHERE id=?', project.company_id);
  const settings = co ? hydrate(co, ['settings']).settings || {} : {};
  const media = all('SELECT * FROM project_media WHERE project_id=? ORDER BY sort ASC', project.id);
  const priceList = all('SELECT * FROM project_price_lists WHERE project_id=? ORDER BY created_at ASC', project.id);
  const updates = all('SELECT * FROM construction_updates WHERE project_id=? ORDER BY date DESC', project.id);
  res.json({
    project: { ...project, amenities: project.amenities || [], photos: project.photos || [], nearby: project.nearby || {} },
    builder: { name: project.builder_name || co?.name || 'Builder', logo: project.builder_logo || settings.branding?.logo || null },
    media, priceList, updates,
    rera: project.rera_number || project.rera_ref || null,
    shareUrl: `/share/${project.share_slug}`
  });
});

// QR code for the public catalogue (pure-JS 1x1 px PNG placeholder -> the page renders its own QR)
router.get('/public/catalogue/:slug/qr', (req, res) => {
  const p = get('SELECT * FROM projects WHERE share_slug=?', req.params.slug);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const url = `${req.protocol}://${req.get('host')}/share/${p.share_slug}`;
  res.json({ url });
});

// ---- Customer Portal (token-based, no password) ----
router.get('/portal/customer/:token', (req, res) => {
  // token is customer id encoded in base64url
  let cid = null;
  try { cid = Buffer.from(req.params.token, 'base64url').toString('utf8'); } catch { /* ignore */ }
  const customer = get('SELECT * FROM customers WHERE id=?', cid);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  const bookings = hydratelist(all('SELECT * FROM bookings WHERE customer_id=?', customer.id), ['payment_plan']);
  const payments = all('SELECT * FROM payments WHERE customer_id=? ORDER BY date DESC', customer.id);
  const invoices = all('SELECT * FROM invoices WHERE customer_id=? ORDER BY date DESC', customer.id);
  const documents = hydratelist(all('SELECT * FROM documents WHERE entity_type=? AND entity_id=?', 'customer', customer.id));
  const units = bookings.map((b) => get('SELECT * FROM units WHERE id=?', b.unit_id)).filter(Boolean);
  const co = get('SELECT * FROM companies WHERE id=?', customer.company_id);
  const settings = hydrate(co, ['settings']).settings || {};
  const projectUpdates = all('SELECT * FROM documents WHERE entity_type=? AND entity_id IN (' + units.map(() => '?').join(',') + ') OR (entity_type=? AND entity_id IN (' + units.map(() => '?').join(',') + '))', ...units.map((u) => u.project_id), ...units.map(() => 'project'));

  res.json({
    customer: { name: customer.name, phone: customer.phone, email: customer.email, loyalty_points: customer.loyalty_points, kyc_status: customer.kyc_status },
    company: { name: co.name, settings },
    bookings, payments, invoices, documents, units,
    outstanding: invoices.filter((i) => ['sent', 'overdue'].includes(i.status)).reduce((s, i) => s + i.amount, 0)
  });
});

// ---- Public Lead Intake / Lead Aggregation API (API key protected) ----
// Accepts full lead payloads incl. campaign_id, UTM params, geo coordinates.
router.post('/intake', async (req, res) => {
  const key = req.headers['x-api-key'] || '';
  const apiKey = key ? get('SELECT * FROM api_keys WHERE key_hash=?', key) : null;
  if (!apiKey) return res.status(401).json({ error: 'Invalid API key' });
  const cid = apiKey.company_id;
  const b = req.body || {};
  if (!b.name || !b.phone) return res.status(400).json({ error: 'name and phone required' });
  const lid = id();
  run(`INSERT INTO leads (id, company_id, name, phone, email, source, medium, project_id, city, area, budget, requirement, priority, status, tags, campaign_id, utm_source, utm_medium, utm_campaign, utm_term, utm_content, landing_page, latitude, longitude, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    lid, cid, b.name, b.phone, b.email || null, b.source || 'API', b.medium || null, b.project_id || null,
    b.city || null, b.area || null, b.budget || null, b.requirement || null, b.priority || 'Warm', 'new_lead',
    JSON.stringify(b.tags || []), b.campaign_id || null, b.utm_source || null, b.utm_medium || null,
    b.utm_campaign || null, b.utm_term || null, b.utm_content || null, b.landing_page || null,
    b.latitude || null, b.longitude || null, ts(), ts());
  run('UPDATE api_keys SET last_used=? WHERE id=?', ts(), apiKey.id);
  if (b.referral_code) {
    try {
      const { attributeLead } = await import('../lib/referrals.js');
      attributeLead(cid, b.referral_code, lid, b.name, b.phone, { amount: b.referral_amount });
    } catch { /* attribution must not break intake */ }
  }
  const camp = b.campaign_id ? get('SELECT * FROM campaigns WHERE id=?', b.campaign_id)
    : (b.source ? get('SELECT * FROM campaigns WHERE company_id=? AND channel=? ORDER BY created_at DESC LIMIT 1', cid, b.source) : null);
  if (camp) run('UPDATE campaigns SET leads_count=leads_count+1 WHERE id=?', camp.id);
  audit({ company_id: cid, user_id: null, user_name: 'api', action: 'lead.create', entity: 'lead', entity_id: lid, detail: { via: 'api', source: b.source } });
  res.json({ ok: true, id: lid });
});

// WhatsApp-style webhook simulator for lead aggregation
router.post('/webhook/lead', (req, res) => {
  // Accepts payloads from form endpoints; maps to a company by header or env
  const cid = req.headers['x-company-id'] || req.query.company;
  const b = req.body || {};
  if (b.object && b.entry) {
    // simplistic WhatsApp cloud API shape
    const changes = b.entry?.[0]?.changes?.[0]?.value;
    const message = changes?.messages?.[0];
    if (message) {
      const name = changes.contacts?.[0]?.profile?.name || message.from;
      const text = message.text?.body || '';
      const source = req.headers['x-source'] || 'WhatsApp';
      if (cid) {
        const lid = id();
        run(`INSERT INTO leads (id, company_id, name, phone, source, requirement, priority, status, tags, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          lid, cid, name, message.from, source, text, 'Warm', 'new_lead', '[]', ts(), ts());
        return res.json({ ok: true, id: lid });
      }
    }
  }
  res.json({ ok: true, ignored: true });
});

// Google Forms compatible intake (POST form-encoded) - accept JSON too
router.post('/forms/intake', async (req, res) => {
  const cid = req.headers['x-company-id'] || req.body.company_id || req.query.company;
  if (!cid) return res.status(400).json({ error: 'x-company-id required' });
  const b = req.body || {};
  const name = b.name || b['Full Name'] || b.lead_name;
  const phone = b.phone || b['Phone'] || b.mobile;
  if (!name || !phone) return res.status(400).json({ error: 'name and phone required' });
  const lid = id();
  run(`INSERT INTO leads (id, company_id, name, phone, email, source, city, area, budget, requirement, priority, status, campaign_id, utm_source, utm_campaign, utm_medium, utm_term, utm_content, landing_page, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    lid, cid, name, phone, b.email || null, b.source || 'Google Forms', b.city || null, b.area || null,
    b.budget || null, b.requirement || null, 'Warm', 'new_lead', b.campaign_id || null, b.utm_source || null,
    b.utm_campaign || null, b.utm_medium || null, b.utm_term || null, b.utm_content || null, b.landing_page || null,
    ts(), ts());
  if (b.referral_code) {
    try {
      const { attributeLead } = await import('../lib/referrals.js');
      attributeLead(cid, b.referral_code, lid, name, phone, { amount: b.referral_amount });
    } catch { /* attribution must not break intake */ }
  }
  res.json({ ok: true, id: lid });
});

// ---- public referral endpoints (no auth; mounted before authenticated routers) ----
// resolve company for a referral code by scanning all referral rows
function companyForCode(refCode) {
  const r = all('SELECT company_id FROM referrals WHERE ref_code=? LIMIT 1', refCode);
  return r.length ? r[0].company_id : null;
}

router.get('/referrals/share/:code', (req, res) => {
  const cid = req.query.company || companyForCode(req.params.code);
  if (!cid) return res.status(404).json({ error: 'Referral not found' });
  const payload = sharePayloads(cid, req.params.code);
  if (!payload) return res.status(404).json({ error: 'Referral not found' });
  res.json(payload);
});

router.post('/referrals/click/:code', (req, res) => {
  const cid = req.body?.company || companyForCode(req.params.code);
  if (cid) trackClick(cid, req.params.code);
  res.json({ ok: true });
});

router.post('/referrals/attribute', (req, res) => {
  const b = req.body || {};
  const cid = b.company_id || companyForCode(b.ref_code);
  if (!cid || !b.ref_code) return res.status(400).json({ error: 'ref_code and company_id required' });
  if (!b.name || !b.phone) return res.status(400).json({ error: 'name and phone required' });
  const lid = id();
  run(`INSERT INTO leads (id, company_id, name, phone, email, source, medium, priority, status, tags, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    lid, cid, b.name, b.phone, b.email || null, b.source || 'Referral', b.medium || 'link', b.priority || 'Warm', 'new_lead', '[]', ts(), ts());
  const result = attributeLead(cid, b.ref_code, lid, b.name, b.phone, { amount: b.amount, status: b.reward_status });
  res.json({ ok: true, id: lid, ...(result || {}) });
});

export default router;