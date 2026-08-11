import { initSchema, run, get, all, ts, id, db, notify, audit } from './db.js';
import { hashPw } from './auth.js';

initSchema();

// wipe for idempotent seeding
for (const t of ['audit_log', 'api_keys', 'otp_codes', 'role_perms', 'feature_flags', 'notifications', 'documents', 'tickets', 'webhooks', 'scheduled_reports', 'commissions', 'partners', 'campaigns', 'expenses', 'leaves', 'attendance', 'employees', 'invoices', 'payments', 'bookings', 'customers', 'site_visits', 'activities', 'lead_merges', 'leads', 'units', 'buildings', 'projects', 'users', 'companies', 'support_chats', 'support_messages', 'conversations', 'conversation_members', 'conversation_messages', 'listings', 'loans', 'reminder_logs', 'location_trace', 'login_sessions', 'departments', 'teams', 'team_members', 'tasks', 'cross_access', 'project_media', 'project_price_lists', 'construction_updates']) {
  run(`DELETE FROM ${t}`);
}

const now = () => new Date().toISOString();
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();

// ---- Super admin (platform owner) ----
const superId = id();
run(
  `INSERT INTO users (id, company_id, name, email, phone, password_hash, role, active, mfa_enabled, created_at)
   VALUES (?,NULL,?,?,NULL,?,?,1,0,?)`,
  superId, 'Platform Super Admin', 'super@propease.dev', hashPw('Admin@123'), 'super_admin', now()
);

// ---- Demo company ----
const cid = id();
const settings = {
  branding: {
    companyName: 'Skyline Developers',
    tagline: 'Building Trust, Delivering Dreams',
    logo: '',
    theme: { primary: '#2563eb', primaryDark: '#1d4ed8', accent: '#f59e0b' },
    loginScreen: null,
    splashScreen: null
  },
  config: {
    gst: '27AABCS1234F1Z5',
    rera: 'P52100012345',
    bank: { bank: 'HDFC Bank', account: '50200012345678', ifsc: 'HDFC0001234', branch: 'Andheri East, Mumbai' },
    support: { email: 'support@skylinedev.in', phone: '+91 98765 43210' },
    invoiceTemplate: 'Standard',
    address: 'Skyline House, 4th Floor, Andheri East, Mumbai 400069',
    website: 'https://skylinedev.example.com',
    social: { facebook: 'https://facebook.com', instagram: 'https://instagram.com', linkedin: 'https://linkedin.com' },
    emailConfig: { smtp: 'smtp.example.com', from: 'no-reply@skylinedev.in' },
    smsConfig: { provider: 'MSG91', apiKey: '' },
    whatsappConfig: { provider: 'Meta Cloud API', phoneNumber: '919876543210' }
  },
  assignment: { mode: 'round_robin' },
  terms: 'Terms & conditions placeholder — customize per company.'
};

