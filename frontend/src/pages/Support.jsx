import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { api, fmtDateTime } from '../api';
import { Card, Button, Badge, DataTable, Field, Input, Select, Textarea, Empty } from '../components/ui';
import { useToast } from '../components/ui';

export default function Support() {
  const { user } = useStore();
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ subject: '', body: '', priority: 'normal', type: 'bug' });

  const load = () => api.get('/tickets').then(setItems).catch(() => {});
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!form.subject) return toast('Subject required', 'error');
    await api.post('/tickets', form);
    setForm({ subject: '', body: '', priority: 'normal', type: 'bug' });
    load(); toast('Ticket raised — developer notified', 'success');
  };

  const priorities = { low: 'blue', normal: 'amber', high: 'red', urgent: 'red' };

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ fontSize: 20 }}>Support & Tickets</h2>
        <div className="grow" />
      </div>
      <div className="grid c2">
        <Card>
          <h3 className="mb">Raise a Ticket</h3>
          <Field label="Subject"><Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></Field>
          <Field label="Description / Steps to reproduce"><Textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field>
          <div className="frm-grid">
            <Field label="Type"><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="bug">Bug Report</option><option value="feature">Feature Request</option><option value="support">Question</option></Select></Field>
            <Field label="Priority"><Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option>low</option><option>normal</option><option>high</option><option>urgent</option></Select></Field>
          </div>
          <Button variant="primary" onClick={submit}>Submit Ticket</Button>
        </Card>
        <Card pad={false}>
          <div style={{ padding: 16, fontWeight: 600, borderBottom: '1px solid var(--border)' }}>My Tickets ({items.length})</div>
          {items.length === 0 ? <Empty text="No tickets yet" /> : (
            <div style={{ padding: '0 16px' }}>
              {items.map((t) => (
                <div key={t.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                  <div className="flex between">
                    <b>{t.subject}</b>
                    <Badge tone={priorities[t.priority] || 'gray'}>{t.priority}</Badge>
                  </div>
                  <div className="small muted">{t.body?.slice(0, 80)}</div>
                  <div className="small mt">
                    <Badge tone={t.status === 'open' ? 'red' : t.status === 'resolved' ? 'green' : 'amber'}>{t.status}</Badge>
                    <span className="muted"> · {fmtDateTime(t.created_at)}</span>
                  </div>
                  {t.developer_notes && <div className="small card mt" style={{ background: '#f8fafc', padding: 8 }}>Dev note: {t.developer_notes}</div>}
                  {t.resolution && <div className="small mt" style={{ color: 'var(--green)' }}>✓ {t.resolution}</div>}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
