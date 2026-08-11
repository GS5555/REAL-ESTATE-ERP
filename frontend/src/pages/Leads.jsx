import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../store';
import { api, fmtMoney, fmtDate } from '../api';
import { Card, Button, Badge, DataTable, Modal, Field, Input, Select, Textarea, Avatar, Empty } from '../components/ui';
import { PriorityTone } from '../components/ui';
import { VoiceInput } from '../components/voice';

const STAGE_LABELS = {
  new_lead: 'New Lead', contacted: 'Contacted', interested: 'Interested', site_visit_scheduled: 'Site Visit Scheduled',
  site_visit_completed: 'Site Visit Completed', negotiation: 'Negotiation', booking: 'Booking', payment: 'Payment',
  registered: 'Registered', won: 'Won', lost: 'Lost', cancelled: 'Cancelled'
};

const SOURCES = ['99acres', 'MagicBricks', 'Housing.com', 'Facebook', 'Instagram', 'Google Ads', 'Google Forms', 'Website', 'Landing Page', 'WhatsApp', 'Email', 'Call Tracking', 'Justdial', 'IndiaMART', 'TradeIndia', 'Property Portal', 'Manual', 'CSV Import', 'Excel Import', 'API', 'Channel Partner', 'Referral', 'Walk-in'];
const PRIORITIES = ['Hot', 'Warm', 'Cold', 'Lost', 'Junk'];
const FILTERS = ['', 'new_lead', 'contacted', 'interested', 'site_visit_scheduled', 'site_visit_completed', 'negotiation', 'booking', 'payment', 'registered', 'won', 'lost'];

