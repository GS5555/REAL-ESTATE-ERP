import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useStore } from '../store';
import { api, fmtMoney, fmtDate } from '../api';
import { Card, Button, Badge, Field, Input, Select, Textarea, DataTable, Tabs, Stat, Empty, Modal } from '../components/ui';
import { useToast } from '../components/ui';

const BANKS = ['HDFC', 'SBI', 'ICICI', 'Axis', 'Kotak', 'LIC Housing', 'PNB Housing', 'Bajaj Finserv', 'Tata Capital'];
const STATUS_TONES = { approved: 'green', sanctioned: 'green', disbursed: 'purple', rejected: 'red', processing: 'blue', documents: 'amber', application: 'gray' };
const STATUSES = ['application', 'documents', 'processing', 'approved', 'sanctioned', 'disbursed', 'rejected'];
const EMPTY_EDIT = { status: 'application', bank: '', loan_amount: '', interest_rate: '', commission_amount: '', commission_status: 'pending', payment_due_date: '', notes: '' };
const PAYOUT_TIMELINES = ['On sanction', 'On disbursal', '30 days post disbursal', '60 days post disbursal', 'Quarterly'];

export default function Loans() {
  const { can } = useStore();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(() => (searchParams.get('convert') ? 'convert' : 'pipeline'));
  const [rows, setRows] = useState([]);
  const [bank, setBank] = useState('');
  const [status, setStatus] = useState('');
  const [ltype, setLtype] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState(EMPTY_EDIT);
  const [summary, setSummary] = useState(null);
  const [byBank, setByBank] = useState([]);
  const [comm, setComm] = useState(null);
  const [conv, setConv] = useState({ customer_name: '', customer_phone: '', property_desc: '', bank_id: '', dsa_id: '', contact_person: '', referrer_id: '', loan_amount: '', interest_rate: '', rate_offered: '', payout_timeline: '' });
  const [master, setMaster] = useState(null);
  const [bankModal, setBankModal] = useState(false);
  const [bankForm, setBankForm] = useState({ name: '', rate_offered: '', contact_person: '' });
  const [dsaModal, setDsaModal] = useState(false);
  const [dsaForm, setDsaForm] = useState({ name: '', contact_person: '', contact_phone: '', bank_rates: [] });
  const [commRates, setCommRates] = useState({});
  const [referrals, setReferrals] = useState([]);

  const canViewComm = can('commission.view');
  const canEditComm = can('commission.edit');

  const loadPipeline = () => api.get('/loans', { bank, status, loan_type: ltype, from, to }).then(setRows).catch(() => {});
  useEffect(() => { loadPipeline(); }, [bank, status, ltype, from, to]);

  const loadMaster = () => {
    api.get('/loans/master').then((m) => {
      setMaster(m);
      const rates = {};
      (m.employees || []).forEach((e) => { rates[e.id] = e.commission_rate || 0; });
      setCommRates(rates);
    }).catch(() => {});
  };
  useEffect(() => { loadMaster(); }, []);
  useEffect(() => {
    const customerId = searchParams.get('convert');
    const leadId = searchParams.get('convertLead');
    if (customerId) {
      api.get(`/customers/${customerId}`).then((d) => {
        const c = d.customer;
        setConv((v) => ({ ...v, customer_id: customerId, customer_name: c.name, customer_phone: c.phone, customer_email: c.email, property_desc: c.address || '' }));
      }).catch(() => {});
    } else if (leadId) {
      api.get(`/leads/${leadId}`).then((d) => {
        const l = d.lead;
        setConv((v) => ({ ...v, lead_id: leadId, customer_name: l.name, customer_phone: l.phone, customer_email: l.email, property_desc: l.requirement || '' }));
      }).catch(() => {});
    }
  }, [searchParams]);

  const loadDash = () => {
    api.get('/loans/dashboard/summary').then(setSummary).catch(() => {});
    api.get('/loans/dashboard/by-bank').then(setByBank).catch(() => {});
    api.get('/loans/dashboard/commissions').then(setComm).catch(() => {});
  };
  useEffect(() => { if (tab === 'dashboard') loadDash(); }, [tab]);
  useEffect(() => { if (tab === 'referrals') api.get('/loans/referrals').then(setReferrals).catch(() => {}); }, [tab]);

  const openEdit = (r) => { setEdit(r); setForm({ ...EMPTY_EDIT, ...r }); };

  const saveEdit = async () => {
    try {
      await api.patch(`/loans/${edit.id}`, {
        status: form.status, bank_id: form.bank_id || '', dsa_id: form.dsa_id || '',
        contact_person: form.contact_person, referrer_id: form.referrer_id || '',
        rate_offered: Number(form.rate_offered) || 0, payout_timeline: form.payout_timeline || '',
        loan_amount: Number(form.loan_amount) || 0,
        interest_rate: Number(form.interest_rate) || 0, commission_amount: Number(form.commission_amount) || 0,
        commission_status: form.commission_status, payment_due_date: form.payment_due_date || null, notes: form.notes
      });
      setEdit(null); loadPipeline(); toast('Loan updated', 'success');
    } catch (e) { toast(e.message, 'error'); }
  };

  const convert = async () => {
    if (!conv.customer_name) return toast('Customer name required', 'error');
    try {
      await api.post('/loans/convert', { ...conv, loan_amount: Number(conv.loan_amount) || 0, interest_rate: Number(conv.interest_rate) || 0, rate_offered: Number(conv.rate_offered) || 0 });
      setConv({ customer_name: '', customer_phone: '', customer_email: '', property_desc: '', bank_id: '', dsa_id: '', contact_person: '', referrer_id: '', loan_amount: '', interest_rate: '', rate_offered: '', payout_timeline: '' });
      loadPipeline(); toast('Loan lead created', 'success');
      window.history.replaceState({}, '', '/loans');
    } catch (e) { toast(e.message, 'error'); }
  };

  const saveBank = async () => {
    if (!bankForm.name) return toast('Bank name required', 'error');
    if (bankForm.id) await api.patch(`/loans/master/banks/${bankForm.id}`, bankForm);
    else await api.post('/loans/master/banks', bankForm);
    setBankModal(false); setBankForm({ name: '', rate_offered: '', contact_person: '' }); loadMaster(); toast('Bank saved', 'success');
  };

  const saveDsa = async () => {
    if (!dsaForm.name) return toast('DSA name required', 'error');
    const payload = { ...dsaForm, bank_rates: dsaForm.bank_rates };
    if (dsaForm.id) await api.patch(`/loans/master/dsas/${dsaForm.id}`, payload);
    else await api.post('/loans/master/dsas', payload);
    setDsaModal(false); setDsaForm({ name: '', contact_person: '', contact_phone: '', bank_rates: [] }); loadMaster(); toast('DSA saved', 'success');
  };

  const saveCommRates = async () => {
    const rates = (master?.employees || []).map((e) => ({ user_id: e.id, commission_rate: Number(commRates[e.id]) || 0 }));
    await api.put('/loans/master/employee-commission', { rates });
    toast('Commission rates saved', 'success'); loadMaster();
  };

  const openDsaEdit = (d) => {
    setDsaForm({
      id: d.id, name: d.name, contact_person: d.contact_person, contact_phone: d.contact_phone,
      bank_rates: (master?.banks || []).map((b) => {
        const existing = (d.banks || []).find((x) => x.bank_id === b.id);
        return { bank_id: b.id, checked: !!existing, rate_offered: existing?.rate_offered || b.rate_offered || 0 };
      })
    });
    setDsaModal(true);
  };

  const setDsaBank = (bankId, patch) => {
    setDsaForm((f) => ({ ...f, bank_rates: f.bank_rates.map((b) => b.bank_id === bankId ? { ...b, ...patch } : b) }));
  };

  const tabs = [
    { key: 'pipeline', label: 'Pipeline' },
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'convert', label: 'Add Lead / Referral' },
    { key: 'referrals', label: 'Referrals' },
    { key: 'masters', label: 'Banks & DSAs' }
  ];

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ fontSize: 20 }}>Home Loans</h2>
        <div className="grow" />
        {can('loan.create') && <Button variant="primary" onClick={() => setTab('convert')}>+ Add Lead / Referral</Button>}
        {can('loan.export') && <Button onClick={() => api.download('/loans/export/csv').catch((e) => toast(e.message, 'error'))}>⤓ Export</Button>}
      </div>
      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'pipeline' && (
        <>
          <div className="toolbar">
            <Select value={bank} onChange={(e) => setBank(e.target.value)} style={{ width: 160 }}>
              <option value="">All banks</option>
              {(master?.banks || BANKS.map((b) => ({ name: b }))).map((b, i) => <option key={i} value={b.name || b}>{b.name || b}</option>)}
            </Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 160 }}>
              <option value="">All statuses</option>
              {['submitted', 'processing', 'approved', 'disbursed', 'rejected', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Input type="date" title="From" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input type="date" title="To" value={to} onChange={(e) => setTo(e.target.value)} />
            {(status || ltype || from || to) && <Button sm variant="ghost" onClick={() => { setStatus(''); setLtype(''); setFrom(''); setTo(''); }}>✕</Button>}
          </div>
          <Card pad={false}>
            {rows.length === 0 ? <Empty text="No loans found" /> : (
              <DataTable
                rows={rows}
                columns={[
                  { key: 'customer_name', label: 'Customer', render: (r) => <div><b>{r.customer_name}</b><div className="small muted">{r.customer_phone}</div></div> },
                  { key: 'bank', label: 'Bank', render: (r) => <Badge tone="gray">{r.bank || 'Unassigned'}</Badge> },
                  { key: 'dsa_agent', label: 'DSA', render: (r) => <div>{r.dsa_agent || '—'}{r.contact_person && <div className="small muted">{r.contact_person}</div>}</div> },
                  { key: 'loan_amount', label: 'Loan', render: (r) => fmtMoney(r.loan_amount) },
                  { key: 'rate_offered', label: 'Rate to us', render: (r) => canViewComm ? `${r.rate_offered ?? 0}%` : '•••' },
                  { key: 'referrer_name', label: 'Referrer', render: (r) => r.referrer_name || '—' },
                  { key: 'status', label: 'Status', render: (r) => <Badge tone={STATUS_TONES[r.status] || 'gray'}>{r.statusLabel || r.status}</Badge> },
                  ...(canViewComm ? [{ key: 'commission_amount', label: 'Commission', render: (r) => <div>{fmtMoney(r.commission_amount)}<div className="small muted">{r.commission_status}</div></div> }] : []),
                  { key: 'action', label: '', render: (r) => can('loan.edit') && <Button sm ghost onClick={() => openEdit(r)}>Edit</Button> }
                ]}
              />
            )}
          </Card>
        </>
      )}

      {tab === 'dashboard' && summary && (
        <>
          <div className="grid c4 mb">
            <Stat label="Total Loans" value={summary.total || 0} />
            <Stat label="Approved" value={summary.approved || 0} color="var(--green)" />
            <Stat label="Active / In Progress" value={summary.active || 0} color="var(--blue, #2563eb)" />
            <Stat label="Conversion Rate" value={`${summary.conversionRate || 0}%`} color="var(--brand)" />
          </div>
          <div className="grid c2 mb">
            <Card>
              <h3 className="mb">By Bank</h3>
              {byBank.length === 0 ? <Empty /> : (
                <DataTable
                  rows={byBank}
                  columns={[
                    { key: 'bank', label: 'Bank' },
                    { key: 'total', label: 'Total' },
                    { key: 'approvals', label: 'Approved' },
                    { key: 'approvalRate', label: 'Rate', render: (r) => `${r.approvalRate || 0}%` }
                  ]}
                />
              )}
            </Card>
            <Card>
              <h3 className="mb">Commissions</h3>
              {comm && (
                <div className="grid c3">
                  <Stat label="Earned" value={canViewComm ? fmtMoney(comm.earned) : '••••'} />
                  <Stat label="Pending" value={canViewComm ? fmtMoney(comm.pending) : '••••'} color="var(--amber)" />
                  <Stat label="Paid" value={canViewComm ? fmtMoney(comm.paid) : '••••'} color="var(--green)" />
                </div>
              )}
              {!canViewComm && <div className="small muted mt">Commission details are restricted. Ask your admin for <b>View Commissions</b> rights.</div>}
            </Card>
          </div>
          <Card>
            <h3 className="mb">Pipeline</h3>
            <div className="flex gap" style={{ flexWrap: 'wrap' }}>
              {(summary.pipeline || []).map((p) => <Badge key={p.label} tone="blue">{p.label}: {p.count}</Badge>)}
            </div>
          </Card>
        </>
      )}

      {tab === 'convert' && (
        <Card style={{ maxWidth: 760 }}>
          <h3 className="mb">Add Home Loan Lead / Referral</h3>
          <div className="small muted mb">Add a customer or a personal referral from any employee. If a referral is selected, the employee's commission % is auto-applied and credited on payout.</div>
          <div className="frm-grid">
            <Field label="Customer name"><Input value={conv.customer_name} onChange={(e) => setConv({ ...conv, customer_name: e.target.value })} /></Field>
            <Field label="Customer phone"><Input value={conv.customer_phone} onChange={(e) => setConv({ ...conv, customer_phone: e.target.value })} /></Field>
            <Field label="Property description" full><Textarea value={conv.property_desc} onChange={(e) => setConv({ ...conv, property_desc: e.target.value })} /></Field>
            <Field label="Bank">
              <Select value={conv.bank_id} onChange={(e) => {
                const bank = (master?.banks || []).find((b) => b.id === e.target.value);
                setConv({ ...conv, bank_id: e.target.value, rate_offered: bank?.rate_offered || '' });
              }}>
                <option value="">— Select bank —</option>
                {(master?.banks || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
            <Field label="DSA (channel partner)">
              <Select value={conv.dsa_id} onChange={(e) => {
                const dsa = (master?.dsas || []).find((d) => d.id === e.target.value);
                const bankRate = (dsa?.banks || []).find((br) => br.bank_id === conv.bank_id);
                setConv({ ...conv, dsa_id: e.target.value, rate_offered: bankRate?.rate_offered ?? conv.rate_offered });
              }}>
                <option value="">— Select DSA —</option>
                {(master?.dsas || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </Field>
            <Field label="Bank / DSA contact person"><Input value={conv.contact_person} onChange={(e) => setConv({ ...conv, contact_person: e.target.value })} placeholder="e.g. Priya Sharma (Relationship Mgr)" /></Field>
            <Field label="Referral employee (gets commission)">
              <Select value={conv.referrer_id} onChange={(e) => setConv({ ...conv, referrer_id: e.target.value })}>
                <option value="">— None —</option>
                {(master?.employees || []).map((u) => <option key={u.id} value={u.id}>{u.name} {canViewComm ? `(${u.commission_rate || 0}%)` : ''}</option>)}
              </Select>
            </Field>
            <Field label="Loan amount (₹)"><Input type="number" value={conv.loan_amount} onChange={(e) => setConv({ ...conv, loan_amount: e.target.value })} /></Field>
            <Field label="Interest rate (%)"><Input type="number" value={conv.interest_rate} onChange={(e) => setConv({ ...conv, interest_rate: e.target.value })} /></Field>
            <Field label="Commission offered to us (%)">
              <Input type="number" value={conv.rate_offered} onChange={(e) => setConv({ ...conv, rate_offered: e.target.value })} placeholder="auto-filled from bank / DSA" />
            </Field>
            <Field label="Conversion payout timeline">
              <Select value={conv.payout_timeline} onChange={(e) => setConv({ ...conv, payout_timeline: e.target.value })}>
                <option value="">— Select —</option>
                {PAYOUT_TIMELINES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Field>
            <div className="full flex gap" style={{ alignItems: 'flex-end' }}>
              <Button variant="primary" onClick={convert}>Create Loan Lead</Button>
            </div>
          </div>
        </Card>
      )}

      {tab === 'referrals' && (
        <Card pad={false}>
          {referrals.length === 0 ? <Empty text="No referral commissions yet" /> : (
            <DataTable
              rows={referrals}
              columns={[
                { key: 'user_name', label: 'Employee', render: (r) => <b>{r.user_name}</b> },
                { key: 'loan_customer', label: 'Loan Customer', render: (r) => r.loan_customer || '—' },
                { key: 'commission_rate', label: 'Rate', render: (r) => canViewComm ? `${r.commission_rate}%` : '•••' },
                { key: 'commission_amount', label: 'Commission', render: (r) => canViewComm ? fmtMoney(r.commission_amount) : '•••' },
                { key: 'commission_status', label: 'Status', render: (r) => <Badge tone={r.commission_status === 'paid' ? 'green' : 'amber'}>{r.commission_status}</Badge> },
                { key: 'payout_at', label: 'Payout', render: (r) => r.payout_at || '—' },
                { key: 'created_at', label: 'Created', render: (r) => fmtDate(r.created_at) }
              ]}
            />
          )}
        </Card>
      )}

      {tab === 'masters' && (
        <>
          <div className="grid c2 mb">
            <Card>
              <div className="flex between mb">
                <h3>Banks & Rates (offered to us)</h3>
                {canEditComm && <Button sm variant="primary" onClick={() => { setBankForm({ name: '', rate_offered: '', contact_person: '' }); setBankModal(true); }}>+ Add Bank</Button>}
              </div>
              {(master?.banks || []).length === 0 ? <Empty text="No banks configured" /> : (
                <DataTable
                  rows={master.banks}
                  columns={[
                    { key: 'name', label: 'Bank', render: (r) => <b>{r.name}</b> },
                    { key: 'rate_offered', label: 'Rate to us', render: (r) => canViewComm ? `${r.rate_offered || 0}%` : '•••' },
                    { key: 'contact_person', label: 'Contact', render: (r) => r.contact_person || '—' },
                    ...(canEditComm ? [{ key: 'action', label: '', render: (r) => <Button sm ghost onClick={() => { setBankForm({ ...r }); setBankModal(true); }}>Edit</Button> }] : [])
                  ]}
                />
              )}
            </Card>
            <Card>
              <div className="flex between mb">
                <h3>DSAs (multi-bank rates)</h3>
                {canEditComm && <Button sm variant="primary" onClick={() => { setDsaForm({ name: '', contact_person: '', contact_phone: '', bank_rates: (master?.banks || []).map((b) => ({ bank_id: b.id, checked: false, rate_offered: b.rate_offered || 0 })) }); setDsaModal(true); }}>+ Add DSA</Button>}
              </div>
              {(master?.dsas || []).length === 0 ? <Empty text="No DSAs configured" /> : (
                <DataTable
                  rows={master.dsas}
                  columns={[
                    { key: 'name', label: 'DSA', render: (r) => <b>{r.name}</b> },
                    { key: 'contact_person', label: 'Contact', render: (r) => r.contact_person || '—' },
                    { key: 'banks', label: 'Banks offered', render: (r) => (r.banks || []).map((b) => <Badge key={b.bank_id} tone="blue" style={{ marginRight: 4, marginBottom: 4 }}>{b.bank_name} {canViewComm ? `${b.rate_offered}%` : ''}</Badge>) },
                    ...(canEditComm ? [{ key: 'action', label: '', render: (r) => <Button sm ghost onClick={() => openDsaEdit(r)}>Edit</Button> }] : [])
                  ]}
                />
              )}
            </Card>
          </div>
          <Card>
            <div className="flex between mb">
              <h3>Employee Commission Rates</h3>
              {canEditComm && <Button sm variant="primary" onClick={saveCommRates}>Save Rates</Button>}
            </div>
            <div className="small muted mb">Defined by admin. Applied automatically when an employee refers a home loan. Referral % is only visible to users granted <b>View Commissions</b> rights.</div>
            {(master?.employees || []).length === 0 ? <Empty text="No employees" /> : (
              <DataTable
                rows={master.employees}
                columns={[
                  { key: 'name', label: 'Employee', render: (r) => <b>{r.name}</b> },
                  { key: 'role', label: 'Role', render: (r) => <Badge tone="gray">{r.role.replace(/_/g, ' ')}</Badge> },
                  { key: 'commission_rate', label: 'Commission %', render: (r) => canEditComm
                    ? <Input type="number" style={{ width: 90 }} value={commRates[r.id] || ''} onChange={(e) => setCommRates((c) => ({ ...c, [r.id]: e.target.value }))} />
                    : (canViewComm ? `${r.commission_rate || 0}%` : '•••') }
                ]}
              />
            )}
          </Card>
        </>
      )}

      {edit && (
        <Modal title={`Edit Loan — ${edit.customer_name}`} onClose={() => setEdit(null)} wide footer={<>
          <Button onClick={() => setEdit(null)}>Cancel</Button>
          <Button variant="primary" onClick={saveEdit}>Save</Button>
        </>}>
          <div className="frm-grid">
            <Field label="Status"><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
            <Field label="Bank"><Select value={form.bank_id || ''} onChange={(e) => setForm({ ...form, bank_id: e.target.value })}><option value="">Unassigned</option>{(master?.banks || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
            <Field label="DSA"><Select value={form.dsa_id || ''} onChange={(e) => setForm({ ...form, dsa_id: e.target.value })}><option value="">Unassigned</option>{(master?.dsas || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
            <Field label="Bank / DSA contact person"><Input value={form.contact_person || ''} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></Field>
            <Field label="Loan amount (₹)"><Input type="number" value={form.loan_amount} onChange={(e) => setForm({ ...form, loan_amount: e.target.value })} /></Field>
            <Field label="Interest rate (%)"><Input type="number" value={form.interest_rate} onChange={(e) => setForm({ ...form, interest_rate: e.target.value })} /></Field>
            {canEditComm && <Field label="Commission offered to us (%)"><Input type="number" value={form.rate_offered} onChange={(e) => setForm({ ...form, rate_offered: e.target.value })} /></Field>}
            {canEditComm && <Field label="Commission (₹)"><Input type="number" value={form.commission_amount} onChange={(e) => setForm({ ...form, commission_amount: e.target.value })} /></Field>}
            {canEditComm && <Field label="Commission status"><Select value={form.commission_status} onChange={(e) => setForm({ ...form, commission_status: e.target.value })}><option>pending</option><option>paid</option></Select></Field>}
            <Field label="Referral employee"><Select value={form.referrer_id || ''} onChange={(e) => setForm({ ...form, referrer_id: e.target.value })}><option value="">— None —</option>{(master?.employees || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
            <Field label="Payout timeline"><Select value={form.payout_timeline || ''} onChange={(e) => setForm({ ...form, payout_timeline: e.target.value })}><option value="">—</option>{PAYOUT_TIMELINES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
            <Field label="Payment due"><Input type="date" value={form.payment_due_date || ''} onChange={(e) => setForm({ ...form, payment_due_date: e.target.value })} /></Field>
            <Field label="Notes" full><Textarea value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
        </Modal>
      )}

      {bankModal && (
        <Modal title={bankForm.id ? 'Edit Bank' : 'Add Bank'} onClose={() => setBankModal(false)} footer={<>
          <Button onClick={() => setBankModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={saveBank}>Save</Button>
        </>}>
          <div className="frm-grid">
            <Field label="Bank name"><Input value={bankForm.name} onChange={(e) => setBankForm({ ...bankForm, name: e.target.value })} /></Field>
            <Field label="Commission offered to us (%)"><Input type="number" value={bankForm.rate_offered} onChange={(e) => setBankForm({ ...bankForm, rate_offered: e.target.value })} /></Field>
            <Field label="Contact person" full><Input value={bankForm.contact_person} onChange={(e) => setBankForm({ ...bankForm, contact_person: e.target.value })} /></Field>
          </div>
        </Modal>
      )}

      {dsaModal && (
        <Modal title={dsaForm.id ? 'Edit DSA' : 'Add DSA'} onClose={() => setDsaModal(false)} wide footer={<>
          <Button onClick={() => setDsaModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={saveDsa}>Save</Button>
        </>}>
          <div className="frm-grid">
            <Field label="DSA name"><Input value={dsaForm.name} onChange={(e) => setDsaForm({ ...dsaForm, name: e.target.value })} /></Field>
            <Field label="Contact person"><Input value={dsaForm.contact_person} onChange={(e) => setDsaForm({ ...dsaForm, contact_person: e.target.value })} /></Field>
            <Field label="Contact phone"><Input value={dsaForm.contact_phone} onChange={(e) => setDsaForm({ ...dsaForm, contact_phone: e.target.value })} /></Field>
          </div>
          <div className="mt">
            <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: 'block' }}>Banks this DSA offers (tick + % for each bank)</label>
            <div className="small muted mb">A DSA can have a different commission % with every bank.</div>
            {(dsaForm.bank_rates || []).map((br) => (
              <div key={br.bank_id} className="flex gap items-center" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <input type="checkbox" checked={br.checked} onChange={(e) => setDsaBank(br.bank_id, { checked: e.target.checked })} />
                <b style={{ width: 140 }}>{(master?.banks || []).find((b) => b.id === br.bank_id)?.name}</b>
                <Input type="number" style={{ width: 110 }} value={br.rate_offered} onChange={(e) => setDsaBank(br.bank_id, { rate_offered: e.target.value })} />
                <span className="small muted">% to us</span>
              </div>
            ))}
            {(dsaForm.bank_rates || []).length === 0 && <div className="small muted">Add banks first in the Banks section.</div>}
          </div>
        </Modal>
      )}
    </div>
  );
}
