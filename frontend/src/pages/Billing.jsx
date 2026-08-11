import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { api, fmtMoney, fmtDate, fmtDateTime } from '../api';
import { Card, Button, Badge, Field, Input, Select, DataTable, Tabs, Stat, Empty, Modal, Switch } from '../components/ui';
import { useToast } from '../components/ui';

const STATUS_TONES = { paid: 'green', overdue: 'red', sent: 'blue', draft: 'gray', cancelled: 'gray' };
const CHANNELS = ['email', 'whatsapp', 'sms', 'pdf'];

const INDIAN_STATES = [
  ['Andhra Pradesh', '37'], ['Arunachal Pradesh', '12'], ['Assam', '18'], ['Bihar', '10'],
  ['Chhattisgarh', '22'], ['Delhi', '07'], ['Goa', '30'], ['Gujarat', '24'],
  ['Haryana', '06'], ['Himachal Pradesh', '02'], ['Jammu & Kashmir', '01'], ['Jharkhand', '20'],
  ['Karnataka', '29'], ['Kerala', '32'], ['Madhya Pradesh', '23'], ['Maharashtra', '27'],
  ['Manipur', '14'], ['Meghalaya', '17'], ['Mizoram', '15'], ['Nagaland', '13'],
  ['Odisha', '21'], ['Puducherry', '34'], ['Punjab', '03'], ['Rajasthan', '08'],
  ['Sikkim', '11'], ['Tamil Nadu', '33'], ['Telangana', '36'], ['Tripura', '16'],
  ['Uttar Pradesh', '09'], ['Uttarakhand', '05'], ['West Bengal', '19']
];

function gstStateFromGstin(gstin) {
  const g = String(gstin || '').trim().toUpperCase();
  return /^\d{2}/.test(g) ? g.slice(0, 2) : '';
}

function gstPreview(amount, rate, buyerState) {
  const r = Number(rate) || 0;
  const t = Math.max(0, Number(amount) || 0);
  const total = Math.round(t * r / 100);
  const sameState = buyerState === '27';
  if (sameState) {
    const half = Math.round(total / 2);
    return { cgst: half, sgst: total - half, igst: 0, type: 'Intra-state (CGST + SGST)', total };
  }
  return { cgst: 0, sgst: 0, igst: total, type: 'Inter-state (IGST)', total };
}

