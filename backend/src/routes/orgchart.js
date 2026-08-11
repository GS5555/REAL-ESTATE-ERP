// V2 Organization hierarchy: departments, teams, team members, tasks, cross-department access,
// org chart, and data-scope aware views.
import { Router } from 'express';
import { get, run, all, ts, id, audit, notify } from '../db.js';
import { requireAuth, can, hasRole } from '../auth.js';
import { dataScope, accessibleDepartments, accessibleUserIds } from '../lib/scope.js';

const router = Router();
router.use(requireAuth);

const MANAGER_ROLES = ['company_admin', 'ceo', 'director', 'general_manager', 'hod', 'sr_manager', 'manager', 'assistant_manager', 'team_lead', 'sales_manager', 'team_leader'];

// ==================== DEPARTMENTS ====================
router.get('/departments', (req, res) => {
  if (!can(req.user, 'org.view') && !MANAGER_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const depts = all('SELECT * FROM departments WHERE company_id=? ORDER BY name', req.user.company_id);
  const members = all(
    `SELECT u.id user_id, u.name, u.role, u.department_id, u.team_id, d.name department_name
     FROM users u LEFT JOIN departments d ON d.id=u.department_id
     WHERE u.company_id=? AND u.active=1 ORDER BY u.name`, req.user.company_id);
  const teams = all('SELECT * FROM teams WHERE company_id=? ORDER BY name', req.user.company_id);
  res.json({
    departments: depts.map((d) => ({
      ...d,
      teams: teams.filter((t) => t.department_id === d.id).map((t) => ({
        ...t,
        members: members.filter((m) => m.team_id === t.id)
      })),
      headCount: members.filter((m) => m.department_id === d.id).length
    })),
    members,
    teams
  });
});

router.post('/departments', (req, res) => {
  if (!can(req.user, 'org.manage')) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name required' });
  const did = id();
  run('INSERT INTO departments (id, company_id, name, hod_id, created_at) VALUES (?,?,?,?,?)',
    did, req.user.company_id, b.name, b.hod_id || null, ts());
  if (b.hod_id) run('UPDATE users SET department_id=?, role=? WHERE id=?', did, 'hod', b.hod_id);
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'org.department.create', entity: 'department', entity_id: did, module: 'org' });
  res.json({ ok: true, id: did });
});

router.patch('/departments/:id', (req, res) => {
  if (!can(req.user, 'org.manage')) return res.status(403).json({ error: 'Forbidden' });
  const d = get('SELECT * FROM departments WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!d) return res.status(404).json({ error: 'Not found' });
  if (req.body.name !== undefined) run('UPDATE departments SET name=? WHERE id=?', req.body.name, d.id);
  if (req.body.hod_id !== undefined) {
    run('UPDATE departments SET hod_id=? WHERE id=?', req.body.hod_id, d.id);
    run('UPDATE users SET role=? WHERE id=?', 'executive', d.hod_id); // revoke old HOD's dept-head role
    run('UPDATE users SET department_id=?, role=? WHERE id=?', d.id, 'hod', req.body.hod_id);
  }
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'org.department.update', entity: 'department', entity_id: d.id, module: 'org' });
  res.json({ ok: true });
});

// ==================== TEAMS ====================
router.post('/teams', (req, res) => {
  if (!can(req.user, 'org.manage') && !hasRole(req.user, ['hod'])) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name required' });
  if (b.department_id) {
    const d = get('SELECT * FROM departments WHERE id=? AND company_id=?', b.department_id, req.user.company_id);
    if (!d) return res.status(404).json({ error: 'Department not found' });
    // HOD can only create teams in their own department
    if (req.user.role === 'hod' && req.user.department_id !== d.id) return res.status(403).json({ error: 'Can only manage own department' });
  }
  const tid = id();
  run('INSERT INTO teams (id, company_id, department_id, name, leader_id, location, created_at) VALUES (?,?,?,?,?,?,?)',
    tid, req.user.company_id, b.department_id || req.user.department_id || null, b.name, b.leader_id || null, b.location || null, ts());
  if (b.leader_id) {
    run('UPDATE users SET team_id=?, department_id=?, role=? WHERE id=?', tid, b.department_id || req.user.department_id || null, 'team_lead', b.leader_id);
    run('INSERT OR REPLACE INTO team_members (team_id, user_id, role_in_team, joined_at) VALUES (?,?,?,?)', tid, b.leader_id, 'team_lead', ts());
  }
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'org.team.create', entity: 'team', entity_id: tid, module: 'org' });
  res.json({ ok: true, id: tid });
});

