import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { api, fmtMoney, fmtDate } from '../api';
import { Card, Badge, Button, DataTable, Field, Input, Modal, Empty } from '../components/ui';
import { useToast } from '../components/ui';
import { QRCode } from '../components/qr';

export default function CustomerDetail() {
  const { id } = useParams();
  const { can } = useStore();
  const nav = useNavigate();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [payModal, setPayModal] = useState(false);
  const [payForm, setPayForm] = useState({});
  const [bookingModal, setBookingModal] = useState(false);
  const [bkForm, setBkForm] = useState({});
  const [units, setUnits] = useState([]);

  const load = () => api.get(`/customers/${id}`).then(setD).catch((e) => { if (e.status === 403) nav('/customers'); });
  useEffect(() => { load(); }, [id]);
  useEffect(() => { api.get('/units', { availability: 'Available', limit: 200 }).then((u) => setUnits(u.items || [])).catch(() => {}); }, []);

  if (!d) return <div className="empty">Loading…</div>;
  const { customer, bookings, payments, invoices, documents, ltv } = d;

  const recordPayment = async () => {
    if (!payForm.amount) return toast('Amount required', 'error');
    const p = await api.post('/finance/payments', { ...payForm, customer_id: id, date: new Date().toISOString().slice(0, 10) });
    setPayModal(false); setPayForm({}); load(); toast(`Receipt ${p.receipt_no} recorded`, 'success');
  };

  const createBooking = async () => {
    if (!bkForm.unit_id) return toast('Select a unit', 'error');
    await api.post('/finance/bookings', { ...bkForm, customer_id: id });
    setBookingModal(false); setBkForm({}); load(); toast('Booking created', 'success');
  };

  const approveKyc = async () => {
    await api.post(`/customers/${id}/kyc`, { status: 'verified' });
    toast('KYC verified', 'success'); load();
  };

  return (
    <div>
      <div className="toolbar">
        <Button onClick={() => nav('/customers')}>← Customers</Button>
        <div className="grow" />
        <Button onClick={() => setPayModal(true)}>+ Record Payment</Button>
        <Button variant="primary" onClick={() => setBookingModal(true)}>+ New Booking</Button>
        {can('loan.create') && <Button variant="success" onClick={() => nav(`/loans?convert=${id}`)}>🏦 Pass to Home Loan</Button>}
        {can('customer.kyc') && customer.kyc_status !== 'verified' && <Button variant="success" onClick={approveKyc}>✓ Approve KYC</Button>}
      </div>

      <div className="grid c2">
        <Card>
          <div className="flex between">
            <div>
              <h2 style={{ fontSize: 20 }}>{customer.name}</h2>
              <div className="muted">{customer.phone} · {customer.email}</div>
              <div className="muted small mt">{customer.address}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <QRCode value={`${location.origin}/portal/${id}`} size={90} />
              <div className="small muted">Portal QR</div>
            </div>
          </div>
          <div className="grid c3 mt">
            <div><div className="s-label">KYC</div><Badge tone={customer.kyc_status === 'verified' ? 'green' : 'amber'}>{customer.kyc_status}</Badge></div>
            <div><div className="s-label">Loyalty</div><Badge tone="purple">★ {customer.loyalty_points}</Badge></div>
            <div><div className="s-label">Est. LTV</div><b>{fmtMoney(ltv)}</b></div>
          </div>
        </Card>

        <Card>
          <h3 className="mb">Bookings</h3>
          {bookings.length ? (
            <DataTable
              rows={bookings}
              columns={[
                { key: 'unit_number', label: 'Unit', render: (r) => r.unit_number || '—' },
                { key: 'total_value', label: 'Value', render: (r) => fmtMoney(r.total_value) },
                { key: 'token_amount', label: 'Token', render: (r) => fmtMoney(r.token_amount) },
                { key: 'status', label: 'Status', render: (r) => <Badge tone="blue">{r.status.replace(/_/g, ' ')}</Badge> },
                { key: 'rera_ref', label: 'RERA', render: (r) => <span className="small">{r.rera_ref || '—'}</span> }
              ]}
            />
          ) : <Empty text="No bookings yet" />}
        </Card>
      </div>

      <div className="grid c2 mt">
        <Card>
          <h3 className="mb">Payments</h3>
          {payments.length ? (
            <DataTable
              rows={payments}
              columns={[
                { key: 'receipt_no', label: 'Receipt' },
                { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) },
                { key: 'amount', label: 'Amount', render: (r) => fmtMoney(r.amount) },
                { key: 'mode', label: 'Mode', render: (r) => <Badge tone="gray">{r.mode}</Badge> }
              ]}
            />
          ) : <Empty text="No payments" />}
        </Card>
        <Card>
          <h3 className="mb">Invoices</h3>
          {invoices.length ? (
            <DataTable
              rows={invoices}
              columns={[
                { key: 'number', label: 'Invoice' },
                { key: 'amount', label: 'Amount', render: (r) => fmtMoney(r.amount) },
                { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'paid' ? 'green' : r.status === 'overdue' ? 'red' : 'amber'}>{r.status}</Badge> },
                { key: 'due_date', label: 'Due', render: (r) => fmtDate(r.due_date) }
              ]}
            />
          ) : <Empty text="No invoices" />}
        </Card>
      </div>

      <Card className="mt">
        <h3 className="mb">Documents</h3>
        {documents.length ? (
          <div className="flex gap">
            {documents.map((doc) => <Badge key={doc.id} tone="brand">{doc.name} {doc.verified ? '✓' : ''}</Badge>)}
          </div>
        ) : <Empty text="No documents" />}
      </Card>

      {payModal && (
        <Modal title="Record Payment" onClose={() => setPayModal(false)} footer={<>
          <Button onClick={() => setPayModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={recordPayment}>Save</Button>
        </>}>
          <div className="frm-grid">
            <Field label="Amount (₹)"><Input type="number" value={payForm.amount || ''} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} /></Field>
            <Field label="Mode"><select className="select" value={payForm.mode || 'cash'} onChange={(e) => setPayForm({ ...payForm, mode: e.target.value })}><option>cash</option><option>cheque</option><option>neft</option><option>upi</option><option>rtgs</option></select></Field>
            <Field label="Reference"><Input value={payForm.reference || ''} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} /></Field>
            <Field label="Notes"><Input value={payForm.notes || ''} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} /></Field>
          </div>
        </Modal>
      )}

      {bookingModal && (
        <Modal title="New Booking" onClose={() => setBookingModal(false)} footer={<>
          <Button onClick={() => setBookingModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={createBooking}>Create Booking</Button>
        </>}>
          <div className="frm-grid">
            <Field label="Available Unit" full>
              <select className="select" value={bkForm.unit_id || ''} onChange={(e) => setBkForm({ ...bkForm, unit_id: e.target.value })}>
                <option value="">— select unit —</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.number} · {u.unit_type} · ₹{u.price}</option>)}
              </select>
            </Field>
            <Field label="Token Amount"><Input type="number" value={bkForm.token_amount || ''} onChange={(e) => setBkForm({ ...bkForm, token_amount: e.target.value })} /></Field>
            <Field label="RERA Ref"><Input value={bkForm.rera_ref || ''} onChange={(e) => setBkForm({ ...bkForm, rera_ref: e.target.value })} /></Field>
            <Field label="Agreement Date"><Input type="date" value={bkForm.agreement_date || ''} onChange={(e) => setBkForm({ ...bkForm, agreement_date: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
