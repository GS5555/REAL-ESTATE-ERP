import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import { Card, Button, Badge, DataTable, Modal, Field, Input, Select, Tabs, Avatar, Empty, Textarea } from '../components/ui';
import { useToast } from '../components/ui';

export default function UsersRoles() {
  const { user } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState(null);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ role: 'sales_executive' });
  const [roleModal, setRoleModal] = useState(false);
  const [roleForm, setRoleForm] = useState(null);
  const [roleBusy, setRoleBusy] = useState(false);

  const load = () => {
    api.get('/users').then(setUsers).catch(() => {});
    api.get('/roles').then(setRoles).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name || !form.password) return toast('Name & password required', 'error');
    await api.post('/users', form);
    setModal(false); setForm({ role: 'sales_executive' }); load(); toast('User created', 'success');
  };

  const toggleActive = async (u) => {
    await api.patch(`/users/${u.id}`, { active: u.active ? false : true });
    load();
  };

  const openNewRole = () => {
    const perms = (roles?.catalog || []).map((p) => p.key).filter((k) => k.startsWith('dashboard.') || k.startsWith('lead.') || k.startsWith('pipeline.') || k.startsWith('customer.') || k.startsWith('activity.') || k.startsWith('task.'));
    setRoleForm({ label: '', permissions: perms, editing: null });
    setRoleModal(true);
  };

  const openEditRole = (r) => {
    setRoleForm({ label: r.label, permissions: [...r.permissions], editing: r });
    setRoleModal(true);
  };

  const saveRole = async () => {
    if (!roleForm?.label?.trim()) return toast('Role title required', 'error');
    setRoleBusy(true);
    try {
      if (roleForm.editing) {
        await api.put(`/roles/${roleForm.editing.role}`, { label: roleForm.label, permissions: roleForm.permissions });
        toast('Role updated', 'success');
      } else {
        await api.post('/roles', { label: roleForm.label, permissions: roleForm.permissions });
        toast('Custom role created', 'success');
      }
      setRoleModal(false); setRoleForm(null); load();
    } catch (e) {
      toast(e.message || 'Failed to save role', 'error');
    }
    setRoleBusy(false);
  };

  const deleteRole = async (r) => {
    if (!confirm(`Delete custom role "${r.label}"? Users assigned this role will be moved to Sales Executive.`)) return;
    await api.del(`/roles/${r.role}`);
    setRoleModal(false); setRoleForm(null); load(); toast('Role deleted', 'success');
  };

  const toggleRolePerm = (key) => {
    setRoleForm((f) => {
      const has = f.permissions.includes(key);
      return { ...f, permissions: has ? f.permissions.filter((p) => p !== key) : [...f.permissions, key] };
    });
  };

  const selectAllGroup = (group) => {
    const keys = (roles.catalog || []).filter((p) => p.group === group).map((p) => p.key);
    const allOn = keys.every((k) => roleForm.permissions.includes(k));
    setRoleForm((f) => ({
      ...f,
      permissions: allOn ? f.permissions.filter((p) => !keys.includes(p)) : [...new Set([...f.permissions, ...keys])]
    }));
  };

  const togglePerm = async (role, perm) => {
    const perms = roles.roles.find((r) => r.role === role).permissions;
    const next = perms.includes(perm) ? perms.filter((p) => p !== perm) : [...perms, perm];
    await api.put(`/roles/${role}`, { permissions: next });
    load(); toast(`Permission updated for ${role}`, 'success');
  };

  const tabs = [{ key: 'users', label: 'Users' }, { key: 'roles', label: 'Role Permissions' }];

  const groups = roles ? [...new Set((roles.catalog || []).map((p) => p.group))] : [];

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ fontSize: 20 }}>Users & Roles</h2>
        <div className="grow" />
        <Button onClick={() => setTab('roles')}>⚙ Manage Roles</Button>
        <Button variant="primary" onClick={() => setModal(true)}>+ New User</Button>
      </div>
      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'users' && (
        <Card pad={false}>
          {users.length === 0 ? <Empty /> : (
            <DataTable
              rows={users.filter((u) => user.role === 'super_admin' || u.company_id === user.company_id)}
              columns={[
                { key: 'name', label: 'User', render: (r) => <div className="flex items-center gap"><Avatar name={r.name} /><div><b>{r.name}</b><div className="small muted">{r.email || r.phone}</div></div></div> },
                { key: 'role', label: 'Role', render: (r) => <Badge tone={r.role === 'super_admin' ? 'purple' : r.role === 'company_admin' ? 'red' : r.role.startsWith('custom_') ? 'green' : 'blue'}>{r.role.replace(/_/g, ' ')}</Badge> },
                { key: 'mfa_enabled', label: '2FA', render: (r) => r.mfa_enabled ? <Badge tone="green">On</Badge> : <Badge tone="gray">Off</Badge> },
                { key: 'last_login', label: 'Last Login', render: (r) => r.last_login ? new Date(r.last_login).toLocaleDateString('en-IN') : '—' },
                { key: 'active', label: 'Active', render: (r) => <SwitchInline checked={r.active} onChange={() => toggleActive(r)} /> }
              ]}
            />
          )}
        </Card>
      )}

      {tab === 'roles' && roles && (
        <Card>
          <div className="flex between mb">
            <div className="small muted">Configure permissions per role with checkboxes. Custom roles can be created with any title and edited any time. Super Admin always has full access.</div>
            <Button variant="primary" onClick={openNewRole}>+ Create Custom Role</Button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th rowSpan={2}>Role</th>
                  {groups.map((g) => {
                    const perms = roles.catalog.filter((p) => p.group === g);
                    return <th key={g} colSpan={perms.length} style={{ textAlign: 'center', background: 'var(--bg)', color: 'var(--muted)', fontWeight: 700 }}>{g}</th>;
                  })}
                  <th rowSpan={2} style={{ textAlign: 'center' }}>Actions</th>
                </tr>
                <tr>
                  {roles.catalog.map((p) => (
                    <th key={p.key} title={p.key} style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', fontSize: 11, height: 120, minWidth: 26, textAlign: 'center', fontWeight: 600, whiteSpace: 'nowrap', maxWidth: 26 }}>{p.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roles.roles.filter((r) => r.role !== 'super_admin').map((r) => (
                  <tr key={r.role}>
                    <td style={{ whiteSpace: 'nowrap' }}><b>{r.label}</b>{r.custom && <Badge tone="green" style={{ marginLeft: 6 }}>Custom</Badge>}</td>
                    {roles.catalog.map((p) => (
                      <td key={p.key} style={{ textAlign: 'center' }}>
                        <input type="checkbox" checked={r.permissions.includes(p.key)} onChange={() => togglePerm(r.role, p.key)} />
                      </td>
                    ))}
                    <td style={{ textAlign: 'center' }}>
                      <Button sm ghost onClick={() => openEditRole(r)}>Edit</Button>
                      {r.custom && <Button sm ghost danger onClick={() => deleteRole(r)}>Delete</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="small muted mt">Hover any permission header to see its key. Task permissions (View/Assign/Edit) control who can be assigned tasks.</div>
        </Card>
      )}

      {modal && (
        <Modal title="New User" onClose={() => setModal(false)} footer={<>
          <Button onClick={() => setModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={save}>Create User</Button>
        </>}>
          <div className="frm-grid">
            <Field label="Full Name"><Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Role"><Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{roles?.roles.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}</Select></Field>
            <Field label="Email"><Input value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Phone"><Input value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Password"><Input type="password" value={form.password || ''} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
            <Field label="Area / Projects (comma-sep for area-based assignment)"><Input value={form.meta?.areas?.join(', ') || ''} onChange={(e) => setForm({ ...form, meta: { ...form.meta, areas: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) } })} /></Field>
          </div>
        </Modal>
      )}

      {roleModal && roleForm && (
        <Modal title={roleForm.editing ? `Edit Role — ${roleForm.editing.label}` : 'Create Custom Role'} onClose={() => setRoleModal(false)} wide footer={<>
          <Button onClick={() => setRoleModal(false)}>Cancel</Button>
          {roleForm.editing?.custom && <Button danger ghost onClick={() => deleteRole(roleForm.editing)}>Delete Role</Button>}
          <Button variant="primary" disabled={roleBusy} onClick={saveRole}>{roleBusy ? 'Saving…' : roleForm.editing ? 'Save Changes' : 'Create Role'}</Button>
        </>}>
          <div className="mb">
            <Field label="Role Title">
              <Input value={roleForm.label || ''} placeholder="e.g. Digital Marketing Executive" onChange={(e) => setRoleForm({ ...roleForm, label: e.target.value })} />
            </Field>
          </div>
          <div className="small muted mb">Tick the permissions to grant this role. Every View/Create/Edit/Delete/Approve/Export is individually toggleable.</div>
          <div style={{ maxHeight: 420, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
            {groups.map((g) => {
              const keys = (roles.catalog || []).filter((p) => p.group === g).map((p) => p.key);
              const allOn = keys.every((k) => roleForm.permissions.includes(k));
              return (
                <div key={g} style={{ marginBottom: 12 }}>
                  <div className="flex between" style={{ background: 'var(--bg)', padding: '4px 8px', borderRadius: 6, cursor: 'pointer' }} onClick={() => selectAllGroup(g)}>
                    <b style={{ fontSize: 13 }}>{g}</b>
                    <span className="small muted">{allOn ? 'All granted — click to clear' : 'Select all'}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '2px 8px', paddingTop: 4 }}>
                    {(roles.catalog || []).filter((p) => p.group === g).map((p) => (
                      <label key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, padding: '2px 4px', borderRadius: 4, cursor: 'pointer' }} title={p.key}>
                        <input type="checkbox" checked={roleForm.permissions.includes(p.key)} onChange={() => toggleRolePerm(p.key)} />
                        {p.label}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="small muted mt">Hover any permission to see its key. You can edit permissions & rename the role any time.</div>
        </Modal>
      )}
    </div>
  );
}

function SwitchInline({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={onChange}
      style={{
        width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', position: 'relative',
        background: checked ? 'var(--brand, #1d4ed8)' : '#cbd5e1', transition: 'background .15s'
      }}
      aria-checked={checked}
    >
      <span style={{
        position: 'absolute', top: 2, left: checked ? 20 : 2, width: 18, height: 18, borderRadius: '50%',
        background: '#fff', transition: 'left .15s', boxShadow: '0 1px 2px rgba(0,0,0,.3)'
      }} />
    </button>
  );
}
