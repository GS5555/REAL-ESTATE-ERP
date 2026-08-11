import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { api, fmtMoney, fmtDateTime, fmtDate } from '../api';
import { Card, Badge, Button, DataTable, Field, Input, Select, Textarea, Modal, Avatar } from '../components/ui';
import { VoiceInput } from '../components/voice';

const ACTIVITY_TYPES = ['call', 'whatsapp', 'email', 'meeting', 'note', 'voice', 'task', 'sms', 'negotiation', 'booking'];

export default function LeadDetail() {
  const { id } = useParams();
  const { user, can } = useStore();
  const nav = useNavigate();
  const [d, setD] = useState(null);
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [actModal, setActModal] = useState(false);
  const [actForm, setActForm] = useState({ type: 'call', subject: '', note: '', scheduled_at: '', direction: 'outbound' });
  const [visitModal, setVisitModal] = useState(false);
  const [visitDate, setVisitDate] = useState('');
  const [assignModal, setAssignModal] = useState(false);
  const [stages, setStages] = useState([]);
  const [messages, setMessages] = useState([]);
  const [msgModal, setMsgModal] = useState(false);
  const [msgForm, setMsgForm] = useState({ channel: 'whatsapp', body: '', direction: 'outbound' });
  const [genKind, setGenKind] = useState(null);
  const [aiOut, setAiOut] = useState(null);

  const load = () => api.get(`/leads/${id}`).then(setD).catch((e) => { if (e.status === 403) nav('/leads'); });
  useEffect(() => { load(); }, [id]);
  useEffect(() => {
    api.get('/users').then(setUsers).catch(() => {});
    api.get('/projects').then(setProjects).catch(() => {});
    api.get('/pipeline-stages').then((d) => setStages(d.items || d || [])).catch(() => {});
    api.get(`/leads/${id}/messages`).then((d) => setMessages(d.items || [])).catch(() => {});
  }, [id]);

  if (!d) return <div className="empty">Loading…</div>;
  const { lead, activities, visits, suggestions, duplicates } = d;

  const saveStage = async (status) => {
    await api.patch(`/leads/${id}`, { status });
    load();
  };

  const addActivity = async () => {
    if (!actForm.subject && !actForm.note) return;
    await api.post('/activities', { lead_id: id, ...actForm, user_id: user.id });
    setActModal(false); setActForm({ type: 'call', subject: '', note: '', scheduled_at: '' });
    load();
  };

  const scheduleVisit = async () => {
    await api.post('/activities/site-visits', { lead_id: id, project_id: lead.project_id, scheduled_at: new Date(visitDate).toISOString() });
    setVisitModal(false); setVisitDate('');
    load();
  };

  const doAssign = async (owner_id) => {
    await api.post(`/leads/${id}/assign`, { owner_id });
    setAssignModal(false); load();
  };

  const merge = async (withId) => {
    if (!confirm('Merge this lead into the duplicate?')) return;
    await api.post(`/leads/${id}/merge`, { with: withId });
    nav('/leads');
  };

  const convert = async () => {
    try {
      const r = await api.post('/customers', { lead_id: id, name: lead.name, phone: lead.phone, email: lead.email, address: lead.address });
      if (r && r.id) { nav(`/customers/${r.id}`); return; }
      load();
    } catch (e) { alert(e.message || 'Conversion failed'); }
  };

  const sendMessage = async () => {
    if (!msgForm.body) return;
    await api.post(`/leads/${id}/messages`, msgForm);
    setMsgModal(false); setMsgForm({ channel: 'whatsapp', body: '', direction: 'outbound' });
    api.get(`/leads/${id}/messages`).then((d) => setMessages(d.items || []));
  };

  const generate = async (kind) => {
    setGenKind(kind); setAiOut(null);
    const r = await api.post('/' + kind, { lead_id: id });
    setAiOut(r);
    if (r.text && !r.queued) {
      setMsgForm((f) => ({ ...f, body: r.text, channel: kind === 'email' ? 'email' : 'whatsapp' }));
    }
  };

  return (
    <div>
      <div className="toolbar">
        <Button onClick={() => nav('/leads')}>← Leads</Button>
        <div className="grow" />
        {can('lead.transfer') && <Button onClick={() => setAssignModal(true)}>⇄ Assign / Transfer</Button>}
        {can('activity.create') && <Button onClick={() => setActModal(true)}>+ Log Activity</Button>}
        {can('activity.create') && <Button onClick={() => setMsgModal(true)}>✆ Send Message</Button>}
        {can('activity.create') && <Button variant="primary" onClick={() => setVisitModal(true)}>📅 Schedule Site Visit</Button>}
        {can('loan.create') && <Button variant="success" onClick={() => nav(`/loans?convertLead=${id}`)}>🏦 Pass to Home Loan</Button>}
        {can('customer.create') && <Button variant="success" onClick={convert}>→ Convert to Customer</Button>}
      </div>

      <div className="grid c2">
        <Card>
          <div className="flex between">
            <div>
              <h2 style={{ fontSize: 20 }}>{lead.name}</h2>
              <div className="muted">{lead.phone} · {lead.email || 'no email'}</div>
            </div>
            <div className="flex gap">
              <Badge tone={lead.priority === 'Hot' ? 'red' : lead.priority === 'Warm' ? 'amber' : 'blue'}>{lead.priority}</Badge>
              <Badge tone="brand">{lead.source}</Badge>
            </div>
          </div>
          <div className="mt">
            <dl className="kv">
              <dt>Stage</dt><dd>
                <select className="select" style={{ width: 'auto' }} value={lead.status} onChange={(e) => saveStage(e.target.value)}>
                  {(stages.length ? stages : [{ key: lead.status, label: lead.status }]).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </dd>
              <dt>Budget</dt><dd>{fmtMoney(lead.budget)}</dd>
              <dt>City / Area</dt><dd>{lead.city} / {lead.area || '—'}</dd>
              <dt>Project</dt><dd>{projects.find((p) => p.id === lead.project_id)?.name || '—'}</dd>
              <dt>Requirement</dt><dd>{lead.requirement || '—'}</dd>
              <dt>Owner</dt><dd>{users.find((u) => u.id === lead.owner_id)?.name || 'Unassigned'}</dd>
              <dt>AI Score</dt><dd><div className="flex items-center gap"><div className="bar" style={{ width: 120 }}><div style={{ width: `${lead.score}%` }} /></div><b>{lead.score}/100</b></div></dd>
            </dl>
            {lead.notes && <div className="card mt" style={{ background: '#f8fafc' }}><div className="small">{lead.notes}</div></div>}
          </div>
        </Card>

        <Card>
          <h3 className="mb">AI Suggestions</h3>
          {(suggestions || []).length ? (
            <div>
              {(suggestions || []).map((s, i) => (
                <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{s.action} <Badge tone="amber">{s.due}</Badge></div>
                  <div className="small muted">{s.reason}</div>
                </div>
              ))}
            </div>
          ) : <div className="empty">No suggestions right now</div>}

          {duplicates?.length > 0 && (
            <div className="mt">
              <h4 style={{ color: 'var(--red)' }}>Duplicate matches</h4>
              {duplicates.map((dup, i) => (
                <div key={i} className="flex between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <span className="small">{dup.lead.name} · {dup.lead.phone} — {dup.match_score}% ({dup.reason})</span>
                  {can('lead.merge') && <Button sm onClick={() => merge(dup.lead.id)}>Merge here</Button>}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid c2 mt">
        <Card>
          <h3 className="mb">Activity Timeline</h3>
          {activities.length ? (
            <div className="timeline">
              {activities.map((a) => (
                <div className="tl-item" key={a.id}>
                  <div className="flex between">
                    <b style={{ fontSize: 13 }}>{a.type.toUpperCase()} {a.subject && <span style={{ fontWeight: 400 }}>— {a.subject}</span>}</b>
                    <span className="small muted">{fmtDateTime(a.created_at)}</span>
                  </div>
                  {a.note && <div className="small muted">{a.note}</div>}
                  {a.scheduled_at && !a.done_at && <div className="small" style={{ color: 'var(--amber)' }}>⏰ Follow-up due {fmtDateTime(a.scheduled_at)}</div>}
                </div>
              ))}
            </div>
          ) : <div className="empty">No activities yet</div>}
        </Card>

        <Card>
          <h3 className="mb">Site Visits</h3>
          {visits.length ? (
            <DataTable
              rows={visits}
              columns={[
                { key: 'scheduled_at', label: 'Scheduled', render: (r) => fmtDateTime(r.scheduled_at) },
                { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'verified' ? 'green' : r.status === 'done' ? 'blue' : 'amber'}>{r.status}</Badge> },
                { key: 'checkin_at', label: 'Check-in', render: (r) => r.checkin_at ? fmtDateTime(r.checkin_at) : '—' },
                { key: 'feedback', label: 'Feedback', render: (r) => r.feedback || '—' }
              ]}
            />
          ) : <div className="empty">No site visits scheduled</div>}
        </Card>
      </div>

      <div className="grid c2 mt">
        <Card>
          <div className="flex between mb">
            <h3>Messages (WhatsApp / Email)</h3>
            <div className="flex gap">
              <Button sm onClick={() => generate('whatsapp')}>✨ AI WhatsApp</Button>
              <Button sm onClick={() => generate('email')}>✉ AI Email</Button>
            </div>
          </div>
          {aiOut && (
            <div className="card mb" style={{ background: '#f5f3ff' }}>
              {aiOut.text && <p className="small">{aiOut.text}</p>}
              {aiOut.subject && <p className="small"><b>{aiOut.subject}</b></p>}
              {aiOut.body && <pre className="small" style={{ whiteSpace: 'pre-wrap' }}>{aiOut.body}</pre>}
              {aiOut.queued && <div className="small muted">Queued for offline sync.</div>}
            </div>
          )}
          {messages.length ? (
            <div className="timeline">
              {messages.map((m) => (
                <div className="tl-item" key={m.id}>
                  <div className="flex between">
                    <b style={{ fontSize: 13 }}>{m.channel.toUpperCase()} <Badge tone={m.direction === 'outbound' ? 'blue' : 'amber'}>{m.direction}</Badge></b>
                    <span className="small muted">{fmtDateTime(m.created_at)}</span>
                  </div>
                  <div className="small">{m.body}</div>
                </div>
              ))}
            </div>
          ) : <div className="empty">No messages yet — use AI to draft one above</div>}
        </Card>
      </div>

      {actModal && (
        <Modal title="Log Activity" onClose={() => setActModal(false)} footer={<>
          <Button onClick={() => setActModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={addActivity}>Save Activity</Button>
        </>}>
          <div className="frm-grid">
            <Field label="Type"><Select value={actForm.type} onChange={(e) => setActForm({ ...actForm, type: e.target.value })}>{ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
            <Field label="Direction"><Select value={actForm.direction} onChange={(e) => setActForm({ ...actForm, direction: e.target.value })}><option>outbound</option><option>inbound</option></Select></Field>
            <Field label="Subject" full><Input value={actForm.subject} onChange={(e) => setActForm({ ...actForm, subject: e.target.value })} placeholder="e.g. Follow-up call, Quote sent" /></Field>
            <Field label="Notes / Dictate" full>
              <div className="flex gap mb">
                <VoiceInput onText={(t) => setActForm({ ...actForm, note: (actForm.note || '') + ' ' + t })} />
              </div>
              <Textarea value={actForm.note} onChange={(e) => setActForm({ ...actForm, note: e.target.value })} placeholder="Call summary, outcome…" />
            </Field>
            <Field label="Schedule follow-up (optional)" full><Input type="datetime-local" value={actForm.scheduled_at} onChange={(e) => setActForm({ ...actForm, scheduled_at: e.target.value })} /></Field>
          </div>
        </Modal>
      )}

      {visitModal && (
        <Modal title="Schedule Site Visit" onClose={() => setVisitModal(false)} footer={<>
          <Button onClick={() => setVisitModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={scheduleVisit}>Schedule</Button>
        </>}>
          <Field label="Date & Time"><Input type="datetime-local" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} /></Field>
        </Modal>
      )}

      {assignModal && (
        <Modal title="Assign / Transfer Lead" onClose={() => setAssignModal(false)} footer={<>
          <Button onClick={() => doAssign('')} disabled={!can('lead.transfer')}>Auto-assign</Button>
        </>}>
          <div style={{ display: 'grid', gap: 8 }}>
            {users.filter((u) => ['sales_executive', 'telecaller', 'team_leader', 'sales_manager'].includes(u.role)).map((u) => (
              <button key={u.id} className="btn between" style={{ justifyContent: 'space-between' }} onClick={() => doAssign(u.id)}>
                <span className="flex items-center gap"><Avatar name={u.name} /> {u.name}</span>
                <Badge tone="blue">{u.role.replace(/_/g, ' ')}</Badge>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {msgModal && (
        <Modal title="Send Message" onClose={() => setMsgModal(false)} footer={<>
          <Button onClick={() => setMsgModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={sendMessage}>Send</Button>
        </>}>
          <div className="frm-grid">
            <Field label="Channel"><Select value={msgForm.channel} onChange={(e) => setMsgForm({ ...msgForm, channel: e.target.value })}><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="sms">SMS</option></Select></Field>
            <Field label="Direction"><Select value={msgForm.direction} onChange={(e) => setMsgForm({ ...msgForm, direction: e.target.value })}><option>outbound</option><option>inbound</option></Select></Field>
            <Field label="Message" full><Textarea rows={4} value={msgForm.body} onChange={(e) => setMsgForm({ ...msgForm, body: e.target.value })} placeholder="Type message or use AI draft above…" /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
