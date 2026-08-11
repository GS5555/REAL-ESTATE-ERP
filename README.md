# Propease — White-Label Multi-Tenant Real Estate ERP & CRM

An enterprise-grade, white-label **Real Estate ERP + CRM** platform delivered as a PWA (works on web, Android and iOS). Built as a dependency-light Node 22 monorepo — no native build steps.

## Live Preview

- App + API (combined single port): `https://3001-c35a811a77633745.monkeycode-ai.live`
- The backend serves the built frontend and the API on the **same origin/port** — one project, one port, one process.

## Features

**Core CRM**
- Lead aggregation from 99acres, MagicBricks, Facebook, WhatsApp, website forms, CSV import and a public intake API (API-key protected).
- Auto-assignment (round robin / area / project / source / manager), duplicate detection & merge, lead scoring, pipeline kanban, follow-ups.
- Site visits with geo + photo check-in/checkout and manager verification.

**Enterprise modules**
- Projects / buildings / units with **QR code per unit**, customer QR for portal access, reserve/release with auto-expiry.
- Customers with KYC status, documents, LTV, loyalty points, digital agreement readiness.
- HR: employees, attendance, leave, payroll with PF / ESI / TDS computation.
- Finance: bookings, payments with receipts, invoices, expenses with approvals, partners, commissions, P&L summary.
- Marketing: campaigns with budget / leads / ROI and cost-per-lead.
- Reports: dashboard KPIs, widgets, lead / executive / revenue / funnel / source / commission reports, CSV export, scheduled reports, webhooks.
- AI insights: lead scoring, next-best-action, revenue forecast, recommendation engine, executive performance analysis, voice briefing (TTS).
- Extras: notifications, audit trail, tickets/support, RERA-ready documents, feature flags, multi-language UI (English / Hindi), **offline mode** with sync queue, **voice input** (Web Speech API), digital sign placeholder.

**White-label & multi-tenant**
- Every company is fully isolated. Login page is themed by company slug (logo, name, colors).
- Branding (logo, company name, theme colors, login screen) is configurable per company from Settings — no code changes.
- ~68 granular permissions across **17 roles** (`super_admin`, `company_admin`, `sales_manager`, `sales_executive`, `telecaller`, `finance_manager`, `hr_manager`, `marketing_manager`, `project_manager`, `operation_manager`, `customer_support`, `legal/compliance`, `auditor`, `analyst`, `partner`, `field_executive`, `portal_agent`).

## Demo Accounts

| Role | Email | Password |
|---|---|---|
| Super Admin (platform) | `super@propease.dev` | `Admin@123` |
| Company Admin | `admin@skyline.dev` | `Admin@123` |
| Sales Manager | `manager@skyline.dev` | `Manager@123` |
| Sales Executive | `rohan@skyline.dev` | `Exec@12345` |
| Finance Manager | `finance@skyline.dev` | `Fin@12345` |
| HR Manager | `hr@skyline.dev` | `Hr@12345` |
| Marketing Manager | `marketing@skyline.dev` | `Mkt@12345` |
| Partner | `partner@skyline.dev` | `Partner@123` |

Company slug: `skyline` (Skyline Developers). License: `LIC-DEMO-000001`.

> Try logging in with a Sales Executive account to see role-scoped data and forbidden routes.

## Quick Start

```bash
# Prerequisites: Node 22+
npm install

# One-shot: build the frontend and serve BOTH the UI and API on a single port (3001)
npm run serve

# --- or manually ---
# Backend (serves API + built frontend on port 3001)
cd backend && node src/seed.js && PORT=3001 node src/server.js

# Frontend build (bundled into backend's single-port serve)
cd frontend && npm run build
```

Health check: `GET /api/health`.

## Architecture

