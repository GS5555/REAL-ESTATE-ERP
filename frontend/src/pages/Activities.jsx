import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { api, fmtDateTime } from '../api';
import { Card, Badge, Button, Field, Input, Select, Textarea, Empty } from '../components/ui';
import { VoiceInput } from '../components/voice';
import { useToast } from '../components/ui';

const TYPE_TONES = { call: 'blue', whatsapp: 'green', email: 'purple', meeting: 'brand', note: 'gray', voice: 'amber', task: 'red', sms: 'blue', negotiation: 'amber', booking: 'green' };

export default function Activities() {
  const { user, can } = useStore();
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [dueOnly, setDueOnly] = useState(false);
  const [mode, setMode] = useState('');
  const [owner, setOwner] = useState('');
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ type: 'call', subject: '', note: '', scheduled_at: '', direction: 'outbound', user_id: user?.id });
  const [showForm, setShowForm] = useState(false);

  const load = () => api.get('/activities', { due: dueOnly ? 'yes' : '', mode, user_id: owner }).then(setItems).catch(() => {});
  useEffect(() => { load(); }, [dueOnly, mode, owner]);
  useEffect(() => { api.get('/users').then(setUsers).catch(() => {}); }, []);

  const add = async () => {
    if (!form.subject && !form.note) return toast('Add a subject or note', 'error');
    await api.post('/activities', form);
    setForm({ type: 'call', subject: '', note: '', scheduled_at: '', direction: 'outbound', user_id: user?.id });
    setShowForm(false); load(); toast('Activity logged', 'success');
  };

  const complete = async (a) => {
    await api.patch(`/activities/${a.id}`, { done: true });
    load();
  };

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ fontSize: 20 }}>Activities & Follow-ups</h2>
        <div className="grow" />
        {can('activity.create') && <Button variant="primary" onClick={() => setShowForm(!showForm)}>+ Log Activity</Button>}
        <Select value={mode} onChange={(e) => setMode(e.target.value)} style={{ width: 130 }}>
          <option value="">All modes</option>
          {['call', 'whatsapp', 'email', 'meeting', 'note', 'voice', 'task', 'sms', 'negotiation', 'booking'].map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
        <Select value={owner} onChange={(e) => setOwner(e.target.value)} style={{ width: 150 }}>
          <option value="">All users</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
        <Button onClick={() => setDueOnly(!dueOnly)}>{dueOnly ? 'Showing: due only' : 'Show all'}</Button>
      </div>

      {showForm && (
        <Card className="mb">
          <div className="frm-grid">
            <Field label="Type"><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{['call', 'whatsapp', 'email', 'meeting', 'note', 'voice', 'task', 'sms', 'negotiation', 'booking'].map((t) => <option key={t}>{t}</option>)}</Select></Field>
            <Field label="Direction"><Select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}><option>outbound</option><option>inbound</option></Select></Field>
            <Field label="Subject" full><Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="e.g. Follow-up call" /></Field>
            <Field label="Notes" full>
              <div className="flex gap mb"><VoiceInput onText={(t) => setForm({ ...form, note: (form.note || '') + ' ' + t })} /></div>
              <Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </Field>
            <Field label="Schedule follow-up (optional)"><Input type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} /></Field>
            <div className="flex items-center gap" style={{ alignItems: 'flex-end' }}>
              <Button variant="primary" onClick={add}>Save</Button>
              <Button onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </div>
        </Card>
      )}

      <Card pad={false}>
        {items.length === 0 ? <Empty /> : (
          <div style={{ padding: '6px 18px' }}>
            {items.map((a) => (
              <div key={a.id} className="flex between" style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div className="flex gap items-center">
                    <Badge tone={TYPE_TONES[a.type] || 'gray'}>{a.type}</Badge>
                    <b>{a.subject || a.note?.slice(0, 40) || a.type}</b>
                    {a.lead_name && <span className="small muted">· {a.lead_name}</span>}
                  </div>
                  {a.note && a.subject && <div className="small muted mt">{a.note.slice(0, 90)}</div>}
                  <div className="small muted mt">
                    {a.done_at ? `✓ done ${fmtDateTime(a.done_at)}` : a.scheduled_at ? `⏰ due ${fmtDateTime(a.scheduled_at)}` : fmtDateTime(a.created_at)}
                    {a.user_name ? ` · by ${a.user_name}` : ''}
                  </div>
                </div>
                {!a.done_at && <Button sm variant="success" onClick={() => complete(a)}>Mark Done</Button>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
