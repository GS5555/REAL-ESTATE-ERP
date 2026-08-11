// V2 Property Listing Module (builders + brokers) + Listing Import System.
import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { get, run, all, ts, id, audit } from '../db.js';
import { hydrate, hydratelist, paginate, csv } from '../lib/helpers.js';
import { requireAuth, can } from '../auth.js';

const router = Router();
router.use(requireAuth);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const B2B_PORTALS = {
  '99acres': { baseUrl: 'https://www.99acres.com', label: '99acres', images: ['https://img.staticmb.com', 'https://imgs.99acres.com', 'https://res.cloudinary.com'] },
  'housing.com': { baseUrl: 'https://housing.com', label: 'Housing.com', images: ['https://img.staticmb.com', 'https://housing.com'] },
  'magicbricks': { baseUrl: 'https://www.magicbricks.com', label: 'MagicBricks', images: ['https://img.staticmb.com', 'https://magicbricks.1cdn.in'] },
  'nobroker': { baseUrl: 'https://www.nobroker.in', label: 'NoBroker', images: ['https://img.nobroker.in'] }
};

export const LISTING_CATEGORIES = {
  Residential: ['Apartment', 'Villa', 'Row House', 'Bungalow', 'Plot'],
  Commercial: ['Office', 'Shop', 'Showroom', 'Warehouse', 'Industrial Shed'],
  Industrial: ['Factory', 'MIDC Property'],
  Land: ['Agricultural Land', 'NA Land', 'Industrial Plot', 'Commercial Plot']
};
export const TRANSACTION_TYPES = ['Sale', 'Resale', 'Rent', 'Lease', 'Pre-launch', 'Under Construction', 'Ready Possession'];
export const LISTING_SOURCES = ['MagicBricks', 'Housing.com', '99acres', 'NoBroker', 'Facebook Marketplace', 'Website', 'Referral', 'Manual'];

