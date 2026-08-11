import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import { Card, Button, Field, Input, Select, Badge, Modal, Empty } from '../components/ui';
import { useToast } from '../components/ui';

export default function Organization() {
  const { can } = useStore();
  const toast = useToast();
  const [org, setOrg] = useState(null);
  const [access, setAccess] = useState([]);
  const [deptModal, setDeptModal] = useState(false);
  const [teamModal, setTeamModal] = useState(false);
  const [memberTeam, setMemberTeam] = useState(null);
  const [accessModal, setAccessModal] = useState(false);
  const [dForm, setDForm] = useState({ name: '' });
  const [tForm, setTForm] = useState({ name: '', department_id: '', leader_id: '' });
  const [mForm, setMForm] = useState({ user_id: '' });
  const [aForm, setAForm] = useState({ user_id: '', department_id: '' });

  const load = () => {
    api.get('/orgchart/org').then(setOrg).catch(() => {});
    api.get('/orgchart/access').then(setAccess).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const users = org?.users || [];
  const departments = org?.departments || [];
  const teams = org?.teams || [];
  const nameOf = (id) => users.find((u) => u.id === id)?.name || '—';

  const saveDept = async () => {
    if (!dForm.name) return toast('Department name required', 'error');
    try { await api.post('/orgchart/departments', dForm); setDeptModal(false); setDForm({ name: '' }); load(); toast('Department created', 'success'); }
    catch (e) { toast(e.message, 'error'); }
  };

  const saveTeam = async () => {
    if (!tForm.name || !tForm.department_id) return toast('Name and department required', 'error');
    try { await api.post('/orgchart/teams', tForm); setTeamModal(false); setTForm({ name: '', department_id: '', leader_id: '' }); load(); toast('Team created', 'success'); }
    catch (e) { toast(e.message, 'error'); }
  };

  const addMember = async (teamId) => {
    if (!mForm.user_id) return;
    try { await api.post(`/orgchart/teams/${teamId}/members`, mForm); setMemberTeam(null); setMForm({ user_id: '' }); load(); toast('Member added', 'success'); }
    catch (e) { toast(e.message, 'error'); }
  };

  const removeMember = async (teamId, uid) => {
    try { await api.del(`/orgchart/teams/${teamId}/members/${uid}`); load(); } catch (e) { toast(e.message, 'error'); }
  };

  const addAccess = async () => {
    if (!aForm.user_id || !aForm.department_id) return toast('Pick a user and department', 'error');
    try { await api.post('/orgchart/access', aForm); setAccessModal(false); setAForm({ user_id: '', department_id: '' }); load(); toast('Cross access granted', 'success'); }
    catch (e) { toast(e.message, 'error'); }
  };

  const removeAccess = async (user_id, department_id) => {
    try {
      await fetch('/api/orgchart/access', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('pp_token') },
        body: JSON.stringify({ user_id, department_id })
      });
      load();
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ fontSize: 20 }}>Organization</h2>
        <div className="grow" />
        {can('org.manage') && <Button variant="primary" onClick={() => setTeamModal(true)}>+ Team</Button>}
        {can('org.manage') && <Button variant="primary" onClick={() => setDeptModal(true)}>+ Department</Button>}
        {can('org.manage') && <Button onClick={() => setAccessModal(true)}>+ Cross Access</Button>}
      </div>

      {!org ? <div className="empty">Loading…</div> : (
        <div className="grid c2">
          {departments.length === 0 && <Card><Empty text="No departments yet" /></Card>}
          {departments.map((d) => (
            <Card key={d.id}>
              <div className="flex between items-center mb">
                <div>
                  <b style={{ fontSize: 15 }}>{d.name}</b>
                  <div className="small muted">HOD: {nameOf(d.hod_id)}</div>
                </div>
                <Badge tone="brand">{d.headCount || teams.filter((t) => t.department_id === d.id).length} people</Badge>
              </div>
              {teams.filter((t) => t.department_id === d.id).length === 0 && <div className="small muted">No teams yet</div>}
              {teams.filter((t) => t.department_id === d.id).map((t) => {
                const members = users.filter((u) => u.team_id === t.id);
                return (
                  <div key={t.id} className="mb" style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
                    <div className="flex between items-center">
                      <b>{t.name}</b>
                      <span className="small muted">Lead: {nameOf(t.leader_id)}</span>
                    </div>
                    <div className="small mt">
                      {members.length === 0 && <span className="muted">No members</span>}
                      {members.map((m) => (
                        <span key={m.id} className="badge gray" style={{ marginRight: 6, marginTop: 6 }}>
                          {m.name}
                          {can('org.members') && <button className="btn ghost sm" style={{ marginLeft: 4 }} onClick={() => removeMember(t.id, m.id)}>✕</button>}
                        </span>
                      ))}
                    </div>
                    {can('org.members') && (
                      <div className="flex gap mt">
                        {memberTeam === t.id ? (
                          <>
                            <Select value={mForm.user_id} onChange={(e) => setMForm({ user_id: e.target.value })}>
                              <option value="">Select user…</option>
                              {users.filter((u) => !u.team_id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                            </Select>
                            <Button sm variant="primary" onClick={() => addMember(t.id)}>Add</Button>
                            <Button sm ghost onClick={() => setMemberTeam(null)}>Cancel</Button>
                          </>
                        ) : (
                          <Button sm onClick={() => setMemberTeam(t.id)}>+ Add member</Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </Card>
          ))}
        </div>
      )}

      <Card className="mt">
        <div className="flex between items-center mb">
          <h3>Cross-Department Access</h3>
        </div>
        {access.length === 0 && <div className="small muted">No cross-access grants</div>}
        {access.map((a) => (
          <div key={a.user_id + a.department_id} className="flex between items-center" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
            <div><b>{a.user_name}</b> <span className="small muted">→ {a.department_name}</span></div>
            <Button sm ghost onClick={() => removeAccess(a.user_id, a.department_id)}>Revoke</Button>
          </div>
        ))}
      </Card>

      {deptModal && (
        <Modal title="New Department" onClose={() => setDeptModal(false)} footer={<>
          <Button onClick={() => setDeptModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={saveDept}>Create</Button>
        </>}>
          <Field label="Department name"><Input value={dForm.name} onChange={(e) => setDForm({ name: e.target.value })} placeholder="e.g. Sales" /></Field>
        </Modal>
      )}

      {teamModal && (
        <Modal title="New Team" onClose={() => setTeamModal(false)} footer={<>
          <Button onClick={() => setTeamModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={saveTeam}>Create</Button>
        </>}>
          <div className="frm-grid">
            <Field label="Team name"><Input value={tForm.name} onChange={(e) => setTForm({ ...tForm, name: e.target.value })} /></Field>
            <Field label="Department"><Select value={tForm.department_id} onChange={(e) => setTForm({ ...tForm, department_id: e.target.value })}><option value="">—</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
            <Field label="Team leader"><Select value={tForm.leader_id} onChange={(e) => setTForm({ ...tForm, leader_id: e.target.value })}><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
          </div>
        </Modal>
      )}

      {accessModal && (
        <Modal title="Grant Cross-Access" onClose={() => setAccessModal(false)} footer={<>
          <Button onClick={() => setAccessModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={addAccess}>Grant</Button>
        </>}>
          <div className="frm-grid">
            <Field label="User"><Select value={aForm.user_id} onChange={(e) => setAForm({ ...aForm, user_id: e.target.value })}><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
            <Field label="Department"><Select value={aForm.department_id} onChange={(e) => setAForm({ ...aForm, department_id: e.target.value })}><option value="">—</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
