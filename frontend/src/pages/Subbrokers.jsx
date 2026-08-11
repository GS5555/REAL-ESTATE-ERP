import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import { Card, Button, Field, Input, Select, Badge, Stat, DataTable, Modal } from '../components/ui';
import { useToast } from '../components/ui';

const fmtMoney = (v) => '₹' + (Number(v || 0)).toLocaleString('en-IN');

export default function Subbrokers() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null); // { mode: 'create'|'edit', data }
  const [detail, setDetail] = useState(null); // { row, vertical, items }
  const [attach, setAttach] = useState(null); // { row, type: 'lead'|'listing', q, options }

  const load = () => api.get('/subbrokers').then(setRows).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true);
    const d = modal.data || {};
    try {
      if (modal.mode === 'edit') await api.patch(`/subbrokers/${d.id}`, d);
      else await api.post('/subbrokers', d);
      toast('Sub-broker saved', 'success');
      setModal(null);
      load();
    } catch (e) { toast(e.message || 'Save failed', 'error'); }
    setBusy(false);
  };

  const showVertical = async (row, vertical) => {
    const items = await api.get(`/subbrokers/${row.id}/${vertical === 'leads' ? 'leads' : 'properties'}`).catch(() => []);
    setDetail({ row, vertical, items: Array.isArray(items) ? items : [] });
  };

  const openAttach = async (row, type) => {
    const res = await api.get(`/${type === 'lead' ? 'leads' : 'listings'}?limit=500`).catch(() => null);
    const opts = (res?.items || []).filter((x) => !x.subbroker_id).slice(0, 200);
    setAttach({ row, type, q: '', options: opts });
  };

  const attachOne = async () => {
    const a = attach;
    const target = a.options.find((x) => (a.type === 'lead' ? x.name : x.title) === a.q);
    if (!target) { toast('Pick an item from the list first', 'error'); return; }
    try {
      const r = await api.post(`/subbrokers/${a.row.id}/attach`, { type: a.type === 'lead' ? 'lead' : 'listing', id: target.id });
      if (!r.ok) throw new Error('Could not attach');
      toast(`${a.type === 'lead' ? 'Lead' : 'Property'} attached to ${a.row.name}`, 'success');
      setAttach(null);
      load();
    } catch (e) { toast(e.message || 'Attach failed', 'error'); }
  };

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ fontSize: 20 }}>Sub-brokers</h2>
        <div className="grow" />
        <Button variant="primary" onClick={() => setModal({ mode: 'create', data: { name: '', phone: '', email: '', company: '', commission_pct: 1, verticals: ['leads', 'properties'], notes: '' } })}>
          + Add Sub-broker
        </Button>
      </div>

      <div className="grid c3 mb">
        <Stat label="Sub-brokers" value={rows.length} sub="registered partners" color="var(--brand)" />
        <Stat label="Leads referred" value={rows.reduce((s, r) => s + (r.leads || 0), 0)} sub="from sub-brokers" color="var(--blue)" />
        <Stat label="Properties sourced" value={rows.reduce((s, r) => s + (r.properties || 0), 0)} sub="from sub-brokers" color="var(--green)" />
      </div>

      <Card pad={false}>
        {rows.length === 0 ? <div className="empty">No sub-brokers yet — add your first one above.</div> : (
          <DataTable
            rows={rows}
            columns={[
              { key: 'name', label: 'Sub-broker', render: (r) => <div><b>{r.name}</b><div className="small muted">{r.company || '—'}</div></div> },
              { key: 'phone', label: 'Contact', render: (r) => <div className="small">{r.phone}<div className="muted">{r.email}</div></div> },
              { key: 'verticals', label: 'Verticals', render: (r) => <div className="flex gap">{r.verticals?.includes('leads') && <Badge tone="blue">Leads</Badge>}{r.verticals?.includes('properties') && <Badge tone="green">Properties</Badge>}</div> },
              { key: 'commission_pct', label: 'Commission', render: (r) => <Badge tone="brand">{r.commission_pct}%</Badge> },
              { key: 'leads', label: 'Leads', render: (r) => <div className="small"><b>{r.leads || 0}</b> <span className="muted">({r.leads_won || 0} won)</span></div> },
              { key: 'properties', label: 'Props', render: (r) => <div className="small"><b>{r.properties || 0}</b> <span className="muted">({r.properties_sold || 0} sold)</span></div> },
              { key: 'ref', label: 'Referral', render: (r) => <div className="small"><Badge tone="amber">{r.ref_code}</Badge><div className="muted">{fmtMoney(r.ref_amount)}</div></div> },
              { key: 'act', label: '', render: (r) => (
                <div className="flex gap">
                  <Button sm ghost onClick={() => showVertical(r, 'leads')}>Leads</Button>
                  <Button sm ghost onClick={() => showVertical(r, 'properties')}>Props</Button>
                  <Button sm ghost onClick={() => setModal({ mode: 'edit', data: r })}>Edit</Button>
                  <Button sm ghost onClick={() => openAttach(r, 'lead')}>Attach</Button>
                </div>
              ) }
            ]}
          />
        )}
      </Card>

      {modal && (
        <Modal title={modal.mode === 'edit' ? `Edit ${modal.data.name}` : 'Add Sub-broker'} onClose={() => setModal(null)} footer={<>
          <Button onClick={() => setModal(null)}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
        </>}>
          <div className="frm-grid">
            <Field label="Name *"><Input value={modal.data.name || ''} onChange={(e) => setModal({ ...modal, data: { ...modal.data, name: e.target.value } })} /></Field>
            <Field label="Company"><Input value={modal.data.company || ''} onChange={(e) => setModal({ ...modal, data: { ...modal.data, company: e.target.value } })} /></Field>
            <Field label="Phone"><Input value={modal.data.phone || ''} onChange={(e) => setModal({ ...modal, data: { ...modal.data, phone: e.target.value } })} /></Field>
            <Field label="Email"><Input value={modal.data.email || ''} onChange={(e) => setModal({ ...modal, data: { ...modal.data, email: e.target.value } })} /></Field>
            <Field label="Commission %"><Input type="number" value={modal.data.commission_pct || 1} onChange={(e) => setModal({ ...modal, data: { ...modal.data, commission_pct: e.target.value } })} /></Field>
            <Field label="Status">
              <Select value={modal.data.status || 'active'} onChange={(e) => setModal({ ...modal, data: { ...modal.data, status: e.target.value } })}>
                <option value="active">Active</option><option value="inactive">Inactive</option>
              </Select>
            </Field>
            <Field label="Verticals (business we get from them)" full>
              <div className="flex gap">
                <label className="flex items-center gap"><input type="checkbox" checked={modal.data.verticals?.includes('leads')} onChange={(e) => { const v = modal.data.verticals || []; setModal({ ...modal, data: { ...modal.data, verticals: e.target.checked ? [...v, 'leads'] : v.filter((x) => x !== 'leads') } }); }} /> Leads (we close)</label>
                <label className="flex items-center gap"><input type="checkbox" checked={modal.data.verticals?.includes('properties')} onChange={(e) => { const v = modal.data.verticals || []; setModal({ ...modal, data: { ...modal.data, verticals: e.target.checked ? [...v, 'properties'] : v.filter((x) => x !== 'properties') } }); }} /> Properties (we close)</label>
              </div>
            </Field>
            <Field label="Notes" full><Input value={modal.data.notes || ''} onChange={(e) => setModal({ ...modal, data: { ...modal.data, notes: e.target.value } })} /></Field>
          </div>
        </Modal>
      )}

      {attach && (
        <Modal title={`Attach to ${attach.row.name}`} onClose={() => setAttach(null)} footer={<>
          <Button onClick={() => setAttach(null)}>Cancel</Button>
          <Button variant="primary" onClick={attachOne}>Attach</Button>
        </>}>
          <div className="frm-grid">
            <Field label="Type">
              <div className="flex gap">
                <button className={`btn sm ${attach.type === 'lead' ? 'primary' : ''}`} onClick={() => setAttach({ ...attach, type: 'lead', q: '' })}>Lead</button>
                <button className={`btn sm ${attach.type === 'listing' ? 'primary' : ''}`} onClick={() => setAttach({ ...attach, type: 'listing', q: '' })}>Property</button>
              </div>
            </Field>
            <Field label={`Search ${attach.type === 'lead' ? 'leads' : 'properties'}`}>
              <Input
                list={`attach-${attach.type}`}
                placeholder={attach.type === 'lead' ? 'Type a lead name…' : 'Type a property title…'}
                value={attach.q}
                onChange={(e) => setAttach({ ...attach, q: e.target.value })}
              />
              <datalist id={`attach-${attach.type}`}>
                {attach.options.map((x) => <option key={x.id} value={attach.type === 'lead' ? x.name : x.title} />)}
              </datalist>
            </Field>
            <div className="small muted">Pick an existing {attach.type === 'lead' ? 'lead' : 'property'} to link it to this sub-broker's referral pipeline.</div>
          </div>
        </Modal>
      )}

      {detail && (
        <Modal title={`${detail.row.name} — ${detail.vertical === 'leads' ? 'Referred Leads' : 'Sourced Properties'}`} wide onClose={() => setDetail(null)}>
          {detail.items.length === 0 ? <div className="empty">No {detail.vertical} yet.</div> : (
            <DataTable
              rows={detail.items}
              columns={detail.vertical === 'leads' ? [
                { key: 'name', label: 'Lead' },
                { key: 'phone', label: 'Phone' },
                { key: 'project_id', label: 'Project', render: (r) => r.project_id?.slice(0, 8) || '—' },
                { key: 'status', label: 'Status', render: (r) => <Badge tone="brand">{r.status}</Badge> },
                { key: 'created_at', label: 'Date', render: (r) => r.created_at }
              ] : [
                { key: 'title', label: 'Property' },
                { key: 'transaction_type', label: 'Type', render: (r) => r.transaction_type || '—' },
                { key: 'price', label: 'Price', render: (r) => fmtMoney(r.price) },
                { key: 'location', label: 'Location' },
                { key: 'status', label: 'Status', render: (r) => <Badge tone="brand">{r.status}</Badge> }
              ]}
            />
          )}
        </Modal>
      )}
    </div>
  );
}
