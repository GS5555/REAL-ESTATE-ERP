import { Router } from 'express';
import { get, run, all, ts, id, audit, notify } from '../db.js';
import { hydrate, hydratelist, getStages } from '../lib/helpers.js';
import { requireAuth, requirePerm, can } from '../auth.js';
import { paginate, hydrate as h, csv } from '../lib/helpers.js';

const router = Router();
router.use(requireAuth);

const PROJ_TYPES = ['Residential', 'Commercial', 'Office Space', 'Retail Shops', 'Warehouses', 'Industrial', 'Plots', 'Farmhouse', 'Villa', 'Resale', 'Rental'];
const PROJ_STATUS = ['Under Construction', 'Ready Possession', 'Completed', 'Pre-Launch'];
const UNIT_STATUS = ['Available', 'Reserved', 'Booked', 'Sold', 'Blocked'];
const BOOK_STATUS = ['Unsold', 'Token', 'Booked', 'Agreement', 'Registered', 'Possession'];

// ================= PROJECTS =================
router.get('/projects', (req, res) => {
  if (!can(req.user, 'project.view')) return res.status(403).json({ error: 'Forbidden' });
  const rows = hydratelist(
    all('SELECT * FROM projects WHERE company_id=? ORDER BY created_at DESC', req.user.company_id),
    ['amenities', 'photos', 'nearby']
  );
  res.json(rows);
});

router.get('/projects/:id', (req, res) => {
  const p = hydrate(get('SELECT * FROM projects WHERE id=? AND company_id=?', req.params.id, req.user.company_id), ['amenities', 'photos', 'nearby']);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
});