router.patch('/teams/:id', (req, res) => {
  if (!can(req.user, 'org.manage') && !hasRole(req.user, ['hod'])) return res.status(403).json({ error: 'Forbidden' });
  const t = get('SELECT * FROM teams WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (t.department_id !== req.user.department_id && req.user.role === 'hod') return res.status(403).json({ error: 'Can only manage own department' });
  if (req.body.name !== undefined) run('UPDATE teams SET name=? WHERE id=?', req.body.name, t.id);
  if (req.body.location !== undefined) run('UPDATE teams SET location=? WHERE id=?', req.body.location, t.id);
  if (req.body.leader_id !== undefined) {
    run('UPDATE teams SET leader_id=? WHERE id=?', req.body.leader_id, t.id);
    run('UPDATE users SET role=? WHERE id=?', 'executive', t.leader_id);
    run('UPDATE users SET team_id=?, role=? WHERE id=?', t.id, 'team_lead', req.body.leader_id);
    run('INSERT OR REPLACE INTO team_members (team_id, user_id, role_in_team, joined_at) VALUES (?,?,?,?)', t.id, req.body.leader_id, 'team_lead', ts());
  }
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'org.team.update', entity: 'team', entity_id: t.id, module: 'org' });
  res.json({ ok: true });
});

// Add / remove team members (admin / HOD / managers can assign members)
router.post('/teams/:id/members', (req, res) => {
  if (!can(req.user, 'org.members')) return res.status(403).json({ error: 'Forbidden' });
  const t = get('SELECT * FROM teams WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!t) return res.status(404).json({ error: 'Team not found' });
  const userId = req.body?.user_id;
  if (!userId) return res.status(400).json({ error: 'user_id required' });
  const user = get('SELECT * FROM users WHERE id=? AND company_id=?', userId, req.user.company_id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  run('UPDATE users SET team_id=?, department_id=? WHERE id=?', t.id, t.department_id, userId);
  run('INSERT OR REPLACE INTO team_members (team_id, user_id, role_in_team, joined_at) VALUES (?,?,?,?)', t.id, userId, user.role, ts());
  notify(req.user.company_id, userId, 'Added to team', `You were added to team ${t.name}`);
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'org.team.addmember', entity: 'team', entity_id: t.id, detail: { user_id: userId }, module: 'org' });
  res.json({ ok: true });
});

router.delete('/teams/:id/members/:uid', (req, res) => {
  if (!can(req.user, 'org.members')) return res.status(403).json({ error: 'Forbidden' });
  run('DELETE FROM team_members WHERE team_id=? AND user_id=?', req.params.id, req.params.uid);
  run('UPDATE users SET team_id=NULL WHERE id=?', req.params.uid);
  res.json({ ok: true });
});

// ==================== TASKS (HOD / manager / TL assign) ====================
router.get('/tasks', (req, res) => {
  if (!can(req.user, 'task.view')) return res.status(403).json({ error: 'Forbidden' });
  const s = dataScope(req.user);
  const scope = accessibleUserIds(req.user);
  const where = ['company_id=?'];
  const args = [req.user.company_id];
  if (scope !== null) {
    where.push(`(assignee_id IN (${scope.map(() => '?').join(',')}) OR assigner_id=?)`);
    args.push(...scope, req.user.id);
  }
  if (req.query.status) { where.push('status=?'); args.push(req.query.status); }
  if (req.query.assignee_id) { where.push('assignee_id=?'); args.push(req.query.assignee_id); }
  if (req.query.team_id) { where.push('team_id=?'); args.push(req.query.team_id); }
  const rows = all(`SELECT * FROM tasks WHERE ${where.join(' AND ')} ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, due_date ASC LIMIT 200`, ...args);
  const users = new Map(all('SELECT id, name FROM users WHERE company_id=?', req.user.company_id).map((u) => [u.id, u.name]));
  res.json(rows.map((r) => ({ ...r, assignee_name: users.get(r.assignee_id) || null, assigner_name: users.get(r.assigner_id) || null })));
});

