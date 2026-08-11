import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { api, fmtMoney } from '../api';
import { Card, Button, Badge, DataTable, Modal, Field, Input, Select, Stat, Empty } from '../components/ui';
import { Bars, Donut, Lines } from '../components/charts';
import { useToast } from '../components/ui';

const CHANNELS = ['Facebook', 'Instagram', 'Google Ads', 'WhatsApp', '99acres', 'Justdial', 'Email', 'SMS', 'Landing Page'];

export default function Marketing() {
  const { can } = useStore();
  const toast = useToast();
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({});

  const load = () => api.get('/campaigns').then(setItems).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name) return toast('Campaign name required', 'error');
    await api.post('/campaigns', form);
    setModal(false); setForm({}); load(); toast('Campaign created', 'success');
  };

  const totalBudget = items.reduce((s, c) => s + (c.budget || 0), 0);
  const totalSpent = items.reduce((s, c) => s + (c.spent || 0), 0);
  const totalLeads = items.reduce((s, c) => s + (c.actual_leads || 0), 0);
  const totalBookings = items.reduce((s, c) => s + (c.actual_bookings || 0), 0);

  const byChannel = {};
  for (const c of items) {
    const key = c.channel || 'Other';
    byChannel[key] = byChannel[key] || { channel: key, leads: 0, bookings: 0, spent: 0, budget: 0, cost_per_lead: 0, count: 0 };
    byChannel[key].leads += c.actual_leads || 0;
    byChannel[key].bookings += c.actual_bookings || 0;
    byChannel[key].spent += c.spent || 0;
    byChannel[key].budget += c.budget || 0;
    byChannel[key].count += 1;
  }
  const channelRows = Object.values(byChannel).map((c) => ({ ...c, cost_per_lead: c.leads ? Math.round(c.spent / c.leads) : 0 }));
  const leadsByChannel = channelRows.map((c) => ({ label: c.channel, value: c.leads }));
  const bookingsByChannel = channelRows.map((c) => ({ label: c.channel, value: c.bookings }));
  const budgetVsSpent = channelRows.map((c) => ({ label: c.channel, Budget: c.budget, Spent: c.spent }));
  const cplByChannel = channelRows.map((c) => ({ label: c.channel, value: c.cost_per_lead }));
  const convRate = channelRows.map((c) => ({ label: c.channel, value: c.leads ? Math.round((c.bookings / c.leads) * 100) : 0 }));

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ fontSize: 20 }}>Marketing & Campaigns</h2>
        <div className="grow" />
        {can('marketing.create') && <Button variant="primary" onClick={() => setModal(true)}>+ New Campaign</Button>}
      </div>

      <div className="grid c4 mb">
        <Stat label="Total Budget" value={fmtMoney(totalBudget)} />
        <Stat label="Spent" value={fmtMoney(totalSpent)} color="var(--amber)" />
        <Stat label="Leads Attributed" value={totalLeads} />
        <Stat label="Bookings" value={totalBookings} color="var(--green)" />
      </div>

      {items.length > 0 && (
        <div className="grid c2 mb">
          <Card>
            <h3 className="mb">Leads by Channel</h3>
            <Bars data={leadsByChannel} color="var(--blue)" onClick={(e) => nav(`/leads?source=${encodeURIComponent(e.label)}`)} />
          </Card>
          <Card>
            <h3 className="mb">Bookings by Channel</h3>
            <Donut data={bookingsByChannel} onClick={(e) => nav(`/leads?source=${encodeURIComponent(e.label)}`)} />
          </Card>
          <Card>
            <h3 className="mb">Budget vs Spent</h3>
            <Lines data={budgetVsSpent} keys={['Budget', 'Spent']} xKey="label" />
          </Card>
          <Card>
            <h3 className="mb">Cost per Lead</h3>
            <Bars data={cplByChannel} color="var(--amber)" />
          </Card>
          <Card>
            <h3 className="mb">Conversion Rate % (bookings/leads)</h3>
            <Bars data={convRate} color="var(--green)" />
          </Card>
          <Card>
            <h3 className="mb">Campaign Performance</h3>
            <DataTable
              rows={channelRows}
              columns={[
                { key: 'channel', label: 'Channel', render: (r) => <b>{r.channel}</b> },
                { key: 'leads', label: 'Leads' },
                { key: 'bookings', label: 'Bookings' },
                { key: 'cost_per_lead', label: 'Cost/Lead', render: (r) => fmtMoney(r.cost_per_lead) },
                { key: 'spent', label: 'Spent', render: (r) => fmtMoney(r.spent) }
              ]}
            />
          </Card>
        </div>
      )}

      <Card pad={false}>
        {items.length === 0 ? <Empty /> : (
          <DataTable
            rows={items}
            onRowClick={(r) => nav(`/leads?campaign=${encodeURIComponent(r.name)}`)}
            columns={[
              { key: 'name', label: 'Campaign', render: (r) => <span title="Click to view leads from this campaign" style={{ fontWeight: 600 }}>{r.name}</span> },
              { key: 'channel', label: 'Channel', render: (r) => <button className="btn ghost sm" title={`View ${r.channel} leads`} onClick={(e) => { e.stopPropagation(); nav(`/leads?source=${encodeURIComponent(r.channel)}`); }}><Badge tone="brand">{r.channel}</Badge></button> },
              { key: 'budget', label: 'Budget', render: (r) => fmtMoney(r.budget) },
              { key: 'spent', label: 'Spent', render: (r) => fmtMoney(r.spent) },
              { key: 'actual_leads', label: 'Leads' },
              { key: 'actual_bookings', label: 'Bookings' },
              { key: 'cost_per_lead', label: 'Cost/Lead', render: (r) => fmtMoney(r.cost_per_lead) },
              { key: 'start_date', label: 'Start', render: (r) => r.start_date?.slice(0, 10) }
            ]}
          />
        )}
      </Card>

      {modal && (
        <Modal title="New Campaign" onClose={() => setModal(false)} footer={<>
          <Button onClick={() => setModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={save}>Save</Button>
        </>}>
          <div className="frm-grid">
            <Field label="Campaign Name" full><Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Channel"><Select value={form.channel || 'Facebook'} onChange={(e) => setForm({ ...form, channel: e.target.value })}>{CHANNELS.map((c) => <option key={c}>{c}</option>)}</Select></Field>
            <Field label="Budget (₹)"><Input type="number" value={form.budget || ''} onChange={(e) => setForm({ ...form, budget: e.target.value })} /></Field>
            <Field label="Spent (₹)"><Input type="number" value={form.spent || ''} onChange={(e) => setForm({ ...form, spent: e.target.value })} /></Field>
            <Field label="Start Date"><Input type="date" value={form.start_date || ''} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Field>
            <Field label="End Date"><Input type="date" value={form.end_date || ''} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