export default function Leads() {
  const { can } = useStore();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState(searchParams.get('q') || '');
  const [status, setStatus] = useState(searchParams.get('status') || '');
  const [source, setSource] = useState(searchParams.get('source') || '');
  const [priority, setPriority] = useState(searchParams.get('priority') || '');
  const [owner, setOwner] = useState(searchParams.get('owner') || '');
  const [project, setProject] = useState(searchParams.get('project') || '');
  const [city, setCity] = useState(searchParams.get('city') || '');
  const [area, setArea] = useState(searchParams.get('area') || '');
  const [campaign, setCampaign] = useState(searchParams.get('campaign') || '');
  const [from, setFrom] = useState(searchParams.get('from') || '');
  const [to, setTo] = useState(searchParams.get('to') || '');
  const [modal, setModal] = useState(false);
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [form, setForm] = useState({});
  const [dupWarn, setDupWarn] = useState([]);
  const [page, setPage] = useState(parseInt(searchParams.get('page') || '1', 10));

  const applyFilters = (next) => {
    const p = { q, status, source, priority, owner, project, city, area, campaign, from, to, page, ...next };
    setSearchParams(Object.fromEntries(Object.entries(p).filter(([, v]) => v !== '' && v != null)));
  };

  const load = () => {
    api.get('/leads', { q, status, source, priority, owner_id: owner, project, city, area, campaign, from, to, page, limit: 25 }).then((d) => { setItems(d.items); setTotal(d.total); }).catch(() => {});
  };
  useEffect(() => { load(); }, [q, status, source, priority, owner, project, city, area, campaign, from, to, page]);
  useEffect(() => {
    api.get('/users').then((u) => setUsers(u.filter((x) => x.active && ['sales_executive', 'telecaller', 'team_leader', 'sales_manager', 'channel_partner'].includes(x.role)))).catch(() => {});
    api.get('/projects').then(setProjects).catch(() => {});
  }, []);

  const submitLead = async () => {
    if (!form.name || !form.phone) return;
    try {
      const r = await api.post('/leads', { ...form, autoMerge: false });
      setModal(false); setForm({}); setDupWarn([]);
      load();
      if (r.duplicates?.length) {
        setDupWarn(r.duplicates);
        window.scrollTo(0, 0);
      }
    } catch (e) { alert(e.message); }
  };

  const importCsv = (file) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const text = reader.result;
      const lines = text.split('\n').filter((l) => l.trim());
      const rows = lines.slice(1).map((l) => {
        const c = l.split(',').map((x) => x.replace(/^"|"$/g, '').trim());
        return { name: c[0] || '', phone: c[1] || '', email: c[2] || '', city: c[3] || '', source: 'CSV Import' };
      }).filter((r) => r.name);
      await api.post('/leads/import', { rows });
      load();
    };
    reader.readAsText(file);
  };

  return (
    <div>
      {dupWarn.length > 0 && (
        <div className="card mb" style={{ borderColor: 'var(--amber)' }}>
          <div style={{ padding: 14 }}>
            <b>Duplicate leads detected</b>
            <div className="small muted mb">These may already exist. Open the lead to merge.</div>
            {dupWarn.map((d, i) => (
              <div key={i} className="small">{d.lead.name} · {d.lead.phone} — match {d.match_score}% ({d.reason})</div>
            ))}
            <Button className="mt" variant="ghost" sm onClick={() => setDupWarn([])}>Dismiss</Button>
          </div>
        </div>
      )}

      <div className="toolbar">
        {can('lead.create') && <Button variant="primary" onClick={() => setModal(true)}>+ New Lead</Button>}
        {can('lead.import') && (
          <>
            <label className="btn">↑ Import CSV<input type="file" accept=".csv" style={{ display: 'none' }} onChange={(e) => importCsv(e.target.files[0])} /></label>
          </>
        )}
        {can('lead.export') && <Button onClick={() => api.download('/leads/export/csv', { q, status, source, priority, owner_id: owner, project, city, area, campaign, from, to }).catch(() => {})}>⤓ Export</Button>}
        {can('lead.export') && <Button onClick={() => api.shareFile('/leads/export/csv', { q, status, source, priority, owner_id: owner, project, city, area, campaign, from, to }, 'Leads Export').catch(() => {})}>Share</Button>}
        <div className="grow" />
        <Input className="search-input" placeholder="Search name / phone / email…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All stages</option>
          {FILTERS.filter(Boolean).map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
        </Select>
        <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">All priority</option>
          <option>Hot</option><option>Warm</option><option>Cold</option>
        </Select>
        <Select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">All sources</option>
          {SOURCES.map((s) => <option key={s}>{s}</option>)}
        </Select>
        <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">All owners</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
        <Select value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
        </Select>
        <Input type="date" title="From date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" title="To date" value={to} onChange={(e) => setTo(e.target.value)} />
        {(source || priority || owner || project || city || area || campaign || from || to) && <Button sm variant="ghost" onClick={() => { setSource(''); setPriority(''); setOwner(''); setProject(''); setCity(''); setArea(''); setCampaign(''); setFrom(''); setTo(''); setPage(1); }}>✕ Clear</Button>}
      </div>
      {(source || priority || owner || project || city || area || campaign || from || to) && (
        <div className="small muted mb">
          Showing: {source ? `Source = ${source}` : ''}{priority ? ` · ${priority}` : ''}{project ? ` · Project = ${project}` : ''}{campaign ? ` · Campaign = ${campaign}` : ''}{city ? ` · ${city}` : ''}{area ? ` / ${area}` : ''}{owner ? ' · filtered by owner' : ''}{from || to ? ` · ${from || '…'} → ${to || '…'}` : ''} · {total} leads
          <button className="btn ghost sm" style={{ marginLeft: 8 }} onClick={() => { setSource(''); setPriority(''); setOwner(''); setProject(''); setCity(''); setArea(''); setCampaign(''); setFrom(''); setTo(''); setPage(1); }}>Clear all</button>
        </div>
      )}

      <Card pad={false}>
        {items.length === 0 ? <Empty text="No leads found" /> : (
          <DataTable
            rows={items}
            onRowClick={(r) => nav(`/leads/${r.id}`)}
            columns={[
              { key: 'name', label: 'Lead', render: (r) => (
                <div>
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  <div className="small muted">{r.phone || '—'}</div>
                </div>
              ) },
              { key: 'source', label: 'Source', render: (r) => <button className="btn ghost sm" title={`Show all ${r.source} leads`} onClick={(e) => { e.stopPropagation(); setSource(r.source); setPage(1); }}><Badge tone="brand">{r.source}</Badge></button> },
              { key: 'priority', label: 'Priority', render: (r) => <Badge tone={PriorityTone[r.priority] || 'gray'}>{r.priority}</Badge> },
              { key: 'status', label: 'Stage', render: (r) => STAGE_LABELS[r.status] },
              { key: 'budget', label: 'Budget', render: (r) => fmtMoney(r.budget) },
              { key: 'score', label: 'Score', render: (r) => <div className="flex items-center gap"><div className="bar" style={{ width: 60 }}><div style={{ width: `${r.score}%` }} /></div><span className="small">{r.score}</span></div> },
              { key: 'owner_id', label: 'Owner', render: (r) => r.owner_id ? <Avatar name={users.find((u) => u.id === r.owner_id)?.name || '?'} /> : '—' },
              { key: 'updated_at', label: 'Updated', render: (r) => fmtDate(r.updated_at) }
            ]}
          />
        )}
      </Card>
      <div className="flex between mt small">
        <span className="muted">{total} leads</span>
        <div className="flex gap">
          <Button sm disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</Button>
          <Button sm disabled={items.length < 25} onClick={() => setPage(page + 1)}>Next →</Button>
        </div>
      </div>

      {modal && (
        <Modal title="New Lead" onClose={() => setModal(false)} footer={<>
          <Button onClick={() => setModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={submitLead} disabled={!form.name || !form.phone}>Save Lead</Button>
        </>}>
          <div className="frm-grid">
            <Field label="Full Name"><Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Phone"><Input value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91…" /></Field>
            <Field label="Email"><Input value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Source"><Select value={form.source || 'Manual'} onChange={(e) => setForm({ ...form, source: e.target.value })}>{SOURCES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
            <Field label="Priority"><Select value={form.priority || 'Warm'} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{PRIORITIES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
            <Field label="Project"><Select value={form.project_id || ''} onChange={(e) => setForm({ ...form, project_id: e.target.value })}><option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
            <Field label="City"><Input value={form.city || ''} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
            <Field label="Area"><Input value={form.area || ''} onChange={(e) => setForm({ ...form, area: e.target.value })} /></Field>
            <Field label="Budget (₹)"><Input type="number" value={form.budget || ''} onChange={(e) => setForm({ ...form, budget: e.target.value })} /></Field>
            <Field label="Assign to (optional)"><Select value={form.owner_id || ''} onChange={(e) => setForm({ ...form, owner_id: e.target.value })}><option value="">Auto-assign</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
            <Field label="Requirement" full><Textarea value={form.requirement || ''} onChange={(e) => setForm({ ...form, requirement: e.target.value })} /></Field>
            <Field label="Voice note (dictation)" full>
              <div className="flex gap">
                <VoiceInput onText={(t) => setForm({ ...form, notes: (form.notes ? form.notes + ' ' : '') + t })} />
                <Input placeholder="…or type notes" value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