// ==================== LISTINGS CRUD ====================
router.get('/listings', (req, res) => {
  if (!can(req.user, 'listing.view')) return res.status(403).json({ error: 'Forbidden' });
  const where = ['company_id=?'];
  const args = [req.user.company_id];
  const f = req.query;
  if (f.category) { where.push('category=?'); args.push(f.category); }
  if (f.subtype) { where.push('subtype=?'); args.push(f.subtype); }
  if (f.transaction_type) { where.push('transaction_type=?'); args.push(f.transaction_type); }
  if (f.status) { where.push('status=?'); args.push(f.status); }
  if (f.price_min) { where.push('price>=?'); args.push(Number(f.price_min)); }
  if (f.price_max) { where.push('price<=?'); args.push(Number(f.price_max)); }
  if (f.q) { where.push('(title LIKE ? OR location LIKE ? OR contact_name LIKE ?)'); args.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`); }
  const { page, limit, offset } = paginate(req);
  const total = get(`SELECT COUNT(*) n FROM listings WHERE ${where.join(' AND ')}`, ...args).n;
  const rows = hydratelist(
    all(`SELECT * FROM listings WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`, ...args, limit, offset),
    ['images', 'videos', 'amenities']);
  res.json({ items: rows, total, page, limit });
});

router.get('/listings/export/csv', (req, res) => {
  if (!can(req.user, 'listing.view') || !can(req.user, 'listing.export')) return res.status(403).json({ error: 'Forbidden' });
  const rows = all('SELECT * FROM listings WHERE company_id=? ORDER BY created_at DESC', req.user.company_id);
  const data = rows.map((l) => ({
    Title: l.title, Category: l.category || '', Subtype: l.subtype || '', 'Transaction': l.transaction_type || '',
    Price: l.price ?? 0, Size: l.size ?? '', Location: l.location || '', City: l.city || '', Area: l.area || '',
    Source: l.source || '', 'Owner Type': l.owner_type || '', 'Contact Name': l.contact_name || '',
    'Contact Phone': l.contact_phone || '', 'Contact Email': l.contact_email || '', Status: l.status || '',
    Verified: l.verified ? 'Yes' : 'No', 'Created': (l.created_at || '').slice(0, 10)
  }));
  const cols = Object.keys(data[0] || {}).map((k) => ({ label: k, accessor: (r) => r[k] }));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="listings.csv"');
  res.send(csv(data, cols));
});

router.get('/listings/meta', (req, res) => {
  res.json({ categories: LISTING_CATEGORIES, transactionTypes: TRANSACTION_TYPES, sources: LISTING_SOURCES });
});

router.get('/listings/:id', (req, res) => {
  const l = hydrate(get('SELECT * FROM listings WHERE id=? AND company_id=?', req.params.id, req.user.company_id), ['images', 'videos', 'amenities']);
  if (!l) return res.status(404).json({ error: 'Not found' });
  res.json(l);
});

function upsertListing(companyId, b) {
  const uniqueKey = b.unique_key || `${b.source || 'Manual'}:${(b.contact_phone || '')}:${(b.title || '').trim().toLowerCase().replace(/\s+/g, '-')}`;
  const existing = get('SELECT id FROM listings WHERE company_id=? AND unique_key=?', companyId, uniqueKey);
  const lid = existing ? existing.id : id();
  if (existing) {
    run(`UPDATE listings SET source=?, title=?, description=?, price=?, size=?, location=?, city=?, area=?, project_id=?,
          owner_type=?, broker_id=?, contact_name=?, contact_phone=?, contact_email=?, images=?, videos=?, amenities=?,
          floor_plan_url=?, status=?, updated_at=? WHERE id=?`,
      b.source || 'Manual', b.title, b.description || null, b.price ?? 0, b.size ?? null, b.location || null, b.city || null, b.area || null,
      b.project_id || null, b.owner_type || 'builder', b.broker_id || null, b.contact_name || null, b.contact_phone || null, b.contact_email || null,
      JSON.stringify(b.images || []), JSON.stringify(b.videos || []), JSON.stringify(b.amenities || []),
      b.floor_plan_url || null, b.status || 'active', ts(), lid);
  } else {
    run(`INSERT INTO listings (id, company_id, source, external_id, unique_key, category, subtype, transaction_type, title, description,
          price, size, location, city, area, project_id, owner_type, broker_id, contact_name, contact_phone, contact_email,
          images, videos, amenities, floor_plan_url, status, verified, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      lid, companyId, b.source || 'Manual', b.external_id || null, uniqueKey, b.category || 'Residential', b.subtype || 'Apartment',
      b.transaction_type || 'Sale', b.title, b.description || null, b.price ?? 0, b.size ?? null, b.location || null, b.city || null, b.area || null,
      b.project_id || null, b.owner_type || 'builder', b.broker_id || null, b.contact_name || null, b.contact_phone || null, b.contact_email || null,
      JSON.stringify(b.images || []), JSON.stringify(b.videos || []), JSON.stringify(b.amenities || []),
      b.floor_plan_url || null, b.status || 'active', b.verified ? 1 : 0, ts(), ts());
  }
  return { id: lid, created: !existing };
}

router.post('/listings', (req, res) => {
  if (!can(req.user, 'listing.create')) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: 'title required' });
  const r = upsertListing(req.user.company_id, b);
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'listing.create', entity: 'listing', entity_id: r.id, module: 'listing' });
  res.json({ ok: true, id: r.id, created: r.created });
});

