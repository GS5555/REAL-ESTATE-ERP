import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { api, fmtMoney } from '../api';
import { Card, Badge, Button, Modal, Field, Input, Select } from '../components/ui';

const TONE = { gray: '#94a3b8', blue: '#3b82f6', brand: '#2563eb', amber: '#f59e0b', green: '#16a34a', red: '#ef4444' };

export default function Pipeline() {
  const nav = useNavigate();
  const { can } = useStore();
  const [stages, setStages] = useState([]);
  const [labels, setLabels] = useState({});
  const [groups, setGroups] = useState({});
  const [counts, setCounts] = useState({});
  const [mgr, setMgr] = useState(false);

  const load = () => {
    api.get('/pipeline-stages').then((d) => setStages(d.stages));
    api.get('/leads/pipeline').then((d) => { setLabels(d.labels); setGroups(d.groups); setCounts(d.counts); }).catch(() => {});
  };
  useEffect(() => { load(); setMgr(can('pipeline.manage')); }, []);

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ fontSize: 20 }}>Sales Pipeline</h2>
        <div className="grow" />
        {mgr && <StageManager stages={stages} onDone={load} />}
        <Button onClick={() => nav('/leads')}>View List</Button>
      </div>
      <div className="kanban">
        {stages.map((s) => (
          <div className="kcol" key={s.key}>
            <div className="khead" style={{ borderTop: `3px solid ${s.color || '#94a3b8'}` }}>
              <span>{s.label}</span>
              <button className="btn ghost sm" style={{ padding: '1px 8px' }} title={`View ${s.label} leads`} onClick={() => nav(`/leads?status=${encodeURIComponent(s.key)}`)}>
                <span className="kcount">{counts[s.key] || 0}</span>
              </button>
            </div>
            {(groups[s.key] || []).map((lead) => (
              <div className="kcard" key={lead.id} onClick={() => nav(`/leads/${lead.id}`)}>
                <div className="kname">{lead.name}</div>
                <div className="kmeta">
                  <Badge tone="gray">{labels[lead.status] || lead.status}</Badge>
                  {lead.source && <span>via {lead.source}</span>}
                </div>
                <div className="kmeta">
                  <span>{fmtMoney(lead.budget)}</span>
                  {lead.owner && <span>· {lead.owner}</span>}
                </div>
              </div>
            ))}
            {!groups[s.key]?.length && <div className="small muted" style={{ padding: '6px 4px' }}>Empty</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function StageManager({ stages, onDone }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ key: '', label: '', color: '#94a3b8' });
  const [dragIdx, setDragIdx] = useState(null);

  const save = async () => {
    if (!form.key || !form.label) return;
    await api.post('/pipeline-stages', form);
    setForm({ key: '', label: '', color: '#94a3b8' });
    onDone();
  };
  const del = async (key) => {
    if (!confirm('Delete stage? Leads in this stage move to New Lead.')) return;
    await api.del(`/pipeline-stages/${key}`);
    onDone();
  };
  const move = (from, to) => {
    const arr = [...stages];
    const [x] = arr.splice(from, 1);
    arr.splice(to, 0, x);
    setDragIdx(null);
    api.put('/pipeline-stages/order', { order: arr.map((s) => s.key) }).then(onDone);
  };
  const onDrop = (i) => { if (dragIdx !== null && dragIdx !== i) move(dragIdx, i); setDragIdx(null); };

  return (
    <>
      <Button sm onClick={() => setOpen(true)}>Manage Stages</Button>
      {open && (
        <Modal title="Customize Pipeline Stages" onClose={() => setOpen(false)}>
          <div className="mb" style={{ fontSize: 13, color: 'var(--muted)' }}>Drag rows to reorder. Add, rename or remove stages to match your sales process.</div>
          {stages.map((s, i) => (
            <div key={s.key} draggable onDragStart={() => setDragIdx(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => onDrop(i)}
              className="flex between items-center" style={{ padding: '9px 4px', borderBottom: '1px solid var(--border)', cursor: 'grab' }}>
              <div className="flex items-center gap">
                <span style={{ width: 12, height: 12, borderRadius: 3, background: s.color }} />
                <b>{s.label}</b>
                <span className="small muted">({s.key})</span>
                {s.is_win && <Badge tone="green">WIN</Badge>}
                {s.is_lost && <Badge tone="red">LOST</Badge>}
              </div>
              {!s.is_win && !s.is_lost && <button className="btn ghost sm" onClick={() => del(s.key)}>✕</button>}
            </div>
          ))}
          <div style={{ padding: '12px 0' }}>
            <div className="grid c3">
              <Field label="Key"><Input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} placeholder="e.g. demo_done" /></Field>
              <Field label="Label"><Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Demo Completed" /></Field>
              <Field label="Color"><Input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} /></Field>
            </div>
            <Button sm onClick={save} style={{ marginTop: 8 }}>+ Add Stage</Button>
          </div>
        </Modal>
      )}
    </>
  );
}
