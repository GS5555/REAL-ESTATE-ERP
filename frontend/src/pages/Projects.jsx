import { useEffect, useState } from 'react';
import { api } from '../api';
import { Card, Button, Badge, DataTable, Modal, Field, Input, Select, Textarea, Empty } from '../components/ui';
import { useStore } from '../store';
import { useToast } from '../components/ui';

const TYPES = ['Residential', 'Commercial', 'Office Space', 'Retail Shops', 'Warehouses', 'Industrial', 'Plots', 'Farmhouse', 'Villa', 'Resale', 'Rental'];
const STATUSES = ['Under Construction', 'Ready Possession', 'Completed', 'Pre-Launch'];

export default function Projects() {
  const { can } = useStore();
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({});

  const load = () => api.get('/projects').then(setItems).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name) return toast('Project name required', 'error');
    await api.post('/projects', form);
    setModal(false); setForm({}); load(); toast('Project created', 'success');
  };

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ fontSize: 20 }}>Projects</h2>
        <div className="grow" />
        {can('project.create') && <Button variant="primary" onClick={() => setModal(true)}>+ New Project</Button>}
      </div>
      <Card pad={false}>
        {items.length === 0 ? <Empty /> : (
          <DataTable
            rows={items}
            columns={[
              { key: 'name', label: 'Project', render: (r) => <div style={{ fontWeight: 600 }}>{r.name}</div> },
              { key: 'type', label: 'Type', render: (r) => <Badge tone="brand">{r.type}</Badge> },
              { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'Ready Possession' ? 'green' : r.status === 'Completed' ? 'gray' : 'amber'}>{r.status}</Badge> },
              { key: 'city', label: 'City' },
              { key: 'location', label: 'Location' },
              { key: 'price_range', label: 'Price Range' },
              { key: 'amenities', label: 'Amenities', render: (r) => <span className="small muted">{r.amenities?.slice(0, 3).join(', ')}</span> }
            ]}
          />
        )}
      </Card>

      {modal && (
        <Modal title="New Project" onClose={() => setModal(false)} wide footer={<>
          <Button onClick={() => setModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={save}>Save Project</Button>
        </>}>
          <div className="frm-grid">
            <Field label="Project Name" full><Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Type"><Select value={form.type || 'Residential'} onChange={(e) => setForm({ ...form, type: e.target.value })}>{TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
            <Field label="Sub-type"><Input value={form.subtype || ''} onChange={(e) => setForm({ ...form, subtype: e.target.value })} placeholder="e.g. 2/3 BHK Apartments" /></Field>
            <Field label="Status"><Select value={form.status || 'Under Construction'} onChange={(e) => setForm({ ...form, status: e.target.value })}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
            <Field label="City"><Input value={form.city || ''} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
            <Field label="Location"><Input value={form.location || ''} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
            <Field label="Area / Corridor"><Input value={form.area || ''} onChange={(e) => setForm({ ...form, area: e.target.value })} /></Field>
            <Field label="Price Range"><Input value={form.price_range || ''} onChange={(e) => setForm({ ...form, price_range: e.target.value })} placeholder="₹1.2 Cr – ₹2.8 Cr" /></Field>
            <Field label="Brochure URL"><Input value={form.brochure_url || ''} onChange={(e) => setForm({ ...form, brochure_url: e.target.value })} /></Field>
            <Field label="Virtual Tour URL"><Input value={form.virtual_tour_url || ''} onChange={(e) => setForm({ ...form, virtual_tour_url: e.target.value })} /></Field>
            <Field label="Google Map (embed)" full><Input value={form.google_map || ''} onChange={(e) => setForm({ ...form, google_map: e.target.value })} /></Field>
            <Field label="Amenities (comma separated)" full><Input value={(form.amenities || []).join(', ')} onChange={(e) => setForm({ ...form, amenities: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></Field>
            <Field label="Description" full><Textarea value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