```
/workspace
├── backend/                  # Node 22, zero native deps
│   ├── src/
│   │   ├── server.js         # Express app + route mounting + serves built frontend (single port)
│   │   ├── db.js             # node:sqlite (WAL), full schema, audit()/notify()
│   │   ├── auth.js           # JWT, bcrypt, OTP/MFA, API keys, RBAC guards
│   │   ├── rbac.js           # permission catalog, roles, defaults
│   │   ├── seed.js           # idempotent demo data
│   │   ├── lib/              # helpers, assignment engine, AI/insights
│   │   └── routes/           # 14 route modules (see API surface)
│   └── data/app.db           # SQLite database (git-ignored)
└── frontend/                 # Vite + React 18 SPA (PWA)
    ├── src/pages/            # 22 pages incl. standalone customer portal
    ├── src/components/       # design system, charts (recharts), QR, voice
    ├── src/store.jsx         # auth, permissions, white-label theming
    ├── src/api.js            # fetch wrapper, offline-aware
    └── public/sw.js          # service worker: cache + offline sync queue
```

### Multi-tenancy
`users.company_id` scopes every query. No `company_id` parameter is ever trusted from the client — it is taken from the JWT. Super-admin routes are gated by `requireRole('super_admin')` per-route.

### RBAC
Roles → default permission sets in `rbac.js`. Users can be granted/denied individual permissions (View/Create/Edit/Delete/Approve/Export per module). Guards: `requireAuth`, `requirePerm`, `requireRole`.

### White-labeling
Company settings hold `branding.{companyName, logo, theme.{primary, primaryDark, accent}, loginScreen}`. `applyTheme()` in `store.jsx` writes CSS variables (`--brand`, `--brand-dark`, `--accent`); every page consumes them. Change branding in **Settings → Branding** and watch the whole app re-theme instantly.

### Offline / PWA
`sw.js` caches the app shell, serves GETs network-first with cache fallback, and queues failed mutations in IndexedDB, replaying them on reconnect. `api.js` returns `{queued:true}` for offline writes so the UI doesn't break.

### AI & Voice
- `/api/score`, `/api/next-best-action`, `/api/forecast`, `/api/recommend`, `/api/exec-analysis` — heuristic analytics (lead scoring, forecast by stage, LTV, coach-style tips).
- Voice input on lead forms via Web Speech API (`en-IN`/`hi-IN`); AI briefings spoken with SpeechSynthesis.
- i18n: `src/i18n.js` English/Hindi dictionary.

## API Surface (all under `/api`)

| Router | Base | Highlights |
|---|---|---|
| auth | `/api/auth` | login (MFA/OTP), me, permissions, otp |
| system | `/api/admin` | super-admin: companies, licenses, global feature flags, tickets |
| org | `/api` | settings, users, roles, api-keys, notifications (+`/notifications/remind`), audit, tickets, reports config, webhooks, subscription |
| master | `/api` | projects, buildings, units (incl. `/units/export/csv`), reserve/release, pipeline-stages (CRUD + reorder) |
| leads | `/api/leads` | CRUD, pipeline, assign, merge, import, export, messages (`/:id/messages` + bulk) |
| activities | `/api/activities` | follow-ups, site visits (checkin/checkout/verify) |
| customers | `/api/customers` | KYC, LTV, portal QR token |
| finance | `/api/finance` | bookings, payments, invoices, expenses, partners, commissions, summary |
| hr | `/api/hr` | employees, attendance, leaves, payroll |
| marketing | `/api` | campaigns (+`/campaigns`), ROI |
| field-force | `/api/field-force` | live map, location update, route/plan, visits CRUD + checkin/checkout/verify, geofenced attendance, missed |
| reports | `/api` | dashboard (KPIs, aging, conv-by-exec/project, ranking, forecast windows), widgets, lead/exec/revenue/funnel/source/commission, visit-success, lost, growth, heatmap, custom builder (`?dim&metric&export=csv`), export |
| ai | `/api` | score, next-best-action, forecast (+`/forecast/windows`), recommend, exec-analysis, whatsapp, email, summary, sentiment, risk, productivity |
| portal (public) | `/api` | `/public/branding/:slug`, `/intake`, `/webhook`, `/forms/submit`, `/portal/customer/:token` |
| communication | `/api` | support chats (create/assign/status/messages), internal conversations (direct/group, messages, reactions, typing, read receipts, admin moderation), channels, presence, upload, `/api/events` SSE live feed |
| listings | `/api/listings` | property catalogue CRUD, meta, dedupe import, source sync |
| loans | `/api/loans` | home-loan pipeline, dashboard summary / by-bank / commissions, EMI reminders |
| billing | `/api/billing` | invoice CRUD + PDF, reminders (overdue/upcoming), config, send |
| orgchart | `/api/orgchart` | departments, teams, members, tasks, users, cross-access, org tree |

