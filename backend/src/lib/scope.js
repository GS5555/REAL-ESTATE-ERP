// V2 Data-scoping engine: enforces the org hierarchy visibility rules.
// Levels:
//   all        — super_admin / company_admin / ceo / cross-functional managers
//   department — HOD / Senior Manager: sees own dept + any cross-access grants
//   teams      — Manager / Asst Manager / Team Lead / Sales Manager: only teams they lead
//   own        — Executives / Sr Executives / Telecallers: only their own records (incl GPS)
import { get, all } from '../db.js';
import { ROLE_SCOPE } from '../rbac.js';

// Teams a user leads (from teams.leader_id) + their own team membership
export function managedTeamIds(user) {
  const rows = all('SELECT id FROM teams WHERE leader_id=?', user.id);
  const set = new Set(rows.map((r) => r.id));
  if (user.team_id) set.add(user.team_id);
  return [...set];
}

export function dataScope(user) {
  if (!user) return { level: 'own', userId: null };
  const level = ROLE_SCOPE[user.role] || 'own';
  const cross = all('SELECT department_id FROM cross_access WHERE user_id=?', user.id).map((r) => r.department_id);
  return {
    level,
    userId: user.id,
    departmentId: user.department_id || null,
    teamIds: level === 'teams' ? managedTeamIds(user) : [],
    crossDepartments: cross
  };
}

// Accessible department IDs for a user (department level + cross grants)
export function accessibleDepartments(user) {
  const s = dataScope(user);
  if (s.level === 'all') return null; // null = no restriction
  const depts = new Set();
  if (s.departmentId) depts.add(s.departmentId);
  for (const d of s.crossDepartments) depts.add(d);
  return [...depts];
}

// Accessible user IDs (owned records) for a user at team/own level
export function accessibleUserIds(user) {
  const s = dataScope(user);
  if (s.level === 'all') return null;
  if (s.level === 'own') return [user.id];
  const ids = new Set([user.id]);
  if (s.level === 'department') {
    const depts = accessibleDepartments(user);
    if (depts.length) {
      for (const d of all(`SELECT id FROM users WHERE department_id IN (${depts.map(() => '?').join(',')})`, ...depts)) ids.add(d.id);
    }
    return [...ids];
  }
  if (s.teamIds.length) {
    for (const t of all(`SELECT user_id FROM team_members WHERE team_id IN (${s.teamIds.map(() => '?').join(',')})`, ...s.teamIds)) ids.add(t.user_id);
    for (const t of all(`SELECT leader_id id FROM teams WHERE id IN (${s.teamIds.map(() => '?').join(',')})`, ...s.teamIds)) if (t.id) ids.add(t.id);
  }
  return [...ids];
}

// Build a SQL scope filter for a row-alias that has a `user_id` column (activities, site visits,
// location trace, attendance, tasks). Returns { clause, args } to AND into a WHERE.
export function userScope(user, alias = '') {
  const p = alias ? `${alias}.` : '';
  const s = dataScope(user);
  if (s.level === 'all') return { clause: '', args: [] };
  if (s.level === 'own') return { clause: `${p}user_id=?`, args: [user.id] };
  const ids = accessibleUserIds(user);
  if (!ids.length) return { clause: '1=0', args: [] };
  return { clause: `${p}user_id IN (${ids.map(() => '?').join(',')})`, args: ids };
}

// Scope filter for entities owned by a user via owner_id (leads, customers via owner).
export function ownerScope(user, alias = '') {
  const p = alias ? `${alias}.` : '';
  const s = dataScope(user);
  if (s.level === 'all') return { clause: '', args: [] };
  if (s.level === 'own') return { clause: `${p}owner_id=?`, args: [user.id] };
  const ids = accessibleUserIds(user);
  if (!ids.length) return { clause: '1=0', args: [] };
  return { clause: `${p}owner_id IN (${ids.map(() => '?').join(',')})`, args: ids };
}

// Department-scoped filter (employees, department tables). Null dept restriction = unrestricted.
export function deptScope(user, alias = '') {
  const p = alias ? `${alias}.` : '';
  const depts = accessibleDepartments(user);
  if (depts === null) return { clause: '', args: [] };
  if (!depts.length) return { clause: '1=0', args: [] };
  return { clause: `${p}department_id IN (${depts.map(() => '?').join(',')})`, args: depts };
}

// GPS scope: executives see only themselves, managers/leads see their team, HOD+ see dept.
export function gpsScope(user, alias = '') {
  const p = alias ? `${alias}.` : '';
  const s = dataScope(user);
  if (s.level === 'all' || s.level === 'department') return { clause: '', args: [] };
  if (s.level === 'own') return { clause: `${p}user_id=?`, args: [user.id] };
  const ids = accessibleUserIds(user);
  if (!ids.length) return { clause: '1=0', args: [] };
  return { clause: `${p}user_id IN (${ids.map(() => '?').join(',')})`, args: ids };
}

export function canSeeAll(user) {
  return dataScope(user).level === 'all';
}

export default { dataScope, accessibleDepartments, accessibleUserIds, userScope, ownerScope, deptScope, gpsScope, canSeeAll };
