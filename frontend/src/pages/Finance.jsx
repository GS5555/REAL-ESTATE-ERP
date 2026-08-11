import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { api, fmtMoney, fmtDate } from '../api';
import { Card, Button, Badge, DataTable, Modal, Field, Input, Select, Tabs, Stat, Empty } from '../components/ui';
import { Bars, Donut } from '../components/charts';
import { useToast } from '../components/ui';

export default function Finance() {
  const { can } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState('overview');
  const [summary, setSummary] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [payments, setPayments] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [partners, setPartners] = useState([]);
  const [commissions, setCommissions] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [expenseModal, setExpenseModal] = useState(false);
  const [expenseForm, setExpenseForm] = useState({});
  const [payModal, setPayModal] = useState(false);
  const [payForm, setPayForm] = useState({});
  const [modeFilter, setModeFilter] = useState('');

  const load = () => {
    api.get('/finance/summary').then(setSummary).catch(() => {});
    api.get('/finance/bookings').then(setBookings).catch(() => {});
    api.get('/finance/payments').then(setPayments).catch(() => {});
    api.get('/finance/invoices').then(setInvoices).catch(() => {});
    api.get('/finance/partners').then(setPartners).catch(() => {});
    api.get('/finance/commissions').then(setCommissions).catch(() => {});
    api.get('/finance/expenses').then(setExpenses).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const recordExpense = async () => {
    if (!expenseForm.amount) return toast('Amount required', 'error');
    await api.post('/finance/expenses', { ...expenseForm, date: expenseForm.date || new Date().toISOString().slice(0, 10) });
    setExpenseModal(false); setExpenseForm({}); load(); toast('Expense recorded', 'success');
  };

  const recordPayment = async () => {
    if (!payForm.amount) return toast('Amount required', 'error');
    const p = await api.post('/finance/payments', { ...payForm, date: new Date().toISOString().slice(0, 10) });
    setPayModal(false); setPayForm({}); load(); toast(`Receipt ${p.receipt_no} recorded`, 'success');
  };

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'bookings', label: 'Bookings' },
    { key: 'payments', label: 'Payments' },
    { key: 'expenses', label: 'Expenses' },
    { key: 'invoices', label: 'Invoices' },
    { key: 'partners', label: 'Partners' },
    { key: 'commissions', label: 'Commissions' }
  ];

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ fontSize: 20 }}>Finance & Accounts</h2>
        <div className="grow" />
        {can('finance.create') && <Button variant="primary" onClick={() => setPayModal(true)}>+ Record Payment</Button>}
        {can('finance.create') && <Button sm onClick={() => setExpenseModal(true)}>+ Expense</Button>}
        {can('report.export') && <Button onClick={() => api.download('/reports/export', { kind: 'payments' }).catch((e) => toast(e.message, 'error'))}>⤓ Export Payments</Button>}
        {can('report.export') && <Button onClick={() => api.shareFile('/reports/export', { kind: 'payments' }, 'Payments Report').then((m) => { if (m === 'downloaded') toast('Sharing not available — file downloaded', 'info'); }).catch((e) => toast(e.message, 'error'))}>Share</Button>}
      </div>
      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'overview' && summary && (
        <>
          <div className="grid c4 mb">
            <Stat label="Collected" value={fmtMoney(summary.collected)} color="var(--green)" />
            <Stat label="Outstanding" value={fmtMoney(summary.outstanding)} color="var(--red)" />
            <Stat label="Approved Expenses" value={fmtMoney(summary.expenses)} />
            <Stat label="Net Cash Flow" value={fmtMoney(summary.netCashflow)} color="var(--brand)" />
          </div>
          <div className="grid c2">
            <Card>
              <h3 className="mb">Monthly Collections <span className="small muted">(click to view)</span></h3>
              <Bars data={(summary.monthly || []).map((m) => ({ label: m.month, value: m.value }))} onClick={() => setTab('payments')} />
            </Card>
            <Card>
              <h3 className="mb">By Payment Mode <span className="small muted">(click to view)</span></h3>
              <Donut data={Object.entries(summary.byMode || {}).map(([label, value]) => ({ label, value }))} onClick={(e) => { setModeFilter(e.label); setTab('payments'); }} />
            </Card>
            <Card>
              <h3 className="mb">Monthly Expenses <span className="small muted">(click to view)</span></h3>
              <Bars data={(summary.monthlyExpenses || []).map((m) => ({ label: m.month, value: m.value }))} color="var(--red)" onClick={() => setTab('expenses')} />
            </Card>
            <Card>
              <h3 className="mb">Expenses by Category</h3>
              <Donut data={summary.expenseByCategory || []} onClick={(e) => setTab('expenses')} />
            </Card>
          </div>
        </>
      )}

      {tab === 'bookings' && (
        <Card pad={false}>
          {bookings.length === 0 ? <Empty /> : (
            <DataTable
              rows={bookings}
              columns={[
                { key: 'customer_name', label: 'Customer' },
                { key: 'unit_number', label: 'Unit' },
                { key: 'project_name', label: 'Project' },
                { key: 'total_value', label: 'Value', render: (r) => fmtMoney(r.total_value) },
                { key: 'token_amount', label: 'Token', render: (r) => fmtMoney(r.token_amount) },
                { key: 'status', label: 'Status', render: (r) => <Badge tone={['agreement', 'booking'].includes(r.status) ? 'green' : 'amber'}>{r.status.replace(/_/g, ' ')}</Badge> },
                { key: 'rera_ref', label: 'RERA' }
              ]}
            />
          )}
        </Card>
      )}

      {tab === 'payments' && (
        <Card pad={false}>
          <div className="toolbar" style={{ padding: 12 }}>
            <div className="small muted">Payment ledger</div>
            <div className="grow" />
            <Select value={modeFilter} onChange={(e) => setModeFilter(e.target.value)}>
              <option value="">All modes</option>
              {['cash', 'cheque', 'neft', 'upi', 'rtgs'].map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          </div>
          {payments.length === 0 ? <Empty /> : (
            <DataTable
              rows={modeFilter ? payments.filter((p) => p.mode === modeFilter) : payments}
              columns={[
                { key: 'receipt_no', label: 'Receipt' },
                { key: 'customer_name', label: 'Customer', render: (r) => r.customer_name || '—' },
                { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) },
                { key: 'amount', label: 'Amount', render: (r) => fmtMoney(r.amount) },
                { key: 'mode', label: 'Mode', render: (r) => <Badge tone="gray">{r.mode}</Badge> },
                { key: 'status', label: 'Status', render: (r) => <Badge tone="green">{r.status}</Badge> }
              ]}
            />
          )}
        </Card>
      )}

      {tab === 'expenses' && (
        <Card pad={false}>
          <div className="toolbar" style={{ padding: 12 }}>
            <div className="small muted">Expense ledger</div>
            <div className="grow" />
          </div>
          {expenses.length === 0 ? <Empty /> : (
            <DataTable
              rows={expenses}
              columns={[
                { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) },
                { key: 'category', label: 'Category', render: (r) => <Badge tone="gray">{r.category || 'other'}</Badge> },
                { key: 'amount', label: 'Amount', render: (r) => fmtMoney(r.amount) },
                { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'approved' ? 'green' : 'amber'}>{r.status}</Badge> },
                { key: 'notes', label: 'Notes', render: (r) => r.notes || '—' }
              ]}
            />
          )}
        </Card>
      )}

      {tab === 'invoices' && (
        <Card pad={false}>
          {invoices.length === 0 ? <Empty /> : (
            <DataTable
              rows={invoices}
              columns={[
                { key: 'number', label: 'Invoice' },
                { key: 'customer_name', label: 'Customer' },
                { key: 'amount', label: 'Amount', render: (r) => fmtMoney(r.amount) },
                { key: 'gst', label: 'GST', render: (r) => fmtMoney(r.gst) },
                { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'paid' ? 'green' : r.status === 'overdue' ? 'red' : 'amber'}>{r.status}</Badge> },
                { key: 'due_date', label: 'Due', render: (r) => fmtDate(r.due_date) }
              ]}
            />
          )}
        </Card>
      )}

      {tab === 'partners' && (
        <Card pad={false}>
          {partners.length === 0 ? <Empty /> : (
            <DataTable
              rows={partners}
              columns={[
                { key: 'name', label: 'Partner', render: (r) => <div><b>{r.name}</b><div className="small muted">{r.company}</div></div> },
                { key: 'phone', label: 'Phone' },
                { key: 'commission_pct', label: 'Commission %', render: (r) => <Badge tone="brand">{r.commission_pct}%</Badge> },
                { key: 'pending_comm', label: 'Pending', render: (r) => fmtMoney(r.pending_comm) },
                { key: 'total_comm', label: 'Total', render: (r) => fmtMoney(r.total_comm) }
              ]}
            />
          )}
        </Card>
      )}

      {tab === 'commissions' && commissions && (
        <>
          <div className="grid c2 mb">
            <Stat label="Pending Commission" value={fmtMoney(commissions.pending)} color="var(--amber)" />
            <Stat label="Paid Commission" value={fmtMoney(commissions.paid)} color="var(--green)" />
          </div>
          <Card pad={false}>
            {commissions.rows.length === 0 ? <Empty /> : (
              <DataTable
                rows={commissions.rows}
                columns={[
                  { key: 'partner_name', label: 'Partner' },
                  { key: 'unit_number', label: 'Unit' },
                  { key: 'amount', label: 'Amount', render: (r) => fmtMoney(r.amount) },
                  { key: 'pct', label: '%' },
                  { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'paid' ? 'green' : 'amber'}>{r.status}</Badge> }
                ]}
              />
            )}
          </Card>
        </>
      )}

      {expenseModal && (
        <Modal title="Record Expense" onClose={() => setExpenseModal(false)} footer={<>
          <Button onClick={() => setExpenseModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={recordExpense}>Save</Button>
        </>}>
          <div className="frm-grid">
            <Field label="Amount (₹)"><Input type="number" value={expenseForm.amount || ''} onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })} /></Field>
            <Field label="Category"><Select value={expenseForm.category || 'operational'} onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })}><option>operational</option><option>marketing</option><option>salary</option><option>travel</option><option>office</option><option>other</option></Select></Field>
            <Field label="Date"><Input type="date" value={expenseForm.date || new Date().toISOString().slice(0, 10)} onChange={(e) => setExpenseForm({ ...expenseForm, date: e.target.value })} /></Field>
            <Field label="Notes"><Input value={expenseForm.notes || ''} onChange={(e) => setExpenseForm({ ...expenseForm, notes: e.target.value })} /></Field>
          </div>
        </Modal>
      )}

      {payModal && (
        <Modal title="Record Payment" onClose={() => setPayModal(false)} footer={<>
          <Button onClick={() => setPayModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={recordPayment}>Save</Button>
        </>}>
          <div className="frm-grid">
            <Field label="Amount (₹)"><Input type="number" value={payForm.amount || ''} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} /></Field>
            <Field label="Mode"><Select value={payForm.mode || 'cash'} onChange={(e) => setPayForm({ ...payForm, mode: e.target.value })}><option>cash</option><option>cheque</option><option>neft</option><option>upi</option><option>rtgs</option></Select></Field>
            <Field label="Reference"><Input value={payForm.reference || ''} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} /></Field>
            <Field label="Notes"><Input value={payForm.notes || ''} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
