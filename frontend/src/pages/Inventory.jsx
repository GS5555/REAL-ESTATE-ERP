import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { api, fmtMoney } from '../api';
import { Card, Button, Badge, DataTable, Modal, Field, Input, Select, Empty } from '../components/ui';
import ImageUpload from '../components/ImageUpload';
import { QRCode } from '../components/qr';
import { useToast } from '../components/ui';

const TONES = { Available: 'green', Reserved: 'amber', Booked: 'blue', Sold: 'gray', Blocked: 'red' };

export default function Inventory() {
  const { can } = useStore();
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [projects, setProjects] = useState([]);
  const [q, setQ] = useState('');
  const [proj, setProj] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({});
  const [qrFor, setQrFor] = useState(null);

  const load = () => {
    api.get('/units', { q, project_id: proj, page, limit: 30 }).then((d) => { setItems(d.items); setTotal(d.total); }).catch(() => {});
  };
  useEffect(() => { load(); }, [q, proj, page]);
  useEffect(() => { api.get('/projects').then(setProjects).catch(() => {}); }, []);

  const save = async () => {
    if (!form.number) return toast('Unit number required', 'error');
    if (form.id) {
      await api.patch(`/units/${form.id}`, form);
      toast('Unit updated', 'success');
    } else {
      await api.post('/units', form);
      toast('Unit added', 'success');
    }
    setModal(false); setForm({}); load();
  };

  const reserve = async (u) => {
    const days = prompt('Reserve for how many days? (auto-expiry)', '7');
    if (days === null) return;
    await api.post(`/units/${u.id}/reserve`, { days: parseInt(days) || 7 });
    toast('Unit reserved with auto-expiry', 'success');
    load();
  };

  const release = async (u) => {
    await api.post(`/units/${u.id}/release`, {});
    toast('Unit released', 'success');
    load();
  };

  const edit = (u) => {
    setForm({ ...u, photos: u.photos || [] });
    setModal(true);
  };

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ fontSize: 20 }}>Property Inventory <span className="muted small">({total} units)</span></h2>
        <div className="grow" />
        {can('inventory.create') && <Button variant="primary" onClick={() => setModal(true)}>+ Add Unit</Button>}
        {can('inventory.view') && can('report.export') && <Button onClick={() => api.download('/units/export/csv').catch((e) => toast(e.message, 'error'))}>⤓ Export</Button>}
        {can('inventory.view') && can('report.export') && <Button onClick={() => api.shareFile('/units/export/csv', null, 'Inventory Export').then((m) => { if (m === 'downloaded') toast('Sharing not available — file downloaded', 'info'); }).catch((e) => toast(e.message, 'error'))}>Share</Button>}
        <Input className="search-input" placeholder="Search unit…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={proj} onChange={(e) => setProj(e.target.value)}>
          <option value="">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </div>

      <Card pad={false}>
        {items.length === 0 ? <Empty /> : (
          <DataTable
            rows={items}
            onRowClick={(r) => { if (can('inventory.edit')) edit(r); }}
            columns={[
              { key: 'number', label: 'Unit', render: (r) => <div className="flex items-center gap"><img src={(r.photos || [])[0] || ''} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6, background: '#f1f5f9' }} /><div><b>{r.number}</b><div className="small muted">{r.project_id && projects.find((p) => p.id === r.project_id)?.name}</div></div></div> },
              { key: 'unit_type', label: 'Type', render: (r) => <Badge tone="brand">{r.unit_type}</Badge> },
              { key: 'floor', label: 'Floor' },
              { key: 'carpet_area', label: 'Carpet' },
              { key: 'builtup_area', label: 'Built-up' },
              { key: 'price', label: 'Price', render: (r) => fmtMoney(r.price) },
              { key: 'availability', label: 'Availability', render: (r) => <Badge tone={TONES[r.availability]}>{r.availability}</Badge> },
              { key: 'booking_status', label: 'Booking' },
              { key: 'id', label: 'Actions', render: (r) => (
                <div className="flex gap">
                  <Button sm onClick={() => setQrFor(r)}>QR</Button>
                  {can('inventory.edit') && <Button sm ghost onClick={() => edit(r)}>Edit</Button>}
                  {can('inventory.reserve') && r.availability === 'Available' && <Button sm variant="primary" onClick={() => reserve(r)}>Reserve</Button>}
                  {can('inventory.reserve') && r.availability === 'Reserved' && <Button sm onClick={() => release(r)}>Release</Button>}
                </div>
              ) }
            ]}
          />
        )}
      </Card>
      <div className="flex between mt small">
        <span className="muted">{total} units</span>
        <div className="flex gap">
          <Button sm disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</Button>
          <Button sm disabled={items.length < 30} onClick={() => setPage(page + 1)}>Next →</Button>
        </div>
      </div>

      {qrFor && (
        <Modal title={`QR — Unit ${qrFor.number}`} onClose={() => setQrFor(null)} footer={<Button onClick={() => setQrFor(null)}>Close</Button>}>
          <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
            <QRCode value={`${location.origin}/api/portal?unit=${qrFor.number}`} size={180} />
            <div>
              <div><b>Unit {qrFor.number}</b></div>
              <div className="small muted">Price: {fmtMoney(qrFor.price)}</div>
              <div className="small muted">Scan to share with a prospect or print for the site office.</div>
            </div>
          </div>
        </Modal>
      )}

      {modal && (
        <Modal title={form.id ? `Edit Unit ${form.number}` : 'Add Unit'} onClose={() => setModal(false)} wide footer={<>
          <Button onClick={() => setModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={save}>{form.id ? 'Save Changes' : 'Save Unit'}</Button>
        </>}>
          <div className="frm-grid">
            <Field label="Project"><Select value={form.project_id || ''} onChange={(e) => setForm({ ...form, project_id: e.target.value })}><option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
            <Field label="Unit Number"><Input value={form.number || ''} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder="Tower A-701" /></Field>
            <Field label="Unit Type"><Input value={form.unit_type || '2 BHK'} onChange={(e) => setForm({ ...form, unit_type: e.target.value })} /></Field>
            <Field label="Floor"><Input type="number" value={form.floor || 1} onChange={(e) => setForm({ ...form, floor: e.target.value })} /></Field>
            <Field label="Carpet Area (sq.ft)"><Input type="number" value={form.carpet_area || ''} onChange={(e) => setForm({ ...form, carpet_area: e.target.value })} /></Field>
            <Field label="Built-up Area (sq.ft)"><Input type="number" value={form.builtup_area || ''} onChange={(e) => setForm({ ...form, builtup_area: e.target.value })} /></Field>
            <Field label="Price (₹)"><Input type="number" value={form.price || ''} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field>
            <Field label="Availability"><Select value={form.availability || 'Available'} onChange={(e) => setForm({ ...form, availability: e.target.value })}>{Object.keys(TONES).map((t) => <option key={t}>{t}</option>)}</Select></Field>
            <Field label="Floor Plan URL" full><Input value={form.floor_plan_url || ''} onChange={(e) => setForm({ ...form, floor_plan_url: e.target.value })} /></Field>
          </div>
          <div className="mt">
            <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: 'block' }}>Unit Photos</label>
            <ImageUpload images={form.photos || []} onChange={(photos) => setForm({ ...form, photos })} />
          </div>
        </Modal>
      )}
    </div>
  );
}
