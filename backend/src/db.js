import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { emitUser } from './realtime.js';

export const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'propease.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// ---- row helpers -----------------------------------------------------------
export const all = (sql, ...params) => db.prepare(sql).all(...params);
export const get = (sql, ...params) => db.prepare(sql).get(...params);
export const run = (sql, ...params) => {
  const r = db.prepare(sql).run(...params);
  return { lastInsertRowid: Number(r.lastInsertRowid), changes: Number(r.changes) };
};

export const ts = () => new Date().toISOString();

export function now(days = 0) {
  return new Date(Date.now() + days * 86400000).toISOString();
}

export const id = () => crypto.randomUUID();

export function ensureColumn(table, column, ddl) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  } catch (e) { /* table may not exist yet */ }
}

export function initSchema() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE,
    license_key TEXT,
    plan TEXT DEFAULT 'standard',
    status TEXT DEFAULT 'active',
    billing_email TEXT,
    settings TEXT DEFAULT '{}',
    created_at TEXT NOT NULL,
    expires_at TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    company_id TEXT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    password_hash TEXT,
    role TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    mfa_enabled INTEGER DEFAULT 0,
    device_id TEXT,
    last_login TEXT,
    commission_rate REAL DEFAULT 0,
    meta TEXT DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS role_perms (
    company_id TEXT NOT NULL,
    role TEXT NOT NULL,
    perms TEXT NOT NULL,
    PRIMARY KEY (company_id, role)
  );

  CREATE TABLE IF NOT EXISTS custom_roles (
    company_id TEXT NOT NULL,
    role TEXT NOT NULL,
    label TEXT NOT NULL,
    perms TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (company_id, role)
  );

  CREATE TABLE IF NOT EXISTS otp_codes (
    id TEXT PRIMARY KEY,
    company_id TEXT,
    user_id TEXT,
    code TEXT NOT NULL,
    purpose TEXT DEFAULT 'login',
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT,
    key_hash TEXT NOT NULL,
    scopes TEXT DEFAULT 'lead.import',
    last_used TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    company_id TEXT,
    user_id TEXT,
    user_name TEXT,
    action TEXT,
    entity TEXT,
    entity_id TEXT,
    detail TEXT DEFAULT '{}',
    ip TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'Residential',
    subtype TEXT,
    status TEXT DEFAULT 'Under Construction',
    city TEXT,
    location TEXT,
    area TEXT,
    price_range TEXT,
    brochure_url TEXT,
    photos TEXT DEFAULT '[]',
    video_url TEXT,
    virtual_tour_url TEXT,
    google_map TEXT,
    amenities TEXT DEFAULT '[]',
    nearby TEXT DEFAULT '{}',
    description TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS buildings (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    name TEXT,
    total_floors INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS units (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    building_id TEXT,
    floor INTEGER,
    number TEXT,
    unit_type TEXT,
    carpet_area REAL,
    builtup_area REAL,
    price REAL,
    availability TEXT DEFAULT 'Available',
    booking_status TEXT DEFAULT 'Unsold',
    customer_id TEXT,
    amenities TEXT DEFAULT '[]',
    floor_plan_url TEXT,
    photos TEXT DEFAULT '[]',
    qr_code TEXT,
    reserved_until TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    source TEXT,
    medium TEXT,
    project_id TEXT,
    city TEXT,
    area TEXT,
    budget REAL,
    requirement TEXT,
    priority TEXT DEFAULT 'Warm',
    status TEXT DEFAULT 'new_lead',
    owner_id TEXT,
    score INTEGER DEFAULT 0,
    score_reason TEXT DEFAULT '{}',
    duplicate_of TEXT,
    tags TEXT DEFAULT '[]',
    address TEXT,
    notes TEXT,
    latitude REAL,
    longitude REAL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lead_merges (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    primary_lead_id TEXT,
    merged_lead_id TEXT,
    by_user TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    lead_id TEXT,
    user_id TEXT,
    type TEXT,
    direction TEXT DEFAULT 'outbound',
    subject TEXT,
    note TEXT,
    voice_url TEXT,
    location TEXT,
    outcome TEXT,
    scheduled_at TEXT,
    done_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS site_visits (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    lead_id TEXT,
    project_id TEXT,
    user_id TEXT,
    scheduled_at TEXT,
    status TEXT DEFAULT 'scheduled',
    feedback TEXT,
    checkin_at TEXT,
    checkout_at TEXT,
    latitude REAL,
    longitude REAL,
    photo_url TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    lead_id TEXT,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    pan TEXT,
    aadhaar TEXT,
    kyc_status TEXT DEFAULT 'pending',
    kyc_docs TEXT DEFAULT '[]',
    loyalty_points INTEGER DEFAULT 0,
    referred_by TEXT,
    qr_code TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    customer_id TEXT,
    unit_id TEXT,
    lead_id TEXT,
    token_amount REAL,
    total_value REAL,
    agreement_date TEXT,
    possession_date TEXT,
    status TEXT DEFAULT 'token_received',
    rera_ref TEXT,
    payment_plan TEXT DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    customer_id TEXT,
    booking_id TEXT,
    invoice_id TEXT,
    amount REAL,
    type TEXT DEFAULT 'booking',
    mode TEXT,
    status TEXT DEFAULT 'received',
    reference TEXT,
    receipt_no TEXT,
    date TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    customer_id TEXT,
    booking_id TEXT,
    number TEXT,
    amount REAL,
    gst REAL DEFAULT 0,
    status TEXT DEFAULT 'draft',
    date TEXT NOT NULL,
    due_date TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invoice_items (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    invoice_id TEXT,
    description TEXT,
    hsn TEXT,
    unit TEXT,
    qty REAL DEFAULT 1,
    rate REAL DEFAULT 0,
    amount REAL DEFAULT 0,
    gst_rate REAL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS particulars (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    hsn TEXT,
    unit TEXT,
    rate REAL DEFAULT 0,
    gst_rate REAL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS vendors (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    company_name TEXT NOT NULL,
    gstin TEXT,
    gst_state_code TEXT,
    gst_state TEXT,
    contact_person TEXT,
    email TEXT,
    phone TEXT,
    alternate_phone TEXT,
    alternate_email TEXT,
    address TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS backups (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    kind TEXT DEFAULT 'manual',
    format TEXT DEFAULT 'db',
    filename TEXT NOT NULL,
    size REAL DEFAULT 0,
    status TEXT DEFAULT 'completed',
    local_path TEXT,
    cloud_status TEXT,
    cloud_error TEXT,
    schedule_time TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS backup_config (
    company_id TEXT PRIMARY KEY,
    config TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS referral_config (
    company_id TEXT PRIMARY KEY,
    config TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS subbrokers (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    company TEXT,
    commission_pct REAL DEFAULT 1,
    verticals TEXT DEFAULT '["leads","properties"]',
    status TEXT DEFAULT 'active',
    notes TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS referrals (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    ref_code TEXT NOT NULL UNIQUE,
    referrer_type TEXT NOT NULL,
    referrer_id TEXT,
    referrer_name TEXT NOT NULL,
    referrer_phone TEXT,
    referrer_email TEXT,
    amount REAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    clicks INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS referral_rewards (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    referral_id TEXT,
    lead_id TEXT,
    referrer_type TEXT,
    referrer_id TEXT,
    referrer_name TEXT,
    amount REAL DEFAULT 0,
    status TEXT DEFAULT 'pending',
    paid_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    user_id TEXT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    department TEXT,
    designation TEXT,
    doj TEXT,
    salary REAL,
    pan TEXT,
    bank TEXT DEFAULT '{}',
    status TEXT DEFAULT 'active',
    documents TEXT DEFAULT '[]',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT,
    date TEXT,
    status TEXT DEFAULT 'present',
    checkin TEXT,
    checkout TEXT,
    latitude REAL,
    longitude REAL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS leaves (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT,
    from_date TEXT,
    to_date TEXT,
    type TEXT DEFAULT 'casual',
    status TEXT DEFAULT 'pending',
    reason TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT,
    amount REAL,
    category TEXT,
    date TEXT,
    status TEXT DEFAULT 'pending',
    notes TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS partners (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    user_id TEXT,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    company TEXT,
    commission_pct REAL DEFAULT 1,
    status TEXT DEFAULT 'active',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS commissions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    partner_id TEXT,
    booking_id TEXT,
    amount REAL,
    pct REAL,
    status TEXT DEFAULT 'pending',
    paid_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    channel TEXT,
    budget REAL,
    spent REAL DEFAULT 0,
    leads_count INTEGER DEFAULT 0,
    bookings_count INTEGER DEFAULT 0,
    start_date TEXT,
    end_date TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    user_id TEXT,
    title TEXT,
    body TEXT,
    type TEXT DEFAULT 'info',
    read INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    name TEXT,
    url TEXT,
    kind TEXT DEFAULT 'document',
    verified INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    user_id TEXT,
    subject TEXT,
    body TEXT,
    priority TEXT DEFAULT 'normal',
    type TEXT DEFAULT 'bug',
    status TEXT DEFAULT 'open',
    attachments TEXT DEFAULT '[]',
    developer_notes TEXT,
    resolution TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS feature_flags (
    company_id TEXT NOT NULL,
    key TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    PRIMARY KEY (company_id, key)
  );

  CREATE TABLE IF NOT EXISTS scheduled_reports (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT,
    frequency TEXT DEFAULT 'weekly',
    email TEXT,
    last_sent TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    url TEXT,
    events TEXT DEFAULT '[]',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_leads_company ON leads(company_id);
  CREATE INDEX IF NOT EXISTS idx_leads_owner ON leads(owner_id);
  CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
  CREATE INDEX IF NOT EXISTS idx_units_company ON units(company_id);
  CREATE INDEX IF NOT EXISTS idx_act_lead ON activities(lead_id);
  CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_company ON audit_log(company_id);

  CREATE TABLE IF NOT EXISTS pipeline_stages (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    key TEXT NOT NULL,
    label TEXT NOT NULL,
    sort INTEGER DEFAULT 0,
    color TEXT DEFAULT '#94a3b8',
    requires_approval INTEGER DEFAULT 0,
    is_win INTEGER DEFAULT 0,
    is_lost INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE (company_id, key)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    lead_id TEXT,
    user_id TEXT,
    channel TEXT DEFAULT 'whatsapp',
    direction TEXT DEFAULT 'outbound',
    body TEXT,
    status TEXT DEFAULT 'sent',
    meta TEXT DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_msg_lead ON messages(lead_id);

  -- ---- V2: Live customer support chat ----
  CREATE TABLE IF NOT EXISTS support_chats (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    customer_name TEXT,
    customer_phone TEXT,
    customer_email TEXT,
    subject TEXT,
    status TEXT DEFAULT 'open',
    assigned_to TEXT,
    channel TEXT DEFAULT 'chat',
    source TEXT DEFAULT 'web',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_support_company ON support_chats(company_id);

  CREATE TABLE IF NOT EXISTS support_messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    sender_type TEXT DEFAULT 'customer',
    sender_id TEXT,
    sender_name TEXT,
    body TEXT,
    media_url TEXT,
    media_type TEXT,
    read_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_support_msg_chat ON support_messages(chat_id);

  -- ---- V2: Internal employee messaging (groups + direct) ----
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    kind TEXT DEFAULT 'direct',
    title TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    last_read_at TEXT,
    PRIMARY KEY (conversation_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS conversation_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    sender_id TEXT,
    sender_name TEXT,
    body TEXT,
    media_url TEXT,
    media_type TEXT,
    reply_to TEXT,
    reactions TEXT DEFAULT '{}',
    deleted INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_conv_msg ON conversation_messages(conversation_id);

  -- ---- V2: Project catalogue media / price lists / construction updates ----
  CREATE TABLE IF NOT EXISTS project_media (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    kind TEXT DEFAULT 'image',
    url TEXT,
    title TEXT,
    sort INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_pm_project ON project_media(project_id);

  CREATE TABLE IF NOT EXISTS project_price_lists (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    unit_type TEXT,
    size TEXT,
    price REAL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS construction_updates (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    title TEXT,
    body TEXT,
    date TEXT,
    created_at TEXT NOT NULL
  );

  -- ---- V2: Property listings (builders + brokers, import targets) ----
  CREATE TABLE IF NOT EXISTS listings (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    source TEXT DEFAULT 'Manual',
    external_id TEXT,
    unique_key TEXT,
    category TEXT,
    subtype TEXT,
    transaction_type TEXT,
    title TEXT,
    description TEXT,
    price REAL,
    size REAL,
    location TEXT,
    city TEXT,
    area TEXT,
    project_id TEXT,
    owner_type TEXT DEFAULT 'builder',
    broker_id TEXT,
    contact_name TEXT,
    contact_phone TEXT,
    contact_email TEXT,
    images TEXT DEFAULT '[]',
    videos TEXT DEFAULT '[]',
    amenities TEXT DEFAULT '[]',
    floor_plan_url TEXT,
    status TEXT DEFAULT 'active',
    verified INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_listings_company ON listings(company_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_listings_key ON listings(company_id, unique_key);

  -- ---- V2: Home loan management ----
  CREATE TABLE IF NOT EXISTS loans (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    lead_id TEXT,
    customer_id TEXT,
    customer_name TEXT,
    customer_phone TEXT,
    customer_email TEXT,
    property_desc TEXT,
    bank TEXT,
    bank_id TEXT,
    dsa_agent TEXT,
    dsa_id TEXT,
    contact_person TEXT,
    referrer_id TEXT,
    rate_offered REAL,
    payout_timeline TEXT,
    leads_converted INTEGER DEFAULT 0,
    loan_amount REAL,
    interest_rate REAL,
    status TEXT DEFAULT 'application',
    processing_fee REAL,
    disbursement_date TEXT,
    commission_amount REAL,
    commission_status TEXT DEFAULT 'pending',
    payment_due_date TEXT,
    reminder_schedule TEXT DEFAULT '[]',
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_loans_company ON loans(company_id);

  -- ---- Home loan masters: banks, DSAs (multi-bank rates), employee commission ----
  CREATE TABLE IF NOT EXISTS loan_banks (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    rate_offered REAL DEFAULT 0,
    contact_person TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS loan_dsas (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    contact_person TEXT,
    contact_phone TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS loan_dsa_banks (
    company_id TEXT NOT NULL,
    dsa_id TEXT NOT NULL,
    bank_id TEXT NOT NULL,
    rate_offered REAL DEFAULT 0,
    PRIMARY KEY (company_id, dsa_id, bank_id)
  );

  CREATE TABLE IF NOT EXISTS loan_referrals (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    loan_id TEXT,
    commission_rate REAL DEFAULT 0,
    commission_amount REAL DEFAULT 0,
    commission_status TEXT DEFAULT 'pending',
    payout_at TEXT,
    created_at TEXT NOT NULL
  );

  -- ---- V2: Billing / reminder automation logs ----
  CREATE TABLE IF NOT EXISTS reminder_logs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    channel TEXT,
    subject TEXT,
    body TEXT,
    status TEXT DEFAULT 'sent',
    sent_at TEXT NOT NULL
  );

  -- ---- V2: GPS location trace ----
  CREATE TABLE IF NOT EXISTS location_trace (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    user_id TEXT,
    lat REAL,
    lng REAL,
    address TEXT,
    accuracy REAL,
    gps_enabled INTEGER DEFAULT 1,
    battery INTEGER,
    activity TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_loc_user ON location_trace(user_id);

  -- ---- V2: Login sessions / activity audit ----
  CREATE TABLE IF NOT EXISTS login_sessions (
    id TEXT PRIMARY KEY,
    company_id TEXT,
    user_id TEXT,
    ip TEXT,
    device TEXT,
    browser TEXT,
    os TEXT,
    gps TEXT,
    login_at TEXT,
    logout_at TEXT,
    duration_sec INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_sess_user ON login_sessions(user_id);

  -- ---- V2: Org hierarchy (departments / teams / reporting) ----
  CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    hod_id TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    department_id TEXT,
    name TEXT NOT NULL,
    leader_id TEXT,
    location TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS team_members (
    team_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role_in_team TEXT,
    joined_at TEXT,
    PRIMARY KEY (team_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    assignee_id TEXT,
    assigner_id TEXT,
    department_id TEXT,
    team_id TEXT,
    due_date TEXT,
    priority TEXT DEFAULT 'normal',
    status TEXT DEFAULT 'pending',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);

  CREATE TABLE IF NOT EXISTS cross_access (
    user_id TEXT NOT NULL,
    department_id TEXT NOT NULL,
    granted_by TEXT,
    created_at TEXT,
    PRIMARY KEY (user_id, department_id)
  );
  `);

  ensureColumn('users', 'department_id', 'TEXT');
  ensureColumn('users', 'team_id', 'TEXT');
  ensureColumn('users', 'manager_id', 'TEXT');

  // ---- columns added for expanded spec (safe on existing DBs) ----
  ensureColumn('leads', 'campaign_id', 'TEXT');
  ensureColumn('leads', 'utm_source', 'TEXT');
  ensureColumn('leads', 'utm_medium', 'TEXT');
  ensureColumn('leads', 'utm_campaign', 'TEXT');
  ensureColumn('leads', 'utm_term', 'TEXT');
  ensureColumn('leads', 'utm_content', 'TEXT');
  ensureColumn('leads', 'landing_page', 'TEXT');
  ensureColumn('leads', 'response_time_mins', 'INTEGER');
  ensureColumn('leads', 'last_activity_at', 'TEXT');
  ensureColumn('users', 'lat', 'REAL');
  ensureColumn('users', 'lng', 'REAL');
  ensureColumn('users', 'last_seen_at', 'TEXT');
  ensureColumn('site_visits', 'distance_km', 'REAL');
  ensureColumn('site_visits', 'duration_mins', 'INTEGER');
  ensureColumn('site_visits', 'route_points', 'TEXT');
  ensureColumn('site_visits', 'plan_date', 'TEXT');
  ensureColumn('site_visits', 'missed', 'INTEGER DEFAULT 0');
  ensureColumn('attendance', 'geofenced', 'INTEGER DEFAULT 0');
  ensureColumn('attendance', 'verified', 'INTEGER DEFAULT 0');
  ensureColumn('notifications', 'channel', "TEXT DEFAULT 'inapp'");
  ensureColumn('companies', 'custom_domain', 'TEXT');
  ensureColumn('audit_log', 'module', 'TEXT');
  ensureColumn('audit_log', 'activity_type', 'TEXT');
  ensureColumn('audit_log', 'device', 'TEXT');
  ensureColumn('audit_log', 'browser', 'TEXT');
  ensureColumn('audit_log', 'os', 'TEXT');
  ensureColumn('audit_log', 'session_duration', 'INTEGER');
  ensureColumn('activities', 'mode', 'TEXT');
  ensureColumn('activities', 'recording_url', 'TEXT');
  ensureColumn('activities', 'next_followup_at', 'TEXT');
  ensureColumn('activities', 'reminder_enabled', 'INTEGER DEFAULT 0');
  ensureColumn('projects', 'builder_name', 'TEXT');
  ensureColumn('projects', 'builder_logo', 'TEXT');
  ensureColumn('projects', 'rera_number', 'TEXT');
  ensureColumn('projects', 'rera_ref', 'TEXT');
  ensureColumn('projects', 'location_advantages', "TEXT DEFAULT '[]'");
  ensureColumn('projects', 'floor_plans', "TEXT DEFAULT '[]'");
  ensureColumn('projects', 'master_layouts', "TEXT DEFAULT '[]'");
  ensureColumn('projects', 'price_list', "TEXT DEFAULT '[]'");
  ensureColumn('projects', 'brochures', "TEXT DEFAULT '[]'");
  ensureColumn('projects', 'maps_embed', 'TEXT');
  ensureColumn('projects', 'share_slug', 'TEXT');
  ensureColumn('location_trace', 'speed', 'REAL');
  ensureColumn('users', 'commission_rate', 'REAL DEFAULT 0');
  ensureColumn('loans', 'bank_id', 'TEXT');
  ensureColumn('loans', 'dsa_id', 'TEXT');
  ensureColumn('loans', 'contact_person', 'TEXT');
  ensureColumn('loans', 'referrer_id', 'TEXT');
  ensureColumn('loans', 'rate_offered', 'REAL');
  ensureColumn('loans', 'payout_timeline', 'TEXT');
  ensureColumn('loans', 'leads_converted', 'INTEGER DEFAULT 0');
  ensureColumn('customers', 'state', 'TEXT');
  ensureColumn('customers', 'state_code', 'TEXT');
  ensureColumn('customers', 'gstin', 'TEXT');
  ensureColumn('customers', 'pincode', 'TEXT');
  ensureColumn('customers', 'country', "TEXT DEFAULT 'India'");
  ensureColumn('vendors', 'pincode', 'TEXT');
  ensureColumn('vendors', 'country', "TEXT DEFAULT 'India'");
  ensureColumn('invoices', 'taxable_amount', 'REAL');
  ensureColumn('invoice_items', 'cgst', 'REAL DEFAULT 0');
  ensureColumn('invoice_items', 'sgst', 'REAL DEFAULT 0');
  ensureColumn('invoice_items', 'igst', 'REAL DEFAULT 0');
  ensureColumn('invoices', 'gst_rate', 'REAL DEFAULT 0');
  ensureColumn('invoices', 'cgst', 'REAL DEFAULT 0');
  ensureColumn('invoices', 'sgst', 'REAL DEFAULT 0');
  ensureColumn('invoices', 'igst', 'REAL DEFAULT 0');
  ensureColumn('invoices', 'gst_type', "TEXT DEFAULT 'intra'");
  ensureColumn('vendors', 'gst_state_code', 'TEXT');
  ensureColumn('vendors', 'gst_state', 'TEXT');
  ensureColumn('leads', 'subbroker_id', 'TEXT');
  ensureColumn('listings', 'subbroker_id', 'TEXT');
  ensureColumn('leads', 'referral_code', 'TEXT');
  ensureColumn('leads', 'referrer_type', 'TEXT');
  ensureColumn('leads', 'referrer_id', 'TEXT');
  ensureColumn('referral_rewards', 'lead_name', 'TEXT');
  ensureColumn('referral_rewards', 'lead_phone', 'TEXT');
}

// ---- audit helper ----------------------------------------------------------
export function audit({ company_id, user_id, user_name, action, entity, entity_id, detail = {}, ip, module, device, browser, os, session_duration }) {
  try {
    run(
      `INSERT INTO audit_log (id, company_id, user_id, user_name, action, entity, entity_id, detail, ip, module, device, browser, os, session_duration, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id(), company_id, user_id, user_name, action, entity, entity_id || '', JSON.stringify(detail || {}), ip || '',
      module || null, device || null, browser || null, os || null, session_duration || null, ts()
    );
  } catch (e) { /* never fail request because of audit */ }
}

// ---- notifications ---------------------------------------------------------
export function notify(company_id, user_id, title, body, type = 'info', channel = 'inapp') {
  try {
    const nid = id();
    run(`INSERT INTO notifications (id, company_id, user_id, title, body, type, channel, created_at)
         VALUES (?,?,?,?,?,?,?,?)`, nid, company_id, user_id, title, body, type, channel, ts());
    if (channel === 'inapp') {
      emitUser(user_id, 'notification', { id: nid, title, body, type, channel, created_at: ts() });
    }
  } catch (e) { /* noop */ }
}

// ---- feature flags ---------------------------------------------------------
export function flagEnabled(company_id, key) {
  const r = get('SELECT enabled FROM feature_flags WHERE company_id=? AND key=?', company_id, key);
  return r ? !!r.enabled : true;
}