router.patch('/listings/:id', (req, res) => {
  if (!can(req.user, 'listing.edit')) return res.status(403).json({ error: 'Forbidden' });
  const l = get('SELECT * FROM listings WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!l) return res.status(404).json({ error: 'Not found' });
  const plain = ['category', 'subtype', 'transaction_type', 'title', 'description', 'price', 'size', 'location', 'city', 'area', 'project_id', 'owner_type', 'broker_id', 'contact_name', 'contact_phone', 'contact_email', 'floor_plan_url', 'status', 'verified'];
  const json = ['images', 'videos', 'amenities'];
  for (const f of plain) if (req.body[f] !== undefined) run(`UPDATE listings SET ${f}=? WHERE id=?`, req.body[f], l.id);
  for (const f of json) if (req.body[f] !== undefined) run(`UPDATE listings SET ${f}=? WHERE id=?`, JSON.stringify(req.body[f]), l.id);
  run('UPDATE listings SET updated_at=? WHERE id=?', ts(), l.id);
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'listing.update', entity: 'listing', entity_id: l.id, module: 'listing' });
  res.json({ ok: true });
});

// ==================== LISTING IMPORT (auto migration) ====================
// Generic importer: pass rows from a source feed. Each row maps portal fields to
// listing fields. Dedupe is handled by unique_key (source + phone + title slug).
router.post('/listings/import', (req, res) => {
  if (!can(req.user, 'listing.import')) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'rows required' });
  const source = b.source || 'Manual';
  let created = 0, updated = 0, skipped = 0, duplicates = 0;
  for (const r of rows.slice(0, 2000)) {
    const mapped = mapSourceFields(source, r);
    if (!mapped.title && !mapped.contact_phone) { skipped++; continue; }
    // duplicate detection: same phone + title within 24h
    const dup = get(`SELECT id FROM listings WHERE company_id=? AND contact_phone=? AND LOWER(title)=LOWER(?) AND created_at > ?`,
      req.user.company_id, mapped.contact_phone || '', mapped.title || '', new Date(Date.now() - 86400000).toISOString());
    if (dup && mapped.external_id) { duplicates++; continue; }
    const res2 = upsertListing(req.user.company_id, { ...mapped, source, external_id: r.external_id || r.listing_id || null });
    res2.created ? created++ : updated++;
  }
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'listing.import', entity: 'listing', detail: { source, created, updated, duplicates, skipped }, module: 'listing' });
  res.json({ ok: true, source, created, updated, duplicates, skipped });
});

// demo importer that fabricates a realistic feed (for showcasing the pipeline without real scrapers)
router.post('/listings/import/demo', (req, res) => {
  if (!can(req.user, 'listing.import')) return res.status(403).json({ error: 'Forbidden' });
  const source = req.body?.source || '99acres';
  const n = Math.min(25, parseInt(req.body?.count, 10) || 10);
  const areas = ['Andheri East', 'Kharghar', 'BKC', 'Powai', 'Worli', 'Baner', 'Kothrud'];
  const titles = ['2 BHK Premium Apartment', '3 BHK Sea View Villa', 'Luxury Office Suite', 'Corner Shop', 'Industrial Shed', 'NA Land Plot', '4 BHK Row House', 'Studio Apartment'];
  const rows = [];
  for (let i = 0; i < n; i++) {
    const title = titles[Math.floor(Math.random() * titles.length)];
    const area = areas[Math.floor(Math.random() * areas.length)];
    rows.push({
      external_id: `${source}-${Date.now()}-${i}`,
      title,
      description: `Spacious ${title} in ${area} with modern amenities, gated security and great connectivity.`,
      price: 5000000 + Math.floor(Math.random() * 40000000),
      size: 600 + Math.floor(Math.random() * 2500),
      location: `${area}, ${['Mumbai', 'Pune'][Math.floor(Math.random() * 2)]}`,
      city: Math.random() > 0.5 ? 'Mumbai' : 'Pune',
      area,
      category: Math.random() > 0.5 ? 'Residential' : 'Commercial',
      subtype: 'Apartment',
      transaction_type: ['Sale', 'Rent', 'Lease', 'Ready Possession'][Math.floor(Math.random() * 4)],
      contact_name: 'Listing Agent',
      contact_phone: `98${Math.floor(10000000 + Math.random() * 89999999)}`,
      contact_email: `agent${i}@demo.com`,
      images: [],
      amenities: ['Lift', 'Parking', 'Power Backup', 'Club House', 'Gym'].filter(() => Math.random() > 0.4),
      floor_plan_url: null
    });
  }
  const r = req.body?.dryRun ? { ok: true, count: rows.length, sample: rows.slice(0, 3) } : (() => {
    let created = 0, updated = 0, duplicates = 0;
    for (const row of rows) {
      if (get('SELECT id FROM listings WHERE company_id=? AND contact_phone=? AND LOWER(title)=LOWER(?)', req.user.company_id, row.contact_phone, row.title)) { duplicates++; continue; }
      upsertListing(req.user.company_id, { ...row, source });
      created++;
    }
    return { created, duplicates };
  })();
  res.json({ ok: true, source, count: rows.length, ...r });
});

