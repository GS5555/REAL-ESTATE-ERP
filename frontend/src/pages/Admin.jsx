import { useEffect, useState } from 'react';
import { api, fmtDate } from '../api';
import { Card, Button, Badge, DataTable, Field, Input, Select, Modal, Tabs, Stat, Empty, Switch } from '../components/ui';
import { useToast } from '../components/ui';

const FLAG_OPTIONS = ['ai', 'voice', 'multilang', 'offline', 'qrcode', 'portal', 'callrecord', 'digital_sign', 'kyc', 'biometric'];

export default function Admin() {
  const toast = useToast();
  const [tab, setTab] = useState('companies');
  const [companies, setCompanies] = useState([]);
  const [flags, setFlags] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({});

  const load = () => {
    api.get('/admin/companies').then(setCompanies).catch(() => {});
    api.get('/admin/feature-flags').then(setFlags).catch(() => {});
    api.get('/admin/tickets').then(setTickets).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.name) return toast('Company name required', 'error');
    await api.post('/admin/companies', form);
    setModal(false); setForm({}); load(); toast('Company provisioned', 'success');
  };

  const setStatus = async (c, status) => {
    await api.patch(`/admin/companies/${c.id}`, { status });
    load(); toast(`${c.name} ${status}`, 'success');
  };

  const toggleFlag = async (cid, key) => {
    const cur = flags.find((f) => f.company_id === cid && f.key === key);
    await api.post('/admin/feature-flags', { company_id: cid, key, enabled: cur?.enabled ? false : true });
    load();
  };

  const updateTicket = async (t, status, resolution) => {
    await api.patch(`/admin/tickets/${t.id}`, { status, resolution: status === 'resolved' ? resolution || 'Resolved by platform team' : t.resolution });
    load(); toast('Ticket updated', 'success');
  };

  const tabs = [
    { key: 'companies', label: 'Companies' },
    { key: 'licenses', label: 'Licenses' },
    { key: 'flags', label: 'Feature Flags' },
    { key: 'tickets', label: 'Global Tickets' }
  ];

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ fontSize: 20 }}>Developer Panel <Badge tone="purple">Super Admin</Badge></h2>
        <div className="grow" />
        <Button variant="primary" onClick={() => setModal(true)}>+ Provision Company</Button>
      </div>
      <div className="grid c4 mb">
        <Stat label="Companies" value={companies.length} />
        <Stat label="Active" value={companies.filter((c) => c.status === 'active').length} color="var(--green)" />
        <Stat label="Suspended" value={companies.filter((c) => c.status !== 'active').length} color="var(--red)" />
        <Stat label="Open Tickets" value={tickets.filter((t) => t.status === 'open').length} color="var(--amber)" />
      </div>
      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'companies' && (
        <Card pad={false}>
          {companies.length === 0 ? <Empty /> : (
            <DataTable
              rows={companies}
              columns={[
                { key: 'name', label: 'Company', render: (r) => <div><b>{r.name}</b><div className="small muted">slug: {r.slug}</div></div> },
                { key: 'plan', label: 'Plan', render: (r) => <Badge tone="brand">{r.plan}</Badge> },
                { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'active' ? 'green' : 'red'}>{r.status}</Badge> },
                { key: 'license_key', label: 'License' },
                { key: 'billing_email', label: 'Billing Email' },
                { key: 'expires_at', label: 'Expires', render: (r) => fmtDate(r.expires_at) },
                { key: 'id', label: 'Actions', render: (r) => (
                  <div className="flex gap">
                    {r.status === 'active'
                      ? <Button sm variant="danger" onClick={() => setStatus(r, 'suspended')}>Suspend</Button>
                      : <Button sm variant="success" onClick={() => setStatus(r, 'active')}>Activate</Button>}
                  </div>
                ) }
              ]}
            />
          )}
        </Card>
      )}

      {tab === 'licenses' && (
        <Card>
          <h3 className="mb">License Management</h3>
          <div className="small muted mb">Per-company licenses, plans and renewal dates are managed centrally. Upgrade a plan to unlock more seats and modules.</div>
          {companies.map((c) => (
            <div key={c.id} className="flex between items-center" style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
              <div><b>{c.name}</b><div className="small muted">{c.license_key}</div></div>
              <div className="flex gap items-center">
                <Select value={c.plan} onChange={async (e) => { await api.patch(`/admin/companies/${c.id}`, { plan: e.target.value }); load(); toast('Plan updated', 'success'); }}>
                  <option value="basic">Basic</option><option value="standard">Standard</option><option value="enterprise">Enterprise</option>
                </Select>
              </div>
            </div>
          ))}
        </Card>
      )}

      {tab === 'flags' && (
        <Card>
          <h3 className="mb">Remote Feature Toggles</h3>
          <div className="small muted mb">Enable/disable modules per company without deploying code.</div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr><th>Company</th>{FLAG_OPTIONS.map((f) => <th key={f} style={{ textAlign: 'center', fontSize: 10 }}>{f}</th>)}</tr></thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.id}>
                    <td><b>{c.name}</b></td>
                    {FLAG_OPTIONS.map((f) => {
                      const row = flags.find((x) => x.company_id === c.id && x.key === f);
                      return (
                        <td key={f} style={{ textAlign: 'center' }}>
                          <Switch checked={row ? row.enabled !== 0 : true} onChange={() => toggleFlag(c.id, f)} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'tickets' && (
        <Card pad={false}>
          {tickets.length === 0 ? <Empty /> : (
            <DataTable
              rows={tickets}
              columns={[
                { key: 'subject', label: 'Subject' },
                { key: 'company_id', label: 'Company', render: (r) => <span className="small">{companies.find((c) => c.id === r.company_id)?.name || '—'}</span> },
                { key: 'priority', label: 'Priority', render: (r) => <Badge tone={r.priority === 'urgent' || r.priority === 'high' ? 'red' : r.priority === 'normal' ? 'amber' : 'blue'}>{r.priority}</Badge> },
                { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'open' ? 'red' : r.status === 'resolved' ? 'green' : 'amber'}>{r.status}</Badge> },
                { key: 'id', label: 'Actions', render: (r) => (
                  <div className="flex gap">
                    <Button sm onClick={() => updateTicket(r, 'in_progress')}>Start</Button>
                    <Button sm variant="success" onClick={() => updateTicket(r, 'resolved')}>Resolve</Button>
                  </div>
                ) }
              ]}
            />
          )}
        </Card>
      )}

      {modal && (
        <Modal title="Provision New Company" onClose={() => setModal(false)} footer={<>
          <Button onClick={() => setModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={create}>Provision</Button>
        </>}>
          <div className="frm-grid">
            <Field label="Company Name" full><Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Plan"><Select value={form.plan || 'standard'} onChange={(e) => setForm({ ...form, plan: e.target.value })}><option>basic</option><option>standard</option><option>enterprise</option></Select></Field>
            <Field label="Billing Email"><Input value={form.billing_email || ''} onChange={(e) => setForm({ ...form, billing_email: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