run(`INSERT INTO companies (id, name, slug, license_key, plan, status, billing_email, settings, created_at, expires_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  cid, 'Skyline Developers', 'skyline', 'LIC-DEMO-000001', 'enterprise', 'active', 'billing@skylinedev.in',
  JSON.stringify(settings), now(), new Date(Date.now() + 365 * 86400000).toISOString());

// ---- Company users ----
const users = {
  admin: ['Company Admin', 'admin@skyline.dev', 'Admin@123', 'company_admin'],
  director: ['Rajesh Mehta', 'director@skyline.dev', 'Director@123', 'director'],
  gm: ['Suresh Iyer', 'gm@skyline.dev', 'Gm@12345', 'general_manager'],
  sm: ['Priya Sharma', 'manager@skyline.dev', 'Manager@123', 'sales_manager'],
  tl: ['Amit Patel', 'tl@skyline.dev', 'Team@12345', 'team_leader'],
  se1: ['Rohan Verma', 'rohan@skyline.dev', 'Exec@12345', 'sales_executive'],
  se2: ['Neha Gupta', 'neha@skyline.dev', 'Exec@12345', 'sales_executive'],
  tc1: ['Vikram Singh', 'vikram@skyline.dev', 'Caller@123', 'telecaller'],
  mm: ['Kavita Rao', 'marketing@skyline.dev', 'Mkt@12345', 'marketing_manager'],
  fm: ['Anil Kumar', 'finance@skyline.dev', 'Fin@12345', 'finance_manager'],
  hr: ['Sunita Joshi', 'hr@skyline.dev', 'Hr@12345', 'hr_manager'],
  acct: ['Deepak Nair', 'accounts@skyline.dev', 'Acc@12345', 'accounts_executive'],
  op: ['Manoj Bhat', 'ops@skyline.dev', 'Ops@12345', 'operations_manager'],
  legal: ['Farida Khan', 'legal@skyline.dev', 'Legal@123', 'legal'],
  partner: ['Global Realtors', 'partner@skyline.dev', 'Partner@123', 'channel_partner']
};

const uids = {};
for (const [k, [name, email, pw, role]] of Object.entries(users)) {
  const uid = id();
  run(`INSERT INTO users (id, company_id, name, email, phone, password_hash, role, active, meta, created_at)
       VALUES (?,?,?,?,?,?,?,1,?,?)`, uid, cid, name, email, k === 'partner' ? '+91 90000 11111' : `+91 9${(900000000 + Math.floor(Math.random() * 99999999)).toString().slice(0, 9)}`, hashPw(pw), role, '{}', now());
  uids[k] = uid;
}

// Live locations for field executives (Mumbai/Pune/Indore anchors)
const coords = { sm: [19.0596, 72.8295], se1: [19.076, 72.8777], se2: [19.1136, 72.8697], tc1: [18.5204, 73.8567], tl: [22.7196, 75.8577] };
for (const [k, [la, ln]] of Object.entries(coords)) {
  run('UPDATE users SET lat=?, lng=?, last_seen_at=? WHERE id=?', la, ln, now(), uids[k]);
}

// ---- Configurable pipeline stages (default 11-stage funnel) ----
run('DELETE FROM pipeline_stages');
[
  ['new_lead', 'New Lead', '#94a3b8', 0],
  ['contacted', 'Contacted', '#64748b', 1],
  ['interested', 'Interested', '#3b82f6', 2],
  ['site_visit_scheduled', 'Site Visit Scheduled', '#0ea5e9', 3],
  ['site_visit_completed', 'Site Visit Completed', '#06b6d4', 4],
  ['negotiation', 'Negotiation', '#f59e0b', 5],
  ['booking', 'Booking', '#f97316', 6],
  ['payment', 'Payment', '#10b981', 7],
  ['registered', 'Registered', '#22c55e', 8],
  ['won', 'Won', '#16a34a', 9],
  ['lost', 'Lost', '#ef4444', 10]
].forEach(([key, label, color, sort], i) => {
  run(`INSERT INTO pipeline_stages (id, company_id, key, label, sort, color, is_win, is_lost, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    id(), cid, key, label, sort, color, key === 'won' ? 1 : 0, key === 'lost' ? 1 : 0, now());
});

