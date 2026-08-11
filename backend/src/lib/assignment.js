import { get, all } from '../db.js';

// Round-robin / rule-based lead assignment.
// rules: { mode: 'round_robin'|'area'|'project'|'source'|'manager', value }
// Users eligible must have role sales_executive/team_leader/telecaller or listed in config.

const ASSIGNABLE_ROLES = ['sales_executive', 'telecaller', 'team_leader', 'sales_manager'];

export function assignableUsers(companyId, excludeId) {
  const rows = all(
    `SELECT * FROM users WHERE company_id=? AND active=1 AND role IN (?,?,?,?)`,
    companyId, 'sales_executive', 'telecaller', 'team_leader', 'sales_manager'
  );
  return rows.filter((u) => u.id !== excludeId);
}

export function assignLead(companyId, lead, settings = {}) {
  const mode = settings.mode || 'round_robin';
  const users = assignableUsers(companyId, lead.owner_id);
  if (!users.length) return null;

  if (mode === 'manager') {
    const mgr = get('SELECT * FROM users WHERE company_id=? AND role=? AND active=1', companyId, settings.value || 'sales_manager');
    return mgr ? mgr.id : users[0].id;
  }

  if (mode === 'area') {
    const u = users.find((x) => {
      const meta = safeMeta(x);
      return meta.areas && lead.area && meta.areas.some((a) => String(a).toLowerCase() === String(lead.area).toLowerCase());
    });
    if (u) return u.id;
  }

  if (mode === 'project') {
    const u = users.find((x) => {
      const meta = safeMeta(x);
      return meta.projects && meta.projects.includes(lead.project_id);
    });
    if (u) return u.id;
  }

  if (mode === 'source') {
    const u = users.find((x) => {
      const meta = safeMeta(x);
      return meta.sources && meta.sources.map(String).includes(String(lead.source));
    });
    if (u) return u.id;
  }

  if (mode === 'nearby' && (lead.latitude || lead.longitude)) {
    // Assign to the nearest executive based on their last known location
    const withLoc = users
      .map((u) => {
        const meta = safeMeta(u);
        const la = u.lat ?? meta.location?.lat;
        const ln = u.lng ?? meta.location?.lng;
        return { user: u, la, ln };
      })
      .filter((x) => x.la != null && x.ln != null)
      .map((x) => ({
        user: x.user,
        km: haversine(lead.latitude, lead.longitude, x.la, x.ln)
      }));
    if (withLoc.length) {
      withLoc.sort((a, b) => a.km - b.km);
      return withLoc[0].user.id;
    }
  }

  // round robin: pick the user with the fewest open leads
  const counts = users.map((u) => {
    const c = get(
      `SELECT COUNT(*) AS n FROM leads WHERE company_id=? AND owner_id=? AND status NOT IN ('lost','cancelled','completed','junk')`,
      companyId, u.id
    );
    return { user: u, n: c ? c.n : 0 };
  });
  counts.sort((a, b) => a.n - b.n);
  return counts[0].user.id;
}

function safeMeta(user) {
  try {
    return JSON.parse(user.meta || '{}');
  } catch {
    return {};
  }
}

export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