router.post('/projects', (req, res) => {
  if (!can(req.user, 'project.create')) return res.status(403).json({ error: 'Forbidden' });
  const { name, type, subtype, status, city, location, area, price_range, description, brochure_url, photos, video_url, virtual_tour_url, google_map, amenities, nearby } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name required' });
  const pid = id();
  run(`INSERT INTO projects (id, company_id, name, type, subtype, status, city, location, area, price_range, description,
        brochure_url, photos, video_url, virtual_tour_url, google_map, amenities, nearby, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    pid, req.user.company_id, name, type || 'Residential', subtype || null, status || 'Under Construction',
    city || null, location || null, area || null, price_range || null, description || null,
    brochure_url || null, JSON.stringify(photos || []), video_url || null, virtual_tour_url || null,
    google_map || null, JSON.stringify(amenities || []), JSON.stringify(nearby || {}), ts());
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'project.create', entity: 'project', entity_id: pid, detail: { name } });
  res.json({ ok: true, id: pid });
});

router.patch('/projects/:id', (req, res) => {
  if (!can(req.user, 'project.edit')) return res.status(403).json({ error: 'Forbidden' });
  const p = get('SELECT * FROM projects WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const fields = ['name', 'type', 'subtype', 'status', 'city', 'location', 'area', 'price_range', 'description', 'brochure_url', 'video_url', 'virtual_tour_url', 'google_map', 'builder_name', 'builder_logo', 'rera_number', 'rera_ref', 'maps_embed'];
  const jsonFields = ['photos', 'amenities', 'nearby', 'location_advantages', 'floor_plans', 'master_layouts', 'price_list', 'brochures'];
  for (const f of fields) if (req.body[f] !== undefined) run(`UPDATE projects SET ${f}=? WHERE id=?`, req.body[f], p.id);
  for (const f of jsonFields) if (req.body[f] !== undefined) run(`UPDATE projects SET ${f}=? WHERE id=?`, JSON.stringify(req.body[f]), p.id);
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'project.update', entity: 'project', entity_id: p.id });
  res.json({ ok: true });
});

router.delete('/projects/:id', (req, res) => {
  if (!can(req.user, 'project.delete')) return res.status(403).json({ error: 'Forbidden' });
  const p = get('SELECT * FROM projects WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  run('DELETE FROM projects WHERE id=?', p.id);
  run('DELETE FROM units WHERE project_id=?', p.id);
  run('DELETE FROM buildings WHERE project_id=?', p.id);
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'project.delete', entity: 'project', entity_id: p.id });
  res.json({ ok: true });
});

// ================= PROJECT CATALOGUE (V2) =================
// Media / price lists / construction updates + public share URL

router.post('/projects/:id/media', (req, res) => {
  if (!can(req.user, 'project.edit')) return res.status(403).json({ error: 'Forbidden' });
  const p = get('SELECT * FROM projects WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  if (!b.url) return res.status(400).json({ error: 'url required' });
  const mid = id();
  run(`INSERT INTO project_media (id, company_id, project_id, kind, url, title, sort, created_at) VALUES (?,?,?,?,?,?,?,?)`,
    mid, req.user.company_id, p.id, b.kind || 'image', b.url, b.title || null, b.sort || 0, ts());
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'project.media', entity: 'project', entity_id: p.id, module: 'catalogue' });
  res.json({ ok: true, id: mid });
});

router.delete('/projects/:id/media/:mid', (req, res) => {
  if (!can(req.user, 'project.edit')) return res.status(403).json({ error: 'Forbidden' });
  run('DELETE FROM project_media WHERE id=? AND project_id=?', req.params.mid, req.params.id);
  res.json({ ok: true });
});

router.get('/projects/:id/catalogue', (req, res) => {
  if (!can(req.user, 'project.view')) return res.status(403).json({ error: 'Forbidden' });
  const p = hydrate(get('SELECT * FROM projects WHERE id=? AND company_id=?', req.params.id, req.user.company_id), ['amenities', 'photos', 'nearby']);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const media = all('SELECT * FROM project_media WHERE project_id=? ORDER BY sort ASC', p.id);
  const priceList = all('SELECT * FROM project_price_lists WHERE project_id=? ORDER BY created_at ASC', p.id);
  const updates = all('SELECT * FROM construction_updates WHERE project_id=? ORDER BY date DESC', p.id);
  res.json({ project: p, media, priceList, updates, shareUrl: p.share_slug ? `/share/${p.share_slug}` : null });
});

router.post('/projects/:id/prices', (req, res) => {
  if (!can(req.user, 'project.edit')) return res.status(403).json({ error: 'Forbidden' });
  const p = get('SELECT * FROM projects WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  if (!b.unit_type) return res.status(400).json({ error: 'unit_type required' });
  const pid2 = id();
  run(`INSERT INTO project_price_lists (id, company_id, project_id, unit_type, size, price, created_at) VALUES (?,?,?,?,?,?,?)`,
    pid2, req.user.company_id, p.id, b.unit_type, b.size || null, b.price || 0, ts());
  res.json({ ok: true, id: pid2 });
});

router.post('/projects/:id/updates', (req, res) => {
  if (!can(req.user, 'project.edit')) return res.status(403).json({ error: 'Forbidden' });
  const p = get('SELECT * FROM projects WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: 'title required' });
  const uid = id();
  run(`INSERT INTO construction_updates (id, company_id, project_id, title, body, date, created_at) VALUES (?,?,?,?,?,?,?)`,
    uid, req.user.company_id, p.id, b.title, b.body || null, b.date || ts().slice(0, 10), ts());
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'project.update.post', entity: 'project', entity_id: p.id, module: 'catalogue' });
  res.json({ ok: true, id: uid });
});

// Generate/refresh public share slug (enables QR + brochure + share URL)
router.post('/projects/:id/share', (req, res) => {
  if (!can(req.user, 'project.edit')) return res.status(403).json({ error: 'Forbidden' });
  const p = get('SELECT * FROM projects WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const slug = (req.body?.slug || p.share_slug || (p.name || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + p.id.slice(0, 6));
  run('UPDATE projects SET share_slug=? WHERE id=?', slug, p.id);
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'project.share', entity: 'project', entity_id: p.id, module: 'catalogue' });
  res.json({ ok: true, slug, shareUrl: `/share/${slug}`, qrUrl: `/api/public/catalogue/${slug}/qr` });
});

// ================= BUILDINGS =================
router.get('/projects/:id/buildings', (req, res) => {
  res.json(all('SELECT * FROM buildings WHERE project_id=?', req.params.id));
});
router.post('/projects/:id/buildings', (req, res) => {
  const { name, total_floors } = req.body || {};
  run(`INSERT INTO buildings (id, company_id, project_id, name, total_floors, created_at) VALUES (?,?,?,?,?,?)`,
    id(), req.user.company_id, req.params.id, name || 'Tower', total_floors || 1, ts());
  res.json({ ok: true });
});

// ================= INVENTORY (UNITS) =================
router.get('/units', (req, res) => {
  if (!can(req.user, 'inventory.view')) return res.status(403).json({ error: 'Forbidden' });
  const { page, limit, offset } = paginate(req);
  const where = ['company_id=?'];
  const args = [req.user.company_id];
  if (req.query.project_id) { where.push('project_id=?'); args.push(req.query.project_id); }
  if (req.query.availability) { where.push('availability=?'); args.push(req.query.availability); }
  if (req.query.q) { where.push('(number LIKE ? OR unit_type LIKE ?)'); args.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const total = get(`SELECT COUNT(*) n FROM units WHERE ${where.join(' AND ')}`, ...args).n;
  const rows = hydratelist(
    all(`SELECT * FROM units WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`, ...args, limit, offset),
    ['amenities', 'photos']
  );
  res.json({ items: rows, total, page, limit });
});

router.get('/units/:id', (req, res) => {
  const u = hydrate(get('SELECT * FROM units WHERE id=? AND company_id=?', req.params.id, req.user.company_id), ['amenities', 'photos']);
  if (!u) return res.status(404).json({ error: 'Not found' });
  res.json(u);
});

router.post('/units', (req, res) => {
  if (!can(req.user, 'inventory.create')) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  if (!b.number) return res.status(400).json({ error: 'Unit number required' });
  if (b.project_id) {
    const p = get('SELECT id FROM projects WHERE id=? AND company_id=?', b.project_id, req.user.company_id);
    if (!p) return res.status(400).json({ error: 'Project not found' });
  }
  const uid = id();
  run(`INSERT INTO units (id, company_id, project_id, building_id, floor, number, unit_type, carpet_area, builtup_area,
        price, availability, booking_status, amenities, floor_plan_url, photos, qr_code, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    uid, req.user.company_id, b.project_id || null, b.building_id || null, b.floor || 1, b.number, b.unit_type || '2 BHK',
    b.carpet_area || 0, b.builtup_area || 0, b.price || 0, b.availability || 'Available', b.booking_status || 'Unsold',
    JSON.stringify(b.amenities || []), b.floor_plan_url || null, JSON.stringify(b.photos || []),
    Buffer.from(`${b.number}`).toString('base64url'), ts());
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'unit.create', entity: 'unit', entity_id: uid, detail: { number: b.number } });
  res.json({ ok: true, id: uid });
});