// ---- Projects ----
const projects = [
  { name: 'Skyline Residency', type: 'Residential', subtype: '2/3 BHK Apartments', status: 'Under Construction', city: 'Mumbai', location: 'Andheri East', area: 'Powai Corridor', price_range: '₹1.2 Cr – ₹2.8 Cr', amenities: ['Swimming Pool', 'Gym', 'Club House', 'Kids Play Area', 'Landscaped Garden'], nearby: { schools: '2 km', metro: '500 m', hospital: '1.5 km' } },
  { name: 'Business Bay Towers', type: 'Commercial', subtype: 'Office Space', status: 'Ready Possession', city: 'Mumbai', location: 'BKC', area: 'Bandra Kurla Complex', price_range: '₹2.5 Cr – ₹8 Cr', amenities: ['Lift', 'Parking', 'Cafeteria', 'Conference Rooms'], nearby: { airport: '4 km', metro: '300 m' } },
  { name: 'Green Valley Villas', type: 'Villa', subtype: '4 BHK Villas', status: 'Under Construction', city: 'Pune', location: 'Kothrud', area: 'Baner Hills', price_range: '₹3 Cr – ₹5.5 Cr', amenities: ['Private Garden', 'Basement Parking', 'Smart Home'], nearby: { school: '1 km', highway: '2 km' } },
  { name: 'Warehouse Park Indore', type: 'Warehouses', subtype: 'Industrial Warehousing', status: 'Pre-Launch', city: 'Indore', location: 'Pithampur', area: 'NH-52 Corridor', price_range: '₹1.8 Cr – ₹4 Cr', amenities: ['Docking', 'High Ceiling', 'Security'], nearby: { highway: '500 m' } }
];
const pids = {};
for (const p of projects) {
  const pid = id();
  run(`INSERT INTO projects (id, company_id, name, type, subtype, status, city, location, area, price_range, amenities, nearby, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    pid, cid, p.name, p.type, p.subtype, p.status, p.city, p.location, p.area, p.price_range,
    JSON.stringify(p.amenities), JSON.stringify(p.nearby), now());
  pids[p.name] = pid;
}

// ---- Buildings + Units ----
const buildings = ['Tower A', 'Tower B', 'Tower C'];
const unitTypes = ['1 BHK', '2 BHK', '3 BHK', '4 BHK', 'Penthouse'];
let unitCount = 0;
for (const pname of ['Skyline Residency', 'Business Bay Towers']) {
  const pid = pids[pname];
  buildings.forEach((bname, bi) => {
    const bid = id();
    run(`INSERT INTO buildings (id, company_id, project_id, name, total_floors, created_at) VALUES (?,?,?,?,?,?)`,
      bid, cid, pid, bname, 12, now());
    for (let floor = 1; floor <= 12; floor++) {
      for (let n = 1; n <= 4; n++) {
        const type = unitTypes[(floor + n) % unitTypes.length];
        const price = (18000000 + unitCount * 350000) * (pname.includes('Commercial') ? 2.5 : 1);
        const uid = id();
        run(`INSERT INTO units (id, company_id, project_id, building_id, floor, number, unit_type, carpet_area, builtup_area, price, availability, booking_status, amenities, qr_code, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          uid, cid, pid, bid, floor, `${bname.slice(-1)}-${floor}${n}`, type, 850 + (unitCount % 5) * 120,
          1100 + (unitCount % 5) * 160, Math.round(price), 'Available', 'Unsold',
          JSON.stringify(['Balcony', 'Lift Access', 'Reserved Parking']),
          Buffer.from(uid).toString('base64url'), now());
        unitCount++;
      }
    }
  });
}

