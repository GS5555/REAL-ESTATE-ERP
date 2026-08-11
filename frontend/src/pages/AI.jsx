import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fmtMoney } from '../api';
import { Card, Badge, Button, Stat, DataTable, Empty, Field, Input, Select, Textarea, Modal, Tabs } from '../components/ui';
import { speak } from '../components/voice';

const SUGGESTIONS = [
  'How many leads do we have?',
  'What is our total sales?',
  'Top performing executive',
  'Pending payments / outstanding',
  'Home loan pipeline',
  'Referral performance'
];

export default function AI() {
  const nav = useNavigate();
  const [tab, setTab] = useState('insights');
  const [actions, setActions] = useState([]);
  const [forecast, setForecast] = useState(null);
  const [fw, setFw] = useState(null);
  const [analysis, setAnalysis] = useState([]);
  const [risk, setRisk] = useState([]);
  const [prod, setProd] = useState([]);
  const [gen, setGen] = useState(null);

  useEffect(() => {
    api.get('/next-best-action').then(setActions).catch(() => {});
    api.get('/forecast').then(setForecast).catch(() => {});
    api.get('/forecast/windows').then(setFw).catch(() => {});
    api.get('/exec-analysis').then(setAnalysis).catch(() => {});
    api.get('/risk').then((d) => setRisk(d.alerts || [])).catch(() => {});
    api.get('/productivity').then((d) => setProd(d.rows || [])).catch(() => {});
  }, []);

  const talk = (text) => speak(`Priority action: ${text}`, 'en-IN');

  const tabs = [
    { key: 'insights', label: 'Insights' },
    { key: 'chat', label: 'Ask AI' }
  ];

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ fontSize: 20 }}>AI Assistant <Badge tone="purple">Propease AI</Badge></h2>
        <div className="grow" />
        <Button onClick={() => talk('Your projected sales value is ' + fmtMoney(forecast?.projected || 0))}>🔊 Voice Briefing</Button>
      </div>
      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'chat' && <Chat onNavigate={(p) => nav(p)} />}

      {tab === 'insights' && <><div className="mt">
      {forecast && (
        <div className="grid c4 mb">
          <Stat label="Projected Sales Value" value={fmtMoney(forecast.projected)} color="var(--purple)" />
          <Stat label="Expected Bookings" value={forecast.expectedBookings} />
          <Stat label="90-day Revenue" value={fmtMoney(fw?.d90?.revenue || 0)} color="var(--green)" />
          <Stat label="90-day Bookings" value={fw?.d90?.bookings || 0} color="var(--brand)" />
        </div>
      )}

      <div className="grid c2">
        <Card>
          <h3 className="mb">AI Next Best Actions</h3>
          {actions.length === 0 ? <Empty text="No priority actions" /> : (
            <DataTable
              rows={actions.slice(0, 10)}
              onRowClick={(r) => nav(`/leads/${r.lead.id}`)}
              columns={[
                { key: 'lead', label: 'Lead', render: (r) => <div><b>{r.lead.name}</b><div className="small muted">{r.lead.phone}</div></div> },
                { key: 'score', label: 'Score', render: (r) => <Badge tone={r.score >= 70 ? 'green' : r.score >= 40 ? 'amber' : 'gray'}>{r.score}</Badge> },
                { key: 'suggestions', label: 'Suggested Action', render: (r) => <div><b>{r.suggestions[0]?.action}</b><div className="small muted">{r.suggestions[0]?.reason}</div></div> }
              ]}
            />
          )}
        </Card>

        <Card>
          <h3 className="mb">Lead Risk Alerts <Badge tone="red">{risk.length}</Badge></h3>
          {risk.length === 0 ? <Empty text="No leads at risk" /> : (
            <div>
              {risk.slice(0, 8).map((r, i) => (
                <div key={i} className="flex between items-center" style={{ padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <b onClick={() => nav(`/leads/${r.lead_id}`)} style={{ cursor: 'pointer' }}>{r.name}</b>
                    <div className="small muted">Inactive {r.last_activity_days}d · {r.priority}</div>
                    <div className="small" style={{ color: 'var(--amber)' }}>⚠ {r.action}</div>
                  </div>
                  <Badge tone={r.risk > 75 ? 'red' : 'amber'}>{r.risk}% risk</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <h3 className="mb">Executive Productivity Score</h3>
          {prod.length === 0 ? <Empty /> : (
            <DataTable
              rows={prod}
              columns={[
                { key: 'user', label: 'Executive' },
                { key: 'score', label: 'Score', render: (r) => <Badge tone={r.score >= 80 ? 'green' : r.score >= 60 ? 'blue' : r.score >= 40 ? 'amber' : 'red'}>{r.score}</Badge> },
                { key: 'grade', label: 'Grade', render: (r) => <b>{r.grade}</b> },
                { key: 'conversion', label: 'Conv %', render: (r) => <span>{r.conversion}%</span> },
                { key: 'followups_30d', label: 'Follow-ups' },
                { key: 'calls', label: 'Calls' },
                { key: 'visits', label: 'Visits' }
              ]}
            />
          )}
        </Card>

        <Card>
          <h3 className="mb">Executive Performance Coaching</h3>
          {analysis.length === 0 ? <Empty /> : (
            <div>
              {analysis.map((a, i) => (
                <div key={i} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                  <div className="flex between">
                    <b>{a.name}</b>
                    <Badge tone={a.level === 'Top performer' ? 'green' : a.level === 'On track' ? 'blue' : 'amber'}>{a.level}</Badge>
                  </div>
                  <div className="small muted">{a.conversion}% conversion · {a.visits} visits · {a.bookings} bookings</div>
                  <div className="small mt">💡 {a.tip}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="mt">
        <h3 className="mb">AI Content Generators</h3>
        <div className="grid c4" style={{ gap: 10 }}>
          {[
            ['whatsapp', 'WhatsApp Reply', '✆'],
            ['email', 'Follow-up Email', '✉'],
            ['summary', 'Meeting Summary', '☰'],
            ['sentiment', 'Sentiment Analysis', '❁']
          ].map(([kind, label, icon]) => (
            <Button key={kind} sm onClick={() => setGen({ kind, label })}> {icon} {label}</Button>
          ))}
        </div>
      </Card>
      </div>
      </>}
      {gen && <Generator kind={gen.kind} label={gen.label} onClose={() => setGen(null)} />}
    </div>
  );
}

function Chat({ onNavigate }) {
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
  }, [msgs]);

  const ask = async (q) => {
    const question = String(q || input).trim();
    if (!question || busy) return;
    setMsgs((m) => [...m, { role: 'user', text: question }]);
    setInput('');
    setBusy(true);
    try {
      const a = await api.post('/chat', { question });
      setMsgs((m) => [...m, { role: 'bot', text: a.text, bullets: a.bullets || [] }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'bot', text: e.message || 'Sorry, I could not answer that right now.' }]);
    }
    setBusy(false);
  };

  return (
    <Card className="mt">
      <h3 className="mb">Ask about your business</h3>
      <div
        ref={boxRef}
        style={{ height: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 10, background: '#fafbfd' }}
      >
        {msgs.length === 0 && (
          <div className="small muted" style={{ padding: 6 }}>
            Ask a question and I'll pull a live answer from your CRM data — leads, sales, finance, loans, campaigns, referrals and more.
            <div className="flex gap" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} className="btn ghost sm" onClick={() => ask(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
            <div style={{
              maxWidth: '82%', padding: '10px 14px', borderRadius: 12, fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap',
              background: m.role === 'user' ? 'var(--brand)' : '#fff', color: m.role === 'user' ? '#fff' : 'var(--text)',
              border: m.role === 'user' ? 'none' : '1px solid var(--border)'
            }}>
              <div>{m.text}</div>
              {m.bullets?.length > 0 && (
                <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                  {m.bullets.map((b, j) => <li key={j}>{b}</li>)}
                </ul>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="small muted" style={{ padding: 6 }}>Thinking…</div>}
      </div>
      <div className="flex gap" style={{ display: 'flex', gap: 8 }}>
        <Input
          value={input}
          placeholder="Ask anything about your business…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') ask(); }}
        />
        <Button variant="primary" disabled={busy} onClick={() => ask()}>Ask</Button>
      </div>
    </Card>
  );
}

function Generator({ kind, label, onClose }) {
  const [leadId, setLeadId] = useState('');
  const [notes, setNotes] = useState('');
  const [text, setText] = useState('');
  const [out, setOut] = useState(null);
  const [leads, setLeads] = useState([]);

  useEffect(() => { api.get('/leads', { limit: 20 }).then((d) => setLeads(d.items || [])).catch(() => {}); }, []);

  const run = async () => {
    if (kind === 'whatsapp' && leadId) setOut(await api.post('/whatsapp', { lead_id: leadId }));
    if (kind === 'email' && leadId) setOut(await api.post('/email', { lead_id: leadId }));
    if (kind === 'summary') setOut(await api.post('/summary', { notes }));
    if (kind === 'sentiment') setOut(await api.post('/sentiment', { text }));
  };

  return (
    <Modal title={label} onClose={onClose}>
      {kind !== 'summary' && kind !== 'sentiment' && (
        <Field label="Lead">
          <Select value={leadId} onChange={(e) => setLeadId(e.target.value)}>
            <option value="">Select lead…</option>
            {leads.map((l) => <option key={l.id} value={l.id}>{l.name} — {l.phone}</option>)}
          </Select>
        </Field>
      )}
      {kind === 'summary' && <Field label="Meeting notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder="Paste raw meeting / call notes…" /></Field>}
      {kind === 'sentiment' && <Field label="Conversation text"><Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Customer message or call transcript…" /></Field>}
      <Button sm onClick={run} style={{ margin: '10px 0' }}>Generate</Button>
      {out && (
        <div className="ai-out">
          {out.text && <p>{out.text}</p>}
          {out.subject && <p><b>{out.subject}</b></p>}
          {out.body && <pre>{out.body}</pre>}
          {out.title && <div><h4>{out.title}</h4><ul>{(out.keyPoints || []).map((k, i) => <li key={i}>{k}</li>)}</ul><div className="small">Action items: {(out.actionItems || []).join(' · ')}</div></div>}
          {out.label && <div>Sentiment: <Badge tone={out.label === 'positive' ? 'green' : out.label === 'negative' ? 'red' : 'amber'}>{out.label}</Badge> (score {out.score}, confidence {Math.round(out.confidence * 100)}%)</div>}
          {out.queued && <div className="small muted">Queued for offline sync.</div>}
        </div>
      )}
    </Modal>
  );
}