// Map raw source rows to normalized listing fields per portal.
function mapSourceFields(source, r) {
  const t = (r.title || r.name || r.property_title || r.heading || '').trim();
  const price = parsePrice(r.price || r.amount || r.expected_price || r.cost);
  const images = Array.isArray(r.images) ? r.images : (r.image_urls ? String(r.image_urls).split(',').map((s) => s.trim()) : (r.image ? [r.image] : []));
  const videos = Array.isArray(r.videos) ? r.videos : (r.video_url ? [r.video_url] : []);
  const amenities = Array.isArray(r.amenities) ? r.amenities : (typeof r.amenities === 'string' ? String(r.amenities).split(',').map((s) => s.trim()) : []);
  const location = r.location || r.address || r.locality || r.area || '';
  const size = parsePrice(r.size || r.area_sqft || r.carpet_area || r.built_up_area);
  return {
    title: t,
    description: r.description || r.details || null,
    price,
    size,
    location,
    city: r.city || null,
    area: r.area || r.locality || null,
    contact_name: r.contact_name || r.owner_name || r.listed_by || null,
    contact_phone: r.contact_phone || r.phone || r.mobile || r.owner_phone || null,
    contact_email: r.contact_email || r.email || null,
    images,
    videos,
    amenities,
    floor_plan_url: r.floor_plan_url || r.floor_plan || null,
    transaction_type: r.transaction_type || (r.type === 'rent' ? 'Rent' : r.type === 'lease' ? 'Lease' : 'Sale'),
    category: r.category || inferCategory(t),
    subtype: r.subtype || null
  };
}

function inferCategory(title) {
  const s = (title || '').toLowerCase();
  if (/(office|shop|showroom|warehouse|shed|commercial)/.test(s)) return 'Commercial';
  if (/(factory|midc|industrial)/.test(s)) return 'Industrial';
  if (/(plot|land|agricultural)/.test(s)) return 'Land';
  return 'Residential';
}