router.patch('/units/:id', (req, res) => {
  if (!can(req.user, 'inventory.edit')) return res.status(403).json({ error: 'Forbidden' });
  const u = get('SELECT * FROM units WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const fields = ['project_id', 'building_id', 'floor', 'number', 'unit_type', 'carpet_area', 'builtup_area', 'price', 'availability', 'booking_status', 'customer_id', 'floor_plan_url', 'reserved_until'];
  const jsonFields = ['amenities', 'photos'];
  for (const f of fields) if (req.body[f] !== undefined) run(`UPDATE units SET ${f}=? WHERE id=?`, req.body[f], u.id);
  for (const f of jsonFields) if (req.body[f] !== undefined) run(`UPDATE units SET ${f}=? WHERE id=?`, JSON.stringify(req.body[f]), u.id);
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'unit.update', entity: 'unit', entity_id: u.id, detail: req.body });
  res.json({ ok: true });
});

// Reserve unit with automatic expiry
router.post('/units/:id/reserve', (req, res) => {
  if (!can(req.user, 'inventory.reserve')) return res.status(403).json({ error: 'Forbidden' });
  const u = get('SELECT * FROM units WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  if (u.availability === 'Sold' || u.availability === 'Booked') return res.status(400).json({ error: 'Unit not available' });
  const days = parseInt(req.body?.days, 10) || 7;
  const until = new Date(Date.now() + days * 86400000).toISOString();
  run(`UPDATE units SET availability='Reserved', reserved_until=? WHERE id=?`, until, u.id);
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'unit.reserve', entity: 'unit', entity_id: u.id, detail: { until } });
  res.json({ ok: true, reserved_until: until });
});

router.post('/units/:id/release', (req, res) => {
  if (!can(req.user, 'inventory.reserve')) return res.status(403).json({ error: 'Forbidden' });
  run(`UPDATE units SET availability='Available', reserved_until=NULL, customer_id=NULL WHERE id=? AND company_id=?`, req.params.id, req.user.company_id);
  res.json({ ok: true });
});

// Export inventory CSV
router.get('/units/export/csv', (req, res) => {
  if (!can(req.user, 'inventory.view') || !can(req.user, 'report.export')) return res.status(403).json({ error: 'Forbidden' });
  const rows = all('SELECT * FROM units WHERE company_id=?', req.user.company_id);
  const data = rows.map((u) => ({
    Number: u.number, Type: u.unit_type, Floor: u.floor, Carpet: u.carpet_area, Builtup: u.builtup_area,
    Price: u.price, Availability: u.availability, Booking: u.booking_status
  }));
  const cols = Object.keys(data[0] || {}).map((k) => ({ label: k, accessor: (r) => r[k] }));
  const content = csv(data, cols);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="inventory.csv"');
  res.send(content);
});