## V2 Highlights (live-support, employee chat, catalogue, loans, billing, GPS, org hierarchy)

- **Live support chat**: customer chats with assign/transfer, status, unread counts and SSE push.
- **Internal employee chat**: 1:1 + group conversations, messages, reactions, typing, read receipts, attachments. Admins/HODs (`chat.moderate`) can view **every conversation and group** company-wide.
- **Project catalogue**: public microsite (`/api/public/catalogue/:slug`) with QR code, media, floor plans, price list, brochures.
- **Listings**: cross-portal property import (MagicBricks/99acres) with dedupe, category/type/status/price filters.
- **Home loans**: pipeline statuses, per-bank views, DSA commissions, EMI reminders.
- **Billing**: GST invoices + generated PDF, overdue/upcoming reminders, multi-channel send.
- **GPS field force**: live map, location trace (accuracy/battery/speed), per-user routes, daily plans, geofenced attendance.
- **Org hierarchy RBAC**: departments with HODs, teams with team leads, tasks, cross-access — scoped leads/activities/GPS per role.
- **Filters everywhere**: every section (Leads, Pipeline, Activities, FieldForce, Customers, Finance, Reports, Listings, Loans, Billing, Marketing) supports search / stage / source / priority / owner / project / date-range / status / price filters — and CSV export honours the active filters.
- **Click-through analytics**: every chart segment (donut, funnel, bars, heatmap cell, table row) navigates to its source section pre-filtered — e.g. Facebook slice → `/leads?source=Facebook`, funnel stage → `/leads?status=…`, heatmap area → `/leads?city=…&area=…`.

## Security Hardening

- JWT auth (`12h` expiry, `JWT_SECRET` env override) + permission gates per role; `super_admin` endpoints reject everyone else.
- Security headers: CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `X-XSS-Protection`.
- Rate limiting: strict per-IP limiter on `/api/auth/login` (brute-force lockout) + general API limiter.
- CSRF/origin check: state-changing requests (POST/PATCH/PUT/DELETE) reject cross-origin callers unless same-host or the preview domain.
- `password_hash` is never returned by any endpoint; role scoping on leads/activities/GPS/reports prevents cross-team data access.

## Data Model (core tables)

`companies, users, role_perms, otp_codes, api_keys, audit_log, projects, buildings, units, leads, lead_merges, activities, site_visits, customers, bookings, payments, invoices, employees, attendance, leaves, expenses, partners, commissions, campaigns, notifications, documents, tickets, feature_flags, scheduled_reports, webhooks, pipeline_stages, messages` plus V2: `support_chats, support_messages, conversations, conversation_members, conversation_messages, channels, listings, loans, invoices, reminder_logs, departments, teams, team_members, tasks, cross_access, location_trace`.

## Notes

- SQLite backend uses Node's experimental `node:sqlite` — the "experimental feature" warning is benign.
- Seed is idempotent: re-running `node src/seed.js` wipes and reloads demo data.
- Demo OTP (when MFA is enabled on a user) is returned in the login response — in production it would be sent via SMS/WhatsApp.