export default function Billing() {
  const { can } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState('invoices');
  const [invoices, setInvoices] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [invModal, setInvModal] = useState(false);
  const [inv, setInv] = useState({ customer_id: '', number: '', amount: '', gst: '18', due_date: '' });
  const [vendorModal, setVendorModal] = useState(false);
  const [vendor, setVendor] = useState({});
  const [reminders, setReminders] = useState({ overdue: [], upcoming: [] });
  const [logs, setLogs] = useState([]);
  const [invStatus, setInvStatus] = useState('');
  const [invFrom, setInvFrom] = useState('');
  const [invTo, setInvTo] = useState('');
  const [cfg, setCfg] = useState({ builders: false, vendors: false, customers: false, channels: { email: true, whatsapp: true, sms: true, pdf: true } });
  const [company, setCompany] = useState(null);
  const [preview, setPreview] = useState(null);

  const loadCompany = () => {
    api.get('/settings').then((co) => setCompany(co)).catch(() => {});
  };

  useEffect(() => {
    loadCompany();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = () => {
    api.get('/billing/invoices', { status: invStatus, from: invFrom, to: invTo }).then(setInvoices).catch(() => {});
    api.get('/billing/reminders/pending').then(setReminders).catch(() => {});
    api.get('/billing/reminders/logs').then(setLogs).catch(() => {});
  };
  const loadVendors = () => {
    api.get('/billing/vendors').then(setVendors).catch(() => {});
  };
  const loadCfg = () => {
    api.get('/billing/config').then((d) => {
      setCfg({
        builders: !!(d.builders && d.builders.enabled),
        vendors: !!(d.vendors && d.vendors.enabled),
        customers: !!(d.customers && d.customers.enabled),
        channels: d.channels || { email: true, whatsapp: true, sms: true, pdf: true }
      });
    }).catch(() => {});
  };
  useEffect(() => { load(); loadCfg(); }, [invStatus, invFrom, invTo]);
  useEffect(() => { api.get('/customers').then((d) => setCustomers(d.items || [])).catch(() => {}); }, []);
  useEffect(() => { if (tab === 'vendors') loadVendors(); if (tab === 'reminders') { api.get('/billing/reminders/pending').then(setReminders).catch(() => {}); api.get('/billing/reminders/logs').then(setLogs).catch(() => {}); } }, [tab]);

  const createInvoice = async () => {
    if (!inv.customer_id) return toast('Pick a customer', 'error');
    try {
      const body = { ...inv, amount: Number(inv.amount) || 0 };
      const cust = customers.find((c) => c.id === inv.customer_id);
      if (cust && cust.gstin) body.customer_gstin = cust.gstin;
      if (cust && cust.state_code) body.buyer_state_code = cust.state_code;
      await api.post('/billing/invoices', body);
      setInvModal(false); setInv({ customer_id: '', number: '', amount: '', gst: '18', due_date: '' });
      load(); toast('Invoice created', 'success');
    } catch (e) { toast(e.message, 'error'); }
  };

  const saveVendor = async () => {
    if (!vendor.company_name) return toast('Company name required', 'error');
    const body = { ...vendor };
    if (body.gstin && !body.gst_state_code) body.gst_state_code = gstStateFromGstin(body.gstin);
    try {
      if (vendor.id) await api.patch(`/billing/vendors/${vendor.id}`, body);
      else await api.post('/billing/vendors', body);
      setVendorModal(false); setVendor({}); loadVendors(); toast(vendor.id ? 'Vendor updated' : 'Vendor added', 'success');
    } catch (e) { toast(e.message, 'error'); }
  };

  const deleteVendor = async (v) => {
    try { await api.del(`/billing/vendors/${v.id}`); loadVendors(); toast('Vendor removed', 'success'); }
    catch (e) { toast(e.message, 'error'); }
  };

  const sendInvoice = async (r) => {
    try { await api.post(`/billing/invoices/${r.id}/send`, { channel: 'email' }); toast(`Invoice ${r.number} sent`, 'success'); load(); }
    catch (e) { toast(e.message, 'error'); }
  };

  const runReminders = async () => {
    try { const r = await api.post('/billing/reminders/run'); toast(`${r.sent} reminders sent`, 'success'); load(); }
    catch (e) { toast(e.message, 'error'); }
  };

  const saveCfg = async () => {
    const body = { channels: cfg.channels };
    for (const k of ['builders', 'vendors', 'customers']) body[k] = cfg[k] ? { enabled: true } : {};
    try { await api.put('/billing/config', body); toast('Config saved', 'success'); loadCfg(); } catch (e) { toast(e.message, 'error'); }
  };

  const tabs = [
    { key: 'invoices', label: 'Invoices' },
    { key: 'vendors', label: 'Vendors' },
    { key: 'reminders', label: 'Reminders' },
    { key: 'config', label: 'Config' }
  ];

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ fontSize: 20 }}>Billing & Invoices</h2>
        <div className="grow" />
        {tab === 'invoices' && <Button variant="primary" onClick={() => setInvModal(true)}>+ New Invoice</Button>}
        {tab === 'invoices' && can('billing.export') && <Button onClick={() => api.download('/billing/invoices/export/csv').catch((e) => toast(e.message, 'error'))}>⤓ Export</Button>}
        {tab === 'vendors' && <Button variant="primary" onClick={() => { setVendor({}); setVendorModal(true); }}>+ Add Vendor</Button>}
      </div>
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === 'vendors' && (
        <Card pad={false}>
          {vendors.length === 0 ? <Empty text="No vendors yet — add your suppliers with company & GST details" /> : (
            <DataTable
              rows={vendors}
              columns={[
                { key: 'company_name', label: 'Company', render: (r) => <div><b>{r.company_name}</b><div className="small muted">{r.gstin ? `GSTIN ${r.gstin}` : 'No GSTIN'}</div></div> },
                { key: 'gst_state', label: 'GST State', render: (r) => r.gst_state_code ? `${r.gst_state_code}${r.gst_state ? ' · ' + r.gst_state : ''}` : '—' },
                { key: 'contact_person', label: 'Contact Person' },
                { key: 'phone', label: 'Phone' },
                { key: 'alternate_phone', label: 'Alternate Contact', render: (r) => <div>{r.alternate_phone || '—'}<div className="small muted">{r.alternate_email || ''}</div></div> },
                { key: 'email', label: 'Email' },
                { key: 'actions', label: '', render: (r) => (
                  <div className="flex gap">
                    <Button sm ghost onClick={() => { setVendor(r); setVendorModal(true); }}>Edit</Button>
                    <Button sm ghost onClick={() => deleteVendor(r)}>Delete</Button>
                  </div>
                ) }
              ]}
            />
          )}
        </Card>
      )}

      {tab === 'invoices' && (
        <>
          <div className="toolbar">
            <Select value={invStatus} onChange={(e) => setInvStatus(e.target.value)} style={{ width: 150 }}>
              <option value="">All statuses</option>
              <option>draft</option><option>sent</option><option>paid</option><option>overdue</option><option>cancelled</option>
            </Select>
            <Input type="date" title="From" value={invFrom} onChange={(e) => setInvFrom(e.target.value)} />
            <Input type="date" title="To" value={invTo} onChange={(e) => setInvTo(e.target.value)} />
            {(invStatus || invFrom || invTo) && <Button sm variant="ghost" onClick={() => { setInvStatus(''); setInvFrom(''); setInvTo(''); }}>✕</Button>}
          </div>
        <Card pad={false}>
          {invoices.length === 0 ? <Empty text="No invoices yet" /> : (
            <DataTable
              rows={invoices}
              columns={[
                { key: 'number', label: 'Invoice', render: (r) => <div><b>{r.number}</b><div className="small muted">{fmtDate(r.date)}</div></div> },
                { key: 'customer_name', label: 'Customer' },
                { key: 'amount', label: 'Amount', render: (r) => fmtMoney(r.amount) },
                { key: 'gst', label: 'GST', render: (r) => `${r.gst}%` },
                { key: 'status', label: 'Status', render: (r) => <Badge tone={STATUS_TONES[r.status] || 'gray'}>{r.status}</Badge> },
                { key: 'due_date', label: 'Due', render: (r) => fmtDate(r.due_date) },
                { key: 'actions', label: '', render: (r) => (
                  <div className="flex gap">
                    <Button sm ghost onClick={() => setPreview(r)}>View</Button>
                    <Button sm ghost onClick={() => api.download(`/billing/invoices/${r.id}/pdf`).catch((e) => toast(e.message, 'error'))}>PDF</Button>
                    <Button sm ghost onClick={() => api.shareFile(`/billing/invoices/${r.id}/pdf`, null, `Invoice ${r.number}`).then((m) => { if (m === 'downloaded') toast('Sharing not available — file downloaded', 'info'); }).catch((e) => toast(e.message, 'error'))}>Share</Button>
                    <Button sm variant="primary" onClick={() => sendInvoice(r)}>Send</Button>
                  </div>
                ) }
              ]}
            />
          )}
        </Card>
        </>
      )}

      {tab === 'reminders' && (
        <>
          <div className="toolbar">
            <div className="grow" />
            <Button variant="primary" onClick={runReminders}>Run reminders</Button>
          </div>
          <div className="grid c2">
            <Card>
              <h3 className="mb">Overdue</h3>
              {reminders.overdue.length === 0 ? <div className="small muted">Nothing overdue</div> : reminders.overdue.map((r) => (
                <div key={r.id} className="flex between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div><b>{r.customer_name}</b><div className="small muted">{r.number} · due {fmtDate(r.due_date)}</div></div>
                  <Badge tone="red">{fmtMoney(r.amount)}</Badge>
                </div>
              ))}
            </Card>
            <Card>
              <h3 className="mb">Upcoming</h3>
              {reminders.upcoming.length === 0 ? <div className="small muted">Nothing upcoming</div> : reminders.upcoming.map((r) => (
                <div key={r.id} className="flex between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div><b>{r.customer_name}</b><div className="small muted">{r.number} · due {fmtDate(r.due_date)}</div></div>
                  <Badge tone="amber">{fmtMoney(r.amount)}</Badge>
                </div>
              ))}
            </Card>
          </div>
          <Card className="mt">
            <h3 className="mb">Reminder Logs</h3>
            {logs.length === 0 ? <div className="small muted">No logs yet</div> : logs.slice(0, 10).map((l) => (
              <div key={l.id} className="flex between" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <div className="small">{l.subject}</div>
                <div className="small muted">{l.channel} · {fmtDateTime(l.sent_at)}</div>
              </div>
            ))}
          </Card>
        </>
      )}

      {tab === 'config' && (
        <Card style={{ maxWidth: 640 }}>
          <h3 className="mb">Automation Config</h3>
          {[['builders', 'Builders automation'], ['vendors', 'Vendors automation'], ['customers', 'Customers automation']].map(([key, label]) => (
            <div key={key} className="flex between items-center" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <span>{label}</span>
              <Switch checked={cfg[key]} onChange={(v) => setCfg({ ...cfg, [key]: v })} />
            </div>
          ))}
          <h3 className="mt mb">Channels</h3>
          <div className="flex gap" style={{ flexWrap: 'wrap' }}>
            {CHANNELS.map((c) => (
              <label key={c} className="flex items-center gap" style={{ cursor: 'pointer' }}>
                <Switch checked={!!cfg.channels[c]} onChange={(v) => setCfg({ ...cfg, channels: { ...cfg.channels, [c]: v } })} />
                <span>{c}</span>
              </label>
            ))}
          </div>
          <Button className="mt" variant="primary" onClick={saveCfg}>Save Config</Button>
        </Card>
      )}

      {invModal && (
        <Modal title="New Invoice" onClose={() => setInvModal(false)} footer={<>
          <Button onClick={() => setInvModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={createInvoice} disabled={!inv.customer_id}>Create</Button>
        </>}>
          <div className="frm-grid">
            <Field label="Customer" full>
              <Select value={inv.customer_id} onChange={(e) => setInv({ ...inv, customer_id: e.target.value })}>
                <option value="">Select customer…</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.state_code ? ` (${c.state_code})` : ''}{c.gstin ? ' · GST' : ''}</option>)}
              </Select>
            </Field>
            <Field label="Number"><Input value={inv.number} onChange={(e) => setInv({ ...inv, number: e.target.value })} placeholder="INV-…" /></Field>
            <Field label="Taxable Amount (₹)"><Input type="number" value={inv.amount} onChange={(e) => setInv({ ...inv, amount: e.target.value })} /></Field>
            <Field label="GST Rate (%)"><Input type="number" value={inv.gst} onChange={(e) => setInv({ ...inv, gst: e.target.value })} /></Field>
            <Field label="Due date"><Input type="date" value={inv.due_date} onChange={(e) => setInv({ ...inv, due_date: e.target.value })} /></Field>
          </div>
          {(() => {
            const cust = customers.find((c) => c.id === inv.customer_id);
            const buyerState = (cust && (cust.state_code || gstStateFromGstin(cust.gstin))) || '';
            const p = gstPreview(inv.amount, inv.gst, buyerState);
            return (
              <div className="mt" style={{ background: 'var(--bg-soft, #f6f8fb)', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
                <div className="flex between"><span className="muted">Supplier state</span><span>27 (Maharashtra)</span></div>
                <div className="flex between"><span className="muted">Buyer state</span><span>{buyerState || '— (assumes intra-state)'}</span></div>
                <div className="flex between"><span className="muted">GST type</span><b>{p.type}</b></div>
                {p.cgst + p.sgst > 0 ? (<>
                  <div className="flex between"><span className="muted">CGST</span><span>₹{p.cgst}</span></div>
                  <div className="flex between"><span className="muted">SGST</span><span>₹{p.sgst}</span></div>
                </>) : (
                  <div className="flex between"><span className="muted">IGST</span><span>₹{p.igst}</span></div>
                )}
                <div className="flex between" style={{ fontWeight: 700 }}><span>Total</span><span>₹{(Number(inv.amount) || 0) + p.total}</span></div>
              </div>
            );
          })()}
        </Modal>
      )}

      {preview && <InvoicePreview inv={preview} company={company} onClose={() => setPreview(null)} />}

      {vendorModal && (
        <Modal title={vendor.id ? 'Edit Vendor' : 'Add Vendor'} onClose={() => setVendorModal(false)} footer={<>
          <Button onClick={() => setVendorModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={saveVendor} disabled={!vendor.company_name}>Save</Button>
        </>}>
          <div className="frm-grid">
            <Field label="Company Name" full><Input value={vendor.company_name || ''} onChange={(e) => setVendor({ ...vendor, company_name: e.target.value })} placeholder="e.g. Tata Steel Ltd" /></Field>
            <Field label="GSTIN" full><Input value={vendor.gstin || ''} onChange={(e) => setVendor({ ...vendor, gstin: e.target.value, gst_state_code: gstStateFromGstin(e.target.value) })} placeholder="27AAACX1234F1Z5" /></Field>
            <Field label="GST State">
              <Select value={vendor.gst_state_code || (vendor.gstin ? gstStateFromGstin(vendor.gstin) : '')} onChange={(e) => { const [name, code] = (e.target.value || '').split('|'); setVendor({ ...vendor, gst_state_code: code || '', gst_state: name || '' }); }}>
                <option value="">Select state…</option>
                {INDIAN_STATES.map(([name, code]) => <option key={code} value={`${name}|${code}`}>{name} ({code})</option>)}
              </Select>
            </Field>
            <Field label="Contact Person"><Input value={vendor.contact_person || ''} onChange={(e) => setVendor({ ...vendor, contact_person: e.target.value })} /></Field>
            <Field label="Phone"><Input value={vendor.phone || ''} onChange={(e) => setVendor({ ...vendor, phone: e.target.value })} /></Field>
            <Field label="Email"><Input value={vendor.email || ''} onChange={(e) => setVendor({ ...vendor, email: e.target.value })} /></Field>
            <Field label="Alternate Phone"><Input value={vendor.alternate_phone || ''} onChange={(e) => setVendor({ ...vendor, alternate_phone: e.target.value })} /></Field>
            <Field label="Alternate Email"><Input value={vendor.alternate_email || ''} onChange={(e) => setVendor({ ...vendor, alternate_email: e.target.value })} /></Field>
            <Field label="Address" full><Input value={vendor.address || ''} onChange={(e) => setVendor({ ...vendor, address: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

function InvoicePreview({ inv, company, onClose }) {
  const cfg = company?.settings?.config || {};
  const b = company?.settings?.branding || {};
  const name = b.companyName || company?.name || '';
  const rate = Number(inv.gst_rate || inv.gst) || 0;
  const taxable = Number(inv.taxable_amount || inv.amount) || 0;
  const cgst = Number(inv.cgst) || 0;
  const sgst = Number(inv.sgst) || 0;
  const igst = Number(inv.igst) || 0;
  const gstTotal = cgst + sgst + igst;
  const lineItems = (inv.booking_ref || inv.unit_number)
    ? [{ Description: `Booking reference ${inv.booking_ref || ''}${inv.unit_number ? ' · Unit ' + inv.unit_number : ''}`, Amount: taxable }]
    : [{ Description: 'Booking / service charge', Amount: taxable }];

  return (
    <Modal title={inv.number} onClose={onClose} wide footer={<>
      <Button onClick={() => api.download(`/billing/invoices/${inv.id}/pdf`).catch((e) => toast(e.message, 'error'))}>Download PDF</Button>
    </>}>
      <div className="flex between items-start mb">
        <div className="flex gap items-center">
          {b.logo ? <img src={b.logo} alt="logo" style={{ height: 44, width: 44, objectFit: 'contain' }} /> : <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--brand)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700 }}>{name.slice(0, 1) || 'C'}</div>}
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--brand-dark)' }}>{name}</div>
            {b.tagline && <div className="small muted">{b.tagline}</div>}
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 12.5 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>TAX INVOICE</div>
          <div className="muted">Invoice No: {inv.number}</div>
          <div className="muted">Date: {fmtDate(inv.date)} · Due: {fmtDate(inv.due_date)}</div>
          <div className="muted">Status: <Badge tone={STATUS_TONES[inv.status] || 'gray'}>{inv.status}</Badge></div>
        </div>
      </div>

      <div className="flex between items-start mb" style={{ fontSize: 12.5, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <div>
          <div className="small muted" style={{ fontWeight: 700, marginBottom: 4 }}>BILL TO</div>
          <b>{inv.customer_name}</b>
          {inv.customer_address && <div className="small muted">{inv.customer_address}</div>}
          <div className="small muted">Phone: {inv.customer_phone || '—'}</div>
          <div className="small muted">{inv.customer_email || ''}</div>
          {inv.customer_gstin && <div className="small muted">GSTIN: {inv.customer_gstin}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="small muted" style={{ fontWeight: 700, marginBottom: 4 }}>SUPPLIER</div>
          {cfg.address && <div className="small">{cfg.address}</div>}
          <div className="small">{cfg.support?.phone && <>Phone: {cfg.support.phone}</>}{cfg.support?.email && <><br />{cfg.support.email}</>}</div>
          {cfg.website && <div className="small">{cfg.website}</div>}
          {cfg.gst && <div className="small">GSTIN: {cfg.gst}</div>}
          {cfg.rera && <div className="small">RERA: {cfg.rera}</div>}
        </div>
      </div>

      <Card pad={false}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', padding: '10px 14px', background: 'var(--bg-soft, #f6f8fb)', fontWeight: 700, fontSize: 12.5, borderBottom: '1px solid var(--border)' }}>
          <div>DESCRIPTION</div><div style={{ textAlign: 'right' }}>AMOUNT</div>
        </div>
        {lineItems.map((r, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
            <div>{r.Description}</div><div style={{ textAlign: 'right' }}>{fmtMoney(r.Amount)}</div>
          </div>
        ))}
        <div style={{ padding: '10px 14px', fontSize: 12.5 }}>
          {rate > 0 && <div className="flex between"><span>CGST</span><span>{fmtMoney(cgst)}</span></div>}
          {rate > 0 && (cgst + sgst > 0) && <div className="flex between"><span>SGST</span><span>{fmtMoney(sgst)}</span></div>}
          {rate > 0 && (cgst + sgst === 0) && <div className="flex between"><span>IGST</span><span>{fmtMoney(igst)}</span></div>}
          <div className="flex between" style={{ fontWeight: 800, fontSize: 14, borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
            <span>Total ({fmtMoney(taxable + gstTotal)} incl. GST)</span><span>{fmtMoney(taxable + gstTotal)}</span>
          </div>
        </div>
      </Card>

      {cfg.bank?.bank && (
        <div style={{ fontSize: 12.5, marginTop: 12 }}>
          <div className="small muted" style={{ fontWeight: 700 }}>PAYMENT DETAILS</div>
          <div className="small">Bank: {cfg.bank.bank} · A/c {cfg.bank.account} · IFSC {cfg.bank.ifsc}{cfg.bank.branch ? ' · ' + cfg.bank.branch : ''}</div>
        </div>
      )}

      <div className="small muted" style={{ marginTop: 12, fontSize: 11.5 }}>This is a system generated invoice. For queries contact {cfg.support?.phone || '—'} / {cfg.support?.email || '—'}.</div>
    </Modal>
  );
}