// Meta endpoint for master data enums
router.get('/meta/enums', (req, res) => {
  res.json({ PROJ_TYPES, PROJ_STATUS, UNIT_STATUS, BOOK_STATUS, SOURCES: leadSources });
});

// ================= CUSTOM PIPELINE STAGES (configurable by manager) =================
router.get('/pipeline-stages', (req, res) => {
  if (!can(req.user, 'pipeline.view')) return res.status(403).json({ error: 'Forbidden' });
  res.json({ stages: getStages(req.user.company_id) });
});

router.post('/pipeline-stages', (req, res) => {
  if (!can(req.user, 'pipeline.manage')) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  if (!b.key || !b.label) return res.status(400).json({ error: 'key and label required' });
  const existing = get('SELECT id FROM pipeline_stages WHERE company_id=? AND key=?', req.user.company_id, b.key);
  if (existing) return res.status(400).json({ error: 'Stage key already exists' });
  const sid = id();
  const maxSort = get('SELECT COALESCE(MAX(sort),0) m FROM pipeline_stages WHERE company_id=?', req.user.company_id).m;
  run(`INSERT INTO pipeline_stages (id, company_id, key, label, sort, color, requires_approval, is_win, is_lost, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    sid, req.user.company_id, b.key, b.label, b.sort ?? maxSort + 1, b.color || '#94a3b8',
    b.requires_approval ? 1 : 0, b.is_win ? 1 : 0, b.is_lost ? 1 : 0, ts());
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'pipeline.stage.create', entity: 'pipeline', entity_id: sid, detail: { key: b.key, label: b.label } });
  res.json({ ok: true, id: sid });
});

router.patch('/pipeline-stages/:key', (req, res) => {
  if (!can(req.user, 'pipeline.manage')) return res.status(403).json({ error: 'Forbidden' });
  const st = get('SELECT * FROM pipeline_stages WHERE company_id=? AND key=?', req.user.company_id, req.params.key);
  if (!st) return res.status(404).json({ error: 'Stage not found' });
  const b = req.body || {};
  const fields = ['label', 'sort', 'color'];
  for (const f of fields) if (b[f] !== undefined) run(`UPDATE pipeline_stages SET ${f}=? WHERE id=?`, b[f], st.id);
  if (b.requires_approval !== undefined) run('UPDATE pipeline_stages SET requires_approval=? WHERE id=?', b.requires_approval ? 1 : 0, st.id);
  if (b.is_win !== undefined) run('UPDATE pipeline_stages SET is_win=? WHERE id=?', b.is_win ? 1 : 0, st.id);
  if (b.is_lost !== undefined) run('UPDATE pipeline_stages SET is_lost=? WHERE id=?', b.is_lost ? 1 : 0, st.id);
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'pipeline.stage.update', entity: 'pipeline', entity_id: st.id, detail: b });
  res.json({ ok: true });
});

router.delete('/pipeline-stages/:key', (req, res) => {
  if (!can(req.user, 'pipeline.manage')) return res.status(403).json({ error: 'Forbidden' });
  const st = get('SELECT * FROM pipeline_stages WHERE company_id=? AND key=?', req.user.company_id, req.params.key);
  if (!st) return res.status(404).json({ error: 'Stage not found' });
  if (['won', 'lost'].includes(st.key)) return res.status(400).json({ error: 'Cannot delete Won/Lost stages' });
  run('UPDATE leads SET status=? WHERE status=? AND company_id=?', 'new_lead', st.key, req.user.company_id);
  run('DELETE FROM pipeline_stages WHERE id=?', st.id);
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'pipeline.stage.delete', entity: 'pipeline', entity_id: st.id, detail: { key: st.key } });
  res.json({ ok: true });
});

// Reorder stages: body { order: ['new_lead','contacted',...] }
router.put('/pipeline-stages/order', (req, res) => {
  if (!can(req.user, 'pipeline.manage')) return res.status(403).json({ error: 'Forbidden' });
  const order = req.body?.order || [];
  order.forEach((key, i) => run('UPDATE pipeline_stages SET sort=? WHERE company_id=? AND key=?', i, req.user.company_id, key));
  res.json({ ok: true });
});

const leadSources = ['99acres', 'MagicBricks', 'Housing.com', 'Facebook', 'Instagram', 'Google Ads', 'Google Forms', 'Website', 'Landing Page', 'WhatsApp', 'Email', 'Call Tracking', 'Justdial', 'IndiaMART', 'TradeIndia', 'Property Portal', 'Manual', 'CSV Import', 'Excel Import', 'API', 'Channel Partner', 'Referral', 'Walk-in'];

export default router;
