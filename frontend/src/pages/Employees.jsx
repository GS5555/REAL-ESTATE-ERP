import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { api, fmtMoney, fmtDate } from '../api';
import { Card, Button, Badge, DataTable, Modal, Field, Input, Select, Tabs, Empty } from '../components/ui';
import { useToast } from '../components/ui';

export default function Employees() {
  const { can } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState('directory');
  const [employees, setEmployees] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [payroll, setPayroll] = useState(null);
  const [users, setUsers] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({});

  const loadAll = () => {
    api.get('/hr/employees').then(setEmployees).catch(() => {});
    api.get('/hr/attendance').then(setAttendance).catch(() => {});
    api.get('/hr/leaves').then(setLeaves).catch(() => {});
    api.get('/hr/payroll').then(setPayroll).catch(() => {});
    api.get('/users').then(setUsers).catch(() => {});
  };
  useEffect(() => { loadAll(); }, []);

  const save = async () => {
    if (!form.name) return toast('Name required', 'error');
    await api.post('/hr/employees', form);
    setModal(false); setForm({}); loadAll(); toast('Employee added', 'success');
  };

  const markAttendance = async (emp) => {
    await api.post('/hr/attendance', { employee_id: emp.id, date: new Date().toISOString().slice(0, 10), status: 'present' });
    toast('Attendance marked', 'success'); loadAll();
  };

  const tabs = [
    { key: 'directory', label: 'Directory' },
    { key: 'attendance', label: 'Attendance' },
    { key: 'leaves', label: 'Leaves' },
    { key: 'payroll', label: 'Payroll' }
  ];

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ fontSize: 20 }}>Human Resources</h2>
        <div className="grow" />
        {can('employee.create') && <Button variant="primary" onClick={() => setModal(true)}>+ Add Employee</Button>}
        {can('employee.export') && <Button onClick={() => api.download('/hr/export/csv').catch((e) => toast(e.message, 'error'))}>⤓ Export</Button>}
        {can('employee.export') && <Button onClick={() => api.shareFile('/hr/export/csv', null, 'Employees Export').then((m) => { if (m === 'downloaded') toast('Sharing not available — file downloaded', 'info'); }).catch((e) => toast(e.message, 'error'))}>Share</Button>}
      </div>
      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'directory' && (
        <Card pad={false}>
          {employees.length === 0 ? <Empty /> : (
            <DataTable
              rows={employees}
              columns={[
                { key: 'name', label: 'Employee', render: (r) => <div><b>{r.name}</b><div className="small muted">{r.email}</div></div> },
                { key: 'department', label: 'Department', render: (r) => <Badge tone="blue">{r.department}</Badge> },
                { key: 'designation', label: 'Designation' },
                { key: 'doj', label: 'Joined', render: (r) => fmtDate(r.doj) },
                { key: 'salary', label: 'Salary', render: (r) => can('employee.salary') ? fmtMoney(r.salary) : '•••' },
                { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'active' ? 'green' : 'gray'}>{r.status}</Badge> },
                { key: 'id', label: 'Mark Today', render: (r) => can('employee.attendance') ? <Button sm onClick={() => markAttendance(r)}>Present</Button> : null }
              ]}
            />
          )}
        </Card>
      )}

      {tab === 'attendance' && (
        <Card pad={false}>
          {attendance.length === 0 ? <Empty /> : (
            <DataTable
              rows={attendance}
              columns={[
                { key: 'employee_name', label: 'Employee' },
                { key: 'date', label: 'Date' },
                { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'present' ? 'green' : r.status === 'absent' ? 'red' : 'amber'}>{r.status}</Badge> },
                { key: 'checkin', label: 'Check-in', render: (r) => r.checkin ? fmtDate(r.checkin) : '—' },
                { key: 'checkout', label: 'Check-out', render: (r) => r.checkout ? fmtDate(r.checkout) : '—' }
              ]}
            />
          )}
        </Card>
      )}

      {tab === 'leaves' && (
        <Card pad={false}>
          {leaves.length === 0 ? <Empty /> : (
            <DataTable
              rows={leaves}
              columns={[
                { key: 'employee_name', label: 'Employee' },
                { key: 'from_date', label: 'From', render: (r) => fmtDate(r.from_date) },
                { key: 'to_date', label: 'To', render: (r) => fmtDate(r.to_date) },
                { key: 'type', label: 'Type' },
                { key: 'reason', label: 'Reason' },
                { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'approved' ? 'green' : r.status === 'pending' ? 'amber' : 'red'}>{r.status}</Badge> }
              ]}
            />
          )}
        </Card>
      )}

      {tab === 'payroll' && payroll && (
        <div className="grid c4">
          <Card><div className="s-label">Active Employees</div><div className="s-value">{payroll.employees}</div></Card>
          <Card><div className="s-label">Monthly Salary</div><div className="s-value">{fmtMoney(payroll.summary.totalSalary)}</div></Card>
          <Card><div className="s-label">PF @12%</div><div className="s-value">{fmtMoney(payroll.summary.pf)}</div></Card>
          <Card><div className="s-label">ESI + TDS</div><div className="s-value">{fmtMoney(payroll.summary.esi + payroll.summary.tds)}</div></Card>
        </div>
      )}

      {modal && (
        <Modal title="Add Employee" onClose={() => setModal(false)} footer={<>
          <Button onClick={() => setModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={save}>Save</Button>
        </>}>
          <div className="frm-grid">
            <Field label="Name"><Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Email"><Input value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Phone"><Input value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Department"><Select value={form.department || 'Sales'} onChange={(e) => setForm({ ...form, department: e.target.value })}>{['Sales', 'Marketing', 'Finance', 'HR', 'Operations', 'Legal', 'Accounts'].map((x) => <option key={x}>{x}</option>)}</Select></Field>
            <Field label="Designation"><Input value={form.designation || ''} onChange={(e) => setForm({ ...form, designation: e.target.value })} /></Field>
            <Field label="Date of Joining"><Input type="date" value={form.doj || ''} onChange={(e) => setForm({ ...form, doj: e.target.value })} /></Field>
            <Field label="Salary (₹/month)"><Input type="number" value={form.salary || ''} onChange={(e) => setForm({ ...form, salary: e.target.value })} /></Field>
            <Field label="PAN"><Input value={form.pan || ''} onChange={(e) => setForm({ ...form, pan: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