function parsePrice(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[₹,\s]/g, '');
  const m = s.match(/^([\d.]+)(lakh|lac|l|cr|c|k)$/i);
  if (m) {
    const n = parseFloat(m[1]);
    const u = m[2].toLowerCase();
    if (u === 'lakh' || u === 'lac' || u === 'l') return n * 100000;
    if (u === 'cr' || u === 'c') return n * 10000000;
    if (u === 'k') return n * 1000;
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// ==================== B2B PORTAL IMAGE IMPORT ====================
// Import listing images from 99acres / Housing.com / MagicBricks / NoBroker.
// Remote image URLs are fetched server-side and mirrored into /uploads so the
// listing works even if the portal hotlink/CDN blocks browser requests.
async function mirrorImage(remoteUrl, maxBytes = 8 * 1024 * 1024) {
  try {
    const u = new URL(remoteUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(remoteUrl, { signal: controller.signal, redirect: 'follow' });
    clearTimeout(t);
    if (!resp.ok) return null;
    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > maxBytes) return null;
    const ext = (contentType.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const name = `${id()}.${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
    return `/uploads/${name}`;
  } catch {
    return null;
  }
}

router.get('/listings/b2b/portals', (req, res) => {
  if (!can(req.user, 'listing.import')) return res.status(403).json({ error: 'Forbidden' });
  res.json({ portals: Object.entries(B2B_PORTALS).map(([key, p]) => ({ key, label: p.label, baseUrl: p.baseUrl })) });
});

// Import one or more remote image URLs from a portal (mirror to /uploads).
// Body: { source: '99acres', images: [url...], listing: {...optional fields} }
router.post('/listings/b2b/import-images', async (req, res) => {
  if (!can(req.user, 'listing.import')) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  const images = Array.isArray(b.images) ? b.images.slice(0, 20) : [];
  if (!images.length) return res.status(400).json({ error: 'images[] required' });
  const portal = B2B_PORTALS[b.source] || { label: b.source || 'Portal' };
  const results = [];
  for (const url of images) {
    const local = await mirrorImage(url);
    results.push({ remote: url, local, status: local ? 'ok' : 'skipped' });
  }
  let listing = null;
  if (b.listing?.title) {
    const mapped = mapSourceFields(b.source, { ...b.listing, images: results.map((r) => r.local).filter(Boolean) });
    const r = upsertListing(req.user.company_id, { ...mapped, source: b.source || 'Manual' });
    listing = { id: r.id, created: r.created };
  }
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'listing.b2b_import', entity: 'listing', module: 'listing', detail: { source: portal.label, count: results.length, ok: results.filter((r) => r.status === 'ok').length } });
  res.json({ ok: true, source: portal.label, imported: results.filter((r) => r.status === 'ok').length, results, listing });
});

// Import an entire listing from a portal URL (best-effort page fetch → meta/og image extraction).
// Body: { source, url, listing? } — falls back gracefully when the portal is unreachable.
router.post('/listings/b2b/import', async (req, res) => {
  if (!can(req.user, 'listing.import')) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  const source = b.source || '99acres';
  const url = b.url || '';
  const listing = { ...(b.listing || {}) };
  let pageImages = [];
  let fetched = false;
  if (url) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 10000);
      const resp = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PropertyCRM/1.0)' } });
      clearTimeout(t);
      if (resp.ok) {
        const html = await resp.text();
        fetched = true;
        const imgRe = /<img[^>]+src=["']([^"']+)["']/gi;
        let m;
        const seen = new Set();
        while ((m = imgRe.exec(html)) && seen.size < 25) {
          const src = m[1].trim();
          if (/^\/\//.test(src)) continue;
          if (!/\.(jpe?g|png|webp)(\?|$)/i.test(src)) continue;
          const abs = src.startsWith('http') ? src : new URL(src, url).href;
          if (!seen.has(abs)) { seen.add(abs); pageImages.push(abs); }
        }
        const ogRe = /<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/i;
        const og = ogRe.exec(html);
        if (og && !seen.has(og[1])) pageImages.unshift(new URL(og[1], url).href);
      }
    } catch { /* portal unreachable from sandbox — caller-provided images still work */ }
  }
  const imagesToFetch = [...new Set([...pageImages, ...(Array.isArray(listing.images) ? listing.images : [])])].slice(0, 20);
  const results = [];
  for (const u of imagesToFetch) {
    const local = await mirrorImage(u);
    results.push({ remote: u, local, status: local ? 'ok' : 'skipped' });
  }
  const localImages = results.map((r) => r.local).filter(Boolean);
  if (listing.title) {
    const mapped = mapSourceFields(source, { ...listing, images: localImages });
    const r = upsertListing(req.user.company_id, { ...mapped, source });
    audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'listing.b2b_import', entity: 'listing', entity_id: r.id, module: 'listing', detail: { source, url, page: fetched } });
    return res.json({ ok: true, source, url, fetched, imagesImported: localImages.length, results, listing: { id: r.id, created: r.created } });
  }
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'listing.b2b_import', entity: 'listing', module: 'listing', detail: { source, url, page: fetched, imagesImported: localImages.length } });
  res.json({ ok: true, source, url, fetched, imagesImported: localImages.length, results });
});

export default router;
