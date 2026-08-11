import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { api, fmtDate } from '../api';
import { Card, Button, Badge, Field, Input, Select, Textarea, Tabs, Empty, Modal } from '../components/ui';
import { useToast } from '../components/ui';

const STATUS_TONES = { pending: 'amber', in_progress: 'blue', completed: 'green', cancelled: 'gray' };
const PRIORITY_TONES = { low: 'gray', normal: 'blue', high: 'amber', urgent: 'red' };
const STATUSES = ['pending', 'in_progress', 'completed'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const TABS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' }
];

export default function Tasks() {
  const { user, can } = useStore();
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [users, setUsers] = useState([]);
  const [tab, setTab] = useState('all');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', due_date: '', priority: 'normal', assignee_id: '' });

  const load = () => api.get('/orgchart/tasks').then(setItems).catch(() => {});
  useEffect(() => { load(); }, []);

  useEffect(() => {
    api.get('/orgchart/org').then((o) => setUsers(o.users || [])).catch(() => api.get('/users').then(setUsers).catch(() => setUsers([])));
  }, []);

  const create = async () => {
    if (!form.title) return toast('Title required', 'error');
    try {
      await api.post('/orgchart/tasks', { ...form, assignee_id: form.assignee_id || null });
      setModal(false); setForm({ title: '', description: '', due_date: '', priority: 'normal', assignee_id: '' }); load(); toast('Task created', 'success');
    } catch (e) { toast(e.message, 'error'); }
  };

  const reassign = async (t, assignee_id) => {
    try { await api.patch(`/orgchart/tasks/${t.id}`, { assignee_id: assignee_id || null }); load(); toast('Task reassigned', 'success'); }
    catch (e) { toast(e.message, 'error'); }
  };

  const setStatus = async (t, status) => {
    try { await api.patch(`/orgchart/tasks/${t.id}`, { status }); load(); } catch (e) { toast(e.message, 'error'); }
  };

  const canStatus = (t) => can('task.edit') || t.assignee_id === user?.id;
  const rows = tab === 'all' ? items : items.filter((t) => t.status === tab);

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ fontSize: 20 }}>Tasks</h2>
        <div className="grow" />
        {can('task.assign') && <Button variant="primary" onClick={() => setModal(true)}>+ New Task</Button>}
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {rows.length === 0 ? <Card><Empty text="No tasks in this view" /></Card> : (
        <Card pad={false}>
          <div style={{ padding: '6px 18px' }}>
            {rows.map((t) => (
              <div key={t.id} className="flex between" style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="flex gap items-center">
                    <Badge tone={STATUS_TONES[t.status] || 'gray'}>{t.status.replace(/_/g, ' ')}</Badge>
                    <Badge tone={PRIORITY_TONES[t.priority] || 'gray'}>{t.priority}</Badge>
                    <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</b>
                  </div>
                  {t.description && <div className="small muted mt">{t.description.slice(0, 120)}</div>}
                  <div className="small muted mt">
                    {t.due_date ? `Due ${fmtDate(t.due_date)}` : 'No due date'} · {t.assignee_name ? `assigned to ${t.assignee_name}` : 'unassigned'} · by {t.assigner_name || '—'}
                  </div>
                </div>
                <div className="flex gap items-center" style={{ flexShrink: 0 }}>
                  {canStatus(t) && (
                    <Select value={t.status} onChange={(e) => setStatus(t, e.target.value)} style={{ width: 130 }}>
                      {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                    </Select>
                  )}
                  {can('task.assign') && (
                    <Select value={t.assignee_id || ''} onChange={(e) => reassign(t, e.target.value)} style={{ width: 150 }}>
                      <option value="">Unassigned</option>
                      {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </Select>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {modal && (
        <Modal title="New Task" onClose={() => setModal(false)} footer={<>
          <Button onClick={() => setModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={create} disabled={!form.title}>Create</Button>
        </>}>
          <div className="frm-grid">
            <Field label="Title" full><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Description" full><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <Field label="Due date"><Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
            <Field label="Priority"><Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</Select></Field>
            <Field label="Assign to"><Select value={form.assignee_id} onChange={(e) => setForm({ ...form, assignee_id: e.target.value })}><option value="">Unassigned</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