// ---- Leads ----
const sources = ['99acres', 'MagicBricks', 'Facebook', 'Google Ads', 'WhatsApp', 'Website', 'Justdial', 'Channel Partner', 'Referral', 'Call Tracking', 'IndiaMART'];
const names = [
  ['Arjun Mehta', 'Hot'], ['Sneha Kulkarni', 'Warm'], ['Imran Qureshi', 'Cold'], ['Divya Reddy', 'Hot'],
  ['Karthik Subramanian', 'Warm'], ['Pooja Agarwal', 'Warm'], ['Sanjay Malhotra', 'Hot'], ['Meera Nair', 'Cold'],
  ['Rahul Deshmukh', 'Warm'], ['Anjali Singh', 'Hot'], ['Vivek Saxena', 'Warm'], ['Farah Khan', 'Cold']
];
const statuses = ['new_lead', 'new_lead', 'contacted', 'contacted', 'interested', 'interested', 'site_visit_scheduled', 'site_visit_scheduled', 'negotiation', 'negotiation', 'payment', 'booking', 'booking', 'registered', 'lost', 'lost'];
const leadIds = {};
const owners = [uids.se1, uids.se2, uids.tc1, uids.tl];
let li = 0;
for (let i = 0; i < 60; i++) {
  const [name, priority] = names[i % names.length];
  const lid = id();
  const days = Math.floor(Math.random() * 60);
  const source = sources[i % sources.length];
  const status = statuses[i % statuses.length];
  const owner = owners[i % owners.length];
  const budget = 15000000 + Math.floor(Math.random() * 40000000);
  const phone = `+91 98${String(100000000 + Math.floor(Math.random() * 899999999)).slice(0, 8)}`;
  run(`INSERT INTO leads (id, company_id, name, phone, email, source, medium, project_id, city, area, budget, requirement, priority, status, owner_id, tags, campaign_id, utm_source, utm_medium, utm_campaign, utm_term, utm_content, landing_page, response_time_mins, last_activity_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    lid, cid, name, phone, name.toLowerCase().replace(' ', '.') + i + '@mail.com', source,
    ['organic', 'paid', 'social', 'referral'][i % 4],
    pids[['Skyline Residency', 'Business Bay Towers', 'Green Valley Villas', 'Warehouse Park Indore'][i % 4]],
    ['Mumbai', 'Pune', 'Indore', 'Mumbai'][i % 4], ['Andheri', 'BKC', 'Baner', 'Pithampur'][i % 4],
    budget, `${['2 BHK apartment with sea view', 'Office floor for company HQ', 'Villa with garden', 'Warehouse near highway'][i % 4]}`,
    priority, status, owner, JSON.stringify(['demo', source.toLowerCase()]),
    null, ['facebook', 'google', 'instagram', '99acres', 'website'][i % 5], 'cpc',
    'Festive Mega Offer ' + (i % 3), null, null, 'https://skylinedev.example.com/?ref=' + (i % 3),
    (i % 5) * 37 + 8, daysAgo(Math.max(0, days - 1)), daysAgo(days), daysAgo(Math.max(0, days - 3)));
  leadIds[lid] = name;
  li++;
  if (li < 10) {
    run(`INSERT INTO activities (id, company_id, lead_id, user_id, type, subject, note, outcome, done_at, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      id(), cid, lid, owner, ['call', 'whatsapp', 'email'][i % 3], 'Intro call', 'Discussed project details and budget', 'Interested', daysAgo(days - 1), daysAgo(days - 1));
    run(`INSERT INTO activities (id, company_id, lead_id, user_id, type, subject, scheduled_at, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      id(), cid, lid, owner, 'call', 'Follow-up', new Date(Date.now() + (i % 5) * 86400000).toISOString(), now());
  }
  if (i % 12 === 0) {
    run(`INSERT INTO messages (id, company_id, lead_id, user_id, channel, direction, body, status, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      id(), cid, lid, owner, 'whatsapp', 'inbound', 'Hi, I saw the listing online and would like to know more.', 'read', daysAgo(days - 1));
  }
}

// ---- Customers + bookings + payments ----
const customerNames = ['Arjun Mehta', 'Divya Reddy', 'Pooja Agarwal', 'Sanjay Malhotra', 'Anjali Singh'];
const custIds = {};
customerNames.forEach((n, i) => {
  const cusid = id();
  run(`INSERT INTO customers (id, company_id, lead_id, name, phone, email, address, pan, aadhaar, kyc_status, loyalty_points, qr_code, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    cusid, cid, null, n, `+91 98${String(500000000 + i * 9876543).slice(0, 8)}`, n.toLowerCase().replace(' ', '.') + '@mail.com',
    'Mumbai', 'ABCPT1234' + i, '12345678' + i, 'verified', 100 + i * 50, Buffer.from(cusid).toString('base64url'), daysAgo(80 - i * 10));
  custIds[n] = cusid;
  run(`INSERT INTO documents (id, company_id, entity_type, entity_id, name, url, kind, verified, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`, id(), cid, 'customer', cusid, 'PAN Card', `/docs/pan_${i}.pdf`, 'kyc', 1, daysAgo(70));
});

// book some units
const someUnits = all('SELECT * FROM units WHERE company_id=? LIMIT 6', cid);
someUnits.forEach((u, i) => {
  const cname = customerNames[i % customerNames.length];
  const custId = custIds[cname];
  const bid = id();
  const total = u.price;
  const token = Math.min(500000, total * 0.05);
  run(`INSERT INTO bookings (id, company_id, customer_id, unit_id, token_amount, total_value, status, rera_ref, payment_plan, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    bid, cid, custId, u.id, Math.round(token), total, ['token_received', 'booking', 'agreement'][i % 3],
    'RERA-P' + (5210000 + i), JSON.stringify([{ stage: 'On Booking', pct: 10, amount: Math.round(total * 0.1) }, { stage: 'On Agreement', pct: 20, amount: Math.round(total * 0.2) }, { stage: 'On Possession', pct: 70, amount: Math.round(total * 0.7) }]), daysAgo(50 - i * 5));
  run(`UPDATE units SET availability='Booked', booking_status='Booked', customer_id=? WHERE id=?`, custId, u.id);
  run(`INSERT INTO payments (id, company_id, customer_id, booking_id, amount, type, mode, status, receipt_no, date, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id(), cid, custId, bid, Math.round(token), 'booking', ['cheque', 'neft', 'upi', 'cash'][i % 4], 'received', `RC-1000${i}`, daysAgo(45 - i * 5), daysAgo(45 - i * 5));
  run(`INSERT INTO invoices (id, company_id, customer_id, booking_id, number, amount, gst, status, date, due_date, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id(), cid, custId, bid, `INV-2026-${1000 + i}`, Math.round(total * 0.1), 0, i % 2 ? 'sent' : 'paid', daysAgo(45 - i * 5), new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), daysAgo(45 - i * 5));
});

// ---- Employees ----
const empData = [
  ['Priya Sharma', 'sales_manager', 'Sales', 'Sales Manager', 85000], ['Amit Patel', 'team_leader', 'Sales', 'Team Leader', 65000],
  ['Rohan Verma', 'sales_executive', 'Sales', 'Senior Sales Executive', 40000], ['Neha Gupta', 'sales_executive', 'Sales', 'Sales Executive', 35000],
  ['Vikram Singh', 'telecaller', 'Sales', 'Telecaller', 22000], ['Kavita Rao', 'marketing_manager', 'Marketing', 'Marketing Manager', 70000],
  ['Anil Kumar', 'finance_manager', 'Finance', 'Finance Manager', 90000], ['Sunita Joshi', 'hr_manager', 'HR', 'HR Manager', 75000],
  ['Deepak Nair', 'accounts_executive', 'Finance', 'Accounts Executive', 38000], ['Manoj Bhat', 'operations_manager', 'Operations', 'Operations Manager', 80000]
];
for (const [name, role, dept, desig, salary] of empData) {
  run(`INSERT INTO employees (id, company_id, name, email, phone, department, designation, doj, salary, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id(), cid, name, name.toLowerCase().replace(' ', '.') + '@skyline.dev', '+91 9' + String(7000000000 + Math.floor(Math.random() * 999999999)).slice(0, 9),
    dept, desig, daysAgo(400), salary, 'active', daysAgo(400));
}
const empIds = all('SELECT id, name FROM employees WHERE company_id=?', cid);

// ---- Campaigns ----
for (const [name, channel, budget, spent] of [
  ['Festive Mega Offer', 'Facebook', 150000, 120000], ['Google Search Ads', 'Google Ads', 200000, 175000],
  ['WhatsApp Broadcast', 'WhatsApp', 50000, 45000], ['99acres Featured', '99acres', 100000, 80000],
  ['Instagram Reels Push', 'Instagram', 80000, 60000]
]) {
  run(`INSERT INTO campaigns (id, company_id, name, channel, budget, spent, leads_count, bookings_count, start_date, end_date, created_at)
       VALUES (?,?,?,?,?,?,0,0,?,?,?)`, id(), cid, name, channel, budget, spent, daysAgo(30), new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), daysAgo(30));
}

// Attach leads to campaigns + channel partners to demo data
const campMap = {};
for (const camp of all('SELECT * FROM campaigns WHERE company_id=?', cid)) campMap[camp.channel] = camp;
const byChannel = { Facebook: 'Facebook', 'Google Ads': 'Google Ads', WhatsApp: 'WhatsApp', '99acres': '99acres', Instagram: 'Instagram' };
for (const [ch, campName] of Object.entries(byChannel)) {
  const camp = campMap[campName];
  if (camp) {
    run('UPDATE leads SET campaign_id=? WHERE company_id=? AND source=?', camp.id, cid, ch);
    const cnt = get('SELECT COUNT(*) n FROM leads WHERE company_id=? AND campaign_id=?', cid, camp.id).n;
    run('UPDATE campaigns SET leads_count=? WHERE id=?', cnt, camp.id);
  }
}

// ---- Partner + commission ----
const partnerId = id();
run(`INSERT INTO partners (id, company_id, user_id, name, phone, email, company, commission_pct, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`, partnerId, cid, uids.partner, 'Global Realtors', '+91 90000 11111', 'partner@skyline.dev', 'Global Realtors Pvt Ltd', 1.5, 'active', daysAgo(90));
const bk = get('SELECT * FROM bookings WHERE company_id=? LIMIT 1', cid);
if (bk) {
  run(`INSERT INTO commissions (id, company_id, partner_id, booking_id, amount, pct, status, created_at)
       VALUES (?,?,?,?,?,?,?,?)`, id(), cid, partnerId, bk.id, Math.round(bk.total_value * 0.015), 1.5, 'pending', daysAgo(40));
}

// ---- Notifications for demo users ----
notify(cid, uids.se1, '3 leads awaiting follow-up', 'You have overdue follow-ups scheduled today. Check the pipeline.', 'alert');
notify(cid, uids.se1, 'Site visit reminder', 'Rahul Deshmukh has a site visit tomorrow at 11:00 AM.', 'reminder');
notify(cid, uids.sm, 'Weekly report ready', 'Your weekly lead report is available in Reports.', 'report');
notify(cid, uids.fm, 'Outstanding invoice due', 'Invoice INV-2026-1002 is due in 5 days.', 'finance');
notify(cid, uids.admin, 'Welcome to Propease', 'Your company workspace is ready. Configure branding in Settings.', 'info');
notify(cid, uids.admin, '2 pending approvals', 'Two expense claims await your approval in Finance.', 'alert');

// ---- Site visits (geo/photo verified) ----
const visitLeads = all('SELECT id FROM leads WHERE company_id=? LIMIT 4', cid);
visitLeads.forEach((l, i) => {
  const vid = id();
  const planned = new Date(Date.now() - (i - 1) * 86400000);
  run(`INSERT INTO site_visits (id, company_id, lead_id, project_id, user_id, scheduled_at, status, checkin_at, latitude, longitude, photo_url, plan_date, distance_km, duration_mins, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    vid, cid, l.id, pids[['Skyline Residency', 'Business Bay Towers', 'Green Valley Villas', 'Warehouse Park Indore'][i % 4]],
    [uids.se1, uids.se2, uids.tc1, uids.tl][i % 4],
    planned.toISOString(), i === 0 ? 'scheduled' : 'done',
    i === 0 ? null : daysAgo(2), i === 0 ? null : 19.076, i === 0 ? null : 72.8777,
    i === 0 ? null : '/visits/geo_photo_' + i + '.jpg', planned.toISOString().slice(0, 10),
    i === 0 ? null : 3.4 + i, i === 0 ? null : 25 + i * 10, daysAgo(3));
});

// ---- Attendance ----
empIds.slice(0, 8).forEach((e, i) => {
  for (let d = 5; d >= 0; d--) {
    run(`INSERT INTO attendance (id, company_id, employee_id, date, checkin, checkout, status, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      id(), cid, e.id, new Date(Date.now() - d * 86400000).toISOString().slice(0, 10),
      '09:0' + (i % 9) + ' AM', '06:30 PM', 'present', daysAgo(d));
  }
});

// ---- Leaves ----
run(`INSERT INTO leaves (id, company_id, employee_id, from_date, to_date, type, reason, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`, id(), cid, empIds[0].id, new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10), new Date(Date.now() + 11 * 86400000).toISOString().slice(0, 10), 'casual', 'Family function', 'approved', daysAgo(4));
run(`INSERT INTO leaves (id, company_id, employee_id, from_date, to_date, type, reason, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`, id(), cid, empIds[1].id, new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10), new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10), 'sick', 'Medical appointment', 'pending', daysAgo(2));

// ---- Expenses ----
for (const [emp, cat, amt, st] of [[empIds[5].id, 'Marketing', 25000, 'approved'], [empIds[7].id, 'Travel', 18000, 'pending'], [empIds[0].id, 'Client Meeting', 12000, 'pending']]) {
  run(`INSERT INTO expenses (id, company_id, employee_id, category, amount, date, status, notes, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`, id(), cid, emp, cat, amt, new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10), st, cat + ' expense for demo month', daysAgo(3));
}

// ---- Support tickets ----
run(`INSERT INTO tickets (id, company_id, user_id, subject, body, priority, type, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`, id(), cid, uids.admin, 'WhatsApp template not approved', 'The WhatsApp broadcast template is pending Meta approval.', 'medium', 'bug', 'open', daysAgo(2), daysAgo(2));
run(`INSERT INTO tickets (id, company_id, user_id, subject, body, priority, type, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`, id(), cid, uids.sm, 'Need bulk SMS credits', 'Please top up SMS credits for the festive campaign.', 'low', 'feature', 'closed', daysAgo(6), daysAgo(5));

// ---- Feature flags ----
for (const k of ['ai', 'voice', 'multilang', 'offline', 'qrcode', 'portal', 'callrecord', 'digital_sign', 'kyc', 'biometric']) {
  run(`INSERT OR IGNORE INTO feature_flags (company_id, key, enabled) VALUES (?,?,1)`, cid, k);
}

// ---- Scheduled report ----
run(`INSERT INTO scheduled_reports (id, company_id, name, frequency, email, created_at) VALUES (?,?,?,?,?,?)`,
  id(), cid, 'Weekly Sales Summary', 'weekly', 'gm@skyline.dev', now());

// ---- V2 Org hierarchy: departments -> teams -> members ----
const depts = {};
const deptDefs = [
  ['Sales', uids.sm],
  ['Finance', uids.fm],
  ['HR', uids.hr],
  ['Marketing', uids.mm],
  ['Operations', uids.op]
];
for (const [name, hod] of deptDefs) {
  const did = id();
  run(`INSERT INTO departments (id, company_id, name, hod_id, created_at) VALUES (?,?,?,?,?)`, did, cid, name, hod, now());
  depts[name] = did;
  run('UPDATE users SET department_id=? WHERE id=?', did, hod);
  run('UPDATE users SET department_id=? WHERE id=?', did, uids.admin);
}
// hierarchy roles: HODs get hod role, executives/sr executives, ceo
run('UPDATE users SET role=? WHERE id=?', 'ceo', uids.director);
run('UPDATE users SET role=? WHERE id=?', 'hod', uids.sm);
run('UPDATE users SET role=? WHERE id=?', 'hod', uids.fm);
run('UPDATE users SET role=? WHERE id=?', 'hod', uids.hr);
run('UPDATE users SET role=? WHERE id=?', 'hod', uids.mm);
run('UPDATE users SET role=? WHERE id=?', 'hod', uids.op);
run('UPDATE users SET role=? WHERE id=?', 'sr_manager', uids.gm);
run('UPDATE users SET role=? WHERE id=?', 'team_lead', uids.tl);
run('UPDATE users SET role=? WHERE id=?', 'executive', uids.se1);
run('UPDATE users SET role=? WHERE id=?', 'sr_executive', uids.se2);
run('UPDATE users SET role=? WHERE id=?', 'assistant_manager', uids.tc1);

// Sales teams under Sales dept
const teams = {};
const teamDefs = [
  ['Skyline Sales - West', depts.Sales, uids.tl, [uids.se1, uids.se2]],
  ['Skyline Sales - Central', depts.Sales, uids.tc1, [uids.se2]]
];
for (const [name, dept, leader, members] of teamDefs) {
  const tid = id();
  run(`INSERT INTO teams (id, company_id, department_id, name, leader_id, created_at) VALUES (?,?,?,?,?,?)`, tid, cid, dept, name, leader, now());
  teams[name] = tid;
  run('INSERT OR REPLACE INTO team_members (team_id, user_id, role_in_team, joined_at) VALUES (?,?,?,?)', tid, leader, 'team_lead', now());
  run('UPDATE users SET team_id=?, department_id=?, manager_id=? WHERE id=?', tid, dept, uids.sm, leader);
  for (const m of members) {
    run('INSERT OR REPLACE INTO team_members (team_id, user_id, role_in_team, joined_at) VALUES (?,?,?,?)', tid, m, 'executive', now());
    run('UPDATE users SET team_id=?, department_id=? WHERE id=?', tid, dept, m);
  }
}

// ---- V2 Tasks for the Sales team ----
const taskRows = [
  ['Follow up on Skyline Residency leads', daysAgo(1).slice(0, 10), 'high', 'Follow up on all site-visit-scheduled leads for the residency.', uids.se1],
  ['Collect KYC documents', new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10), 'medium', 'Collect KYC docs from lead #booking1 for loan processing.', uids.se2],
  ['Finalize pricing sheet', new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10), 'medium', 'Update the price list in project catalogue.', uids.tl],
  ['Call channel partners', new Date(Date.now() + 1 * 86400000).toISOString().slice(0, 10), 'low', 'Reach out to Global Realtors for Q3 referrals.', uids.tc1]
];
for (const [title, due, pri, desc, assignee] of taskRows) {
  run(`INSERT INTO tasks (id, company_id, title, description, status, priority, due_date, assignee_id, assigner_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id(), cid, title, desc, 'pending', pri, due, assignee, uids.sm, now(), now());
}

// ---- V2 demo listings (via importer already covered; add a couple direct) ----
run(`INSERT INTO listings (id, company_id, source, unique_key, category, subtype, transaction_type, title, description, price, size, location, city, area, owner_type, status, verified, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  id(), cid, '99acres', '99acres:919876543210:2-bhk-premium-apartment', 'Residential', 'Apartment', 'Sale', '2 BHK Premium Apartment',
  'Prime location, gated society, sea-facing balcony, metro at 400m.', 8500000, 1100, 'Andheri East, Mumbai', 'Mumbai', 'Andheri East', 'builder', 'active', 1, daysAgo(1), daysAgo(1));

// ---- V2 demo loan ----
run(`INSERT INTO loans (id, company_id, lead_id, customer_id, customer_name, customer_phone, property_desc, bank, dsa_agent, loan_amount, interest_rate, status, commission_amount, commission_status, reminder_schedule, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  id(), cid, null, null, 'Rahul Deshmukh', '+91 98220 11223', '2 BHK at Skyline Residency, Andheri East', 'HDFC', 'Global Realtors', 6000000, 8.5, 'processing', 45000, 'pending',
  JSON.stringify([{ daysBefore: 5, channels: ['whatsapp', 'email'] }]), daysAgo(2), daysAgo(2));

// ---- Audit entries ----
audit({ company_id: cid, user_id: uids.admin, user_name: 'Company Admin', action: 'system.seed', entity: 'company', entity_id: cid, detail: { note: 'Demo data seeded' } });

console.log('Seeded demo data:');
console.log('  Super Admin   : super@propease.dev / Admin@123');
console.log('  Company Admin : admin@skyline.dev / Admin@123');
console.log('  Sales Manager : manager@skyline.dev / Manager@123');
console.log('  Executive     : rohan@skyline.dev / Exec@12345');
console.log(`  Company slug  : skyline  (login page theming)`);
