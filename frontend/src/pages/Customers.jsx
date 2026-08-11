import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { api, fmtMoney } from '../api';
import { Card, Button, Badge, DataTable, Modal, Field, Input, Select, Empty } from '../components/ui';
import { QRCode } from '../components/qr';
import { useToast } from '../components/ui';

const KYC_TONES = { pending: 'amber', verified: 'green', rejected: 'red' };

export default function Customers() {
  const { can } = useStore();
  const nav = useNavigate();
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');
  const [kyc, setKyc] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({});
  const [qrFor, setQrFor] = useState(null);

  const load = () => api.get('/customers', { q, kyc }).then((d) => setItems(d.items)).catch(() => {});
  useEffect(() => { load(); }, [q, kyc]);

  const save = async () => {
    if (!form.name) return toast('Customer name required', 'error');
    await api.post('/customers', form);
    setModal(false); setForm({}); load(); toast('Customer created', 'success');
  };

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ fontSize: 20 }}>Customers</h2>
        <div className="grow" />
        {can('customer.create') && <Button variant="primary" onClick={() => setModal(true)}>+ New Customer</Button>}
        {can('customer.export') && <Button onClick={() => api.download('/customers/export/csv').catch((e) => toast(e.message, 'error'))}>⤓ Export</Button>}
        {can('customer.export') && <Button onClick={() => api.shareFile('/customers/export/csv', null, 'Customers Export').then((m) => { if (m === 'downloaded') toast('Sharing not available — file downloaded', 'info'); }).catch((e) => toast(e.message, 'error'))}>Share</Button>}
        <Select value={kyc} onChange={(e) => setKyc(e.target.value)} style={{ width: 150 }}>
          <option value="">All KYC</option>
          <option>pending</option><option>verified</option><option>rejected</option>
        </Select>
        <Input className="search-input" placeholder="Search customers…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <Card pad={false}>
        {items.length === 0 ? <Empty /> : (
          <DataTable
            rows={items}
            onRowClick={(r) => nav(`/customers/${r.id}`)}
            columns={[
              { key: 'name', label: 'Customer', render: (r) => <div><b>{r.name}</b><div className="small muted">{r.phone}</div></div> },
              { key: 'email', label: 'Email' },
              { key: 'kyc_status', label: 'KYC', render: (r) => <Badge tone={KYC_TONES[r.kyc_status] || 'gray'}>{r.kyc_status}</Badge> },
              { key: 'loyalty_points', label: 'Loyalty', render: (r) => <Badge tone="purple">★ {r.loyalty_points || 0}</Badge> },
              { key: 'ltv', label: 'LTV (est.)', render: (r) => fmtMoney(r.ltv) },
              { key: 'id', label: 'Actions', render: (r) => <Button sm onClick={(e) => { e.stopPropagation(); setQrFor(r); }}>QR</Button> }
            ]}
          />
        )}
      </Card>

      {qrFor && (
        <Modal title={`QR — ${qrFor.name}`} onClose={() => setQrFor(null)} footer={<Button onClick={() => setQrFor(null)}>Close</Button>}>
          <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
            <QRCode value={`${location.origin}/portal/${qrFor.id}`} size={180} />
            <div>
              <div><b>{qrFor.name}</b></div>
              <div className="small muted">Scans into the customer's portal with bookings, receipts & documents.</div>
            </div>
          </div>
        </Modal>
      )}

      {modal && (
        <Modal title="New Customer" onClose={() => setModal(false)} footer={<>
          <Button onClick={() => setModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={save}>Save</Button>
        </>}>
          <div className="frm-grid">
            <Field label="Name"><Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Phone"><Input value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Email"><Input value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="PAN"><Input value={form.pan || ''} onChange={(e) => setForm({ ...form, pan: e.target.value })} /></Field>
            <Field label="Referred by (phone/name)" full><Input value={form.referred_by || ''} onChange={(e) => setForm({ ...form, referred_by: e.target.value })} /></Field>
            <Field label="Address" full><Input value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