router.post('/tasks', (req, res) => {
  if (!can(req.user, 'task.assign')) return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: 'title required' });
  const tid = id();
  run(`INSERT INTO tasks (id, company_id, title, description, assignee_id, assigner_id, department_id, team_id, due_date, priority, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    tid, req.user.company_id, b.title, b.description || null, b.assignee_id || null, req.user.id,
    b.department_id || req.user.department_id || null, b.team_id || req.user.team_id || null,
    b.due_date || null, b.priority || 'normal', b.status || 'pending', ts(), ts());
  if (b.assignee_id) notify(req.user.company_id, b.assignee_id, 'New task assigned', b.title);
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'task.create', entity: 'task', entity_id: tid, detail: { assignee_id: b.assignee_id }, module: 'org' });
  res.json({ ok: true, id: tid });
});

router.patch('/tasks/:id', (req, res) => {
  if (!can(req.user, 'task.edit') && req.user.id !== get('SELECT assignee_id FROM tasks WHERE id=?', req.params.id)?.assignee_id) return res.status(403).json({ error: 'Forbidden' });
  const t = get('SELECT * FROM tasks WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const fields = ['title', 'description', 'due_date', 'priority', 'status'];
  for (const f of fields) if (req.body[f] !== undefined) run(`UPDATE tasks SET ${f}=? WHERE id=?`, req.body[f], t.id);
  if (req.body.assignee_id !== undefined && can(req.user, 'task.assign')) run('UPDATE tasks SET assignee_id=? WHERE id=?', req.body.assignee_id, t.id);
  run('UPDATE tasks SET updated_at=? WHERE id=?', ts(), t.id);
  res.json({ ok: true });
});

// ==================== ORG CHART ====================
router.get('/org', (req, res) => {
  if (!can(req.user, 'org.view') && !MANAGER_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const scope = dataScope(req.user);
  const allowedDepts = accessibleDepartments(req.user);
  let users;
  if (scope.level === 'all') {
    users = all('SELECT id, name, role, department_id, team_id, manager_id, phone FROM users WHERE company_id=? AND active=1', req.user.company_id);
  } else if (scope.level === 'department') {
    users = all(`SELECT id, name, role, department_id, team_id, manager_id, phone FROM users WHERE company_id=? AND department_id IN (${allowedDepts.map(() => '?').join(',')}) AND active=1`, req.user.company_id, ...allowedDepts);
  } else {
    const ids = accessibleUserIds(req.user) || [];
    users = ids.length ? all(`SELECT id, name, role, department_id, team_id, manager_id, phone FROM users WHERE company_id=? AND id IN (${ids.map(() => '?').join(',')})`, req.user.company_id, ...ids) : [];
  }
  const depts = allowedDepts === null
    ? all('SELECT * FROM departments WHERE company_id=?', req.user.company_id)
    : all(`SELECT * FROM departments WHERE company_id=? AND id IN (${allowedDepts.map(() => '?').join(',')})`, req.user.company_id, ...allowedDepts);
  const teams = all('SELECT * FROM teams WHERE company_id=?', req.user.company_id).filter((t) => !t.department_id || depts.some((d) => d.id === t.department_id));
  res.json({ users, departments: depts, teams });
});

// ==================== CROSS-DEPARTMENT ACCESS ====================
router.get('/access', (req, res) => {
  if (!can(req.user, 'org.view') && !MANAGER_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  res.json(all('SELECT ca.*, d.name department_name, u.name user_name FROM cross_access ca JOIN departments d ON d.id=ca.department_id JOIN users u ON u.id=ca.user_id WHERE ca.user_id=? OR ca.user_id IN (SELECT id FROM users WHERE company_id=?) ORDER BY ca.created_at DESC', req.user.id, req.user.company_id));
});

router.post('/access', (req, res) => {
  if (!can(req.user, 'cross.access') && !MANAGER_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const { user_id, department_id } = req.body || {};
  if (!user_id || !department_id) return res.status(400).json({ error: 'user_id and department_id required' });
  run('INSERT OR IGNORE INTO cross_access (user_id, department_id, granted_by, created_at) VALUES (?,?,?,?)', user_id, department_id, req.user.id, ts());
  audit({ company_id: req.user.company_id, user_id: req.user.id, user_name: req.user.name, action: 'org.crossaccess.grant', entity: 'user', entity_id: user_id, detail: { department_id }, module: 'org' });
  res.json({ ok: true });
});

router.delete('/access', (req, res) => {
  if (!can(req.user, 'cross.access') && !MANAGER_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const { user_id, department_id } = req.body || {};
  run('DELETE FROM cross_access WHERE user_id=? AND department_id=?', user_id, department_id);
  res.json({ ok: true });
});

export default router;
