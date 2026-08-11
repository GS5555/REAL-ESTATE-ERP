import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { api, fmtMoney } from '../api';
import { Card, Button, Badge, DataTable, Tabs, Empty, Stat, Field, Select } from '../components/ui';
import { Bars, Donut, FunnelBars, Lines } from '../components/charts';
import { useToast } from '../components/ui';

export default function Reports() {
  const { can } = useStore();
  const toast = useToast();
  const nav = useNavigate();
  const [tab, setTab] = useState('lead');
  const [lead, setLead] = useState(null);
  const [execs, setExecs] = useState([]);
  const [revenue, setRevenue] = useState(null);
  const [funnel, setFunnel] = useState([]);
  const [sources, setSources] = useState([]);
  const [commission, setCommission] = useState(null);
  const [visit, setVisit] = useState(null);
  const [lost, setLost] = useState(null);
  const [growth, setGrowth] = useState([]);
  const [heatmap, setHeatmap] = useState([]);
  const [custom, setCustom] = useState([]);
  const [customDim, setCustomDim] = useState('source');
  const [customMetric, setCustomMetric] = useState('count');

  const load = () => {
    api.get('/reports/lead').then(setLead).catch(() => {});
    api.get('/reports/executive').then(setExecs).catch(() => {});
    api.get('/reports/revenue').then(setRevenue).catch(() => {});
    api.get('/reports/funnel').then(setFunnel).catch(() => {});
    api.get('/reports/source').then(setSources).catch(() => {});
    api.get('/reports/commission').then(setCommission).catch(() => {});
    api.get('/reports/visit-success').then(setVisit).catch(() => {});
    api.get('/reports/lost').then(setLost).catch(() => {});
    api.get('/reports/growth').then(setGrowth).catch(() => {});
    api.get('/reports/heatmap').then(setHeatmap).catch(() => {});
    api.get('/reports/custom', { dim: customDim, metric: customMetric }).then(setCustom).catch(() => {});
  };
  useEffect(() => { load(); }, [customDim, customMetric]);

  const schedule = async () => {
    const email = prompt('Email for scheduled weekly report:');
    if (!email) return;
    await api.post('/scheduled-reports', { name: 'Weekly Sales Summary', frequency: 'weekly', email });
    toast('Report scheduled', 'success');
  };

  const tabs = [
    { key: 'lead', label: 'Lead Report' },
    { key: 'executive', label: 'Executive' },
    { key: 'revenue', label: 'Revenue' },
    { key: 'funnel', label: 'Funnel' },
    { key: 'source', label: 'By Source' },
    { key: 'visit', label: 'Visit Success' },
    { key: 'lost', label: 'Lost Leads' },
    { key: 'growth', label: 'Growth' },
    { key: 'heatmap', label: 'Heatmap' },
    { key: 'custom', label: 'Custom Builder' },
    { key: 'commission', label: 'Commission' }
  ];

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ fontSize: 20 }}>Reports & Analytics</h2>
        <div className="grow" />
        {can('report.export') && <Button onClick={() => api.download('/reports/export', { kind: 'leads' }).catch((e) => toast(e.message, 'error'))}>⤓ Excel (CSV)</Button>}
        {can('report.export') && <Button onClick={() => api.shareFile('/reports/export', { kind: 'leads' }, 'Leads Report').then((m) => { if (m === 'downloaded') toast('Sharing not available — file downloaded', 'info'); }).catch((e) => toast(e.message, 'error'))}>Share</Button>}
        {can('report.export') && <Button onClick={() => api.download('/reports/export', { kind: 'bookings' }).catch((e) => toast(e.message, 'error'))}>⤓ Bookings</Button>}
        {can('report.export') && <Button onClick={() => api.shareFile('/reports/export', { kind: 'bookings' }, 'Bookings Report').then((m) => { if (m === 'downloaded') toast('Sharing not available — file downloaded', 'info'); }).catch((e) => toast(e.message, 'error'))}>Share</Button>}
        {can('report.schedule') && <Button onClick={schedule}>📧 Schedule</Button>}
      </div>
      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'lead' && lead && (
        <div className="grid c2">
          <Card>
            <h3 className="mb">Lead Report</h3>
            <dl className="kv">
              <dt>Total Leads</dt><dd>{lead.total}</dd>
              <dt>Bookings</dt><dd>{lead.bookings}</dd>
              <dt>Conversion Rate</dt><dd>{lead.conversionRate}%</dd>
              <dt>Avg. Closing Time</dt><dd>{lead.avgClosingDays} days</dd>
            </dl>
          </Card>
          <Card>
            <h3 className="mb">By Source <span className="small muted">(click a slice)</span></h3>
            <Donut data={(lead.sourceList || []).map(([label, value]) => ({ label, value }))} getLink={(e) => `/leads?source=${encodeURIComponent(e.label)}`} />
          </Card>
          <Card>
            <h3 className="mb">Leads by Stage <span className="small muted">(click to filter)</span></h3>
            <FunnelBars stages={funnel.map((f) => ({ label: f.label, count: f.count }))} onClick={(s) => nav(`/leads?status=${encodeURIComponent(funnel.find((f) => f.label === s.label)?.stage || s.label)}`)} />
          </Card>
          <Card>
            <h3 className="mb">Source-wise Performance <span className="small muted">(click a row)</span></h3>
            <DataTable
              rows={sources}
              onRowClick={(r) => nav(`/leads?source=${encodeURIComponent(r.source)}`)}
              columns={[
                { key: 'source', label: 'Source' },
                { key: 'total', label: 'Leads' },
                { key: 'bookings', label: 'Bookings' },
                { key: 'conversion', label: 'Conv %', render: (r) => <Badge tone={r.conversion >= 10 ? 'green' : r.conversion >= 4 ? 'amber' : 'red'}>{r.conversion}%</Badge> }
              ]}
            />
          </Card>
        </div>
      )}

      {tab === 'executive' && (
        <Card pad={false}>
          {execs.length === 0 ? <Empty /> : (
            <DataTable
              rows={execs}
              onRowClick={(r) => nav(`/leads?owner=${r.id}`)}
              columns={[
                { key: 'name', label: 'Executive' },
                { key: 'role', label: 'Role', render: (r) => <Badge tone="blue">{r.role.replace(/_/g, ' ')}</Badge> },
                { key: 'leads', label: 'Leads' },
                { key: 'activities', label: 'Activities' },
                { key: 'visits', label: 'Visits' },
                { key: 'bookings', label: 'Bookings' },
                { key: 'conversion', label: 'Conversion', render: (r) => <Badge tone={r.conversion >= 15 ? 'green' : r.conversion >= 7 ? 'amber' : 'red'}>{r.conversion}%</Badge> }
              ]}
            />
          )}
        </Card>
      )}

      {tab === 'revenue' && revenue && (
        <div className="grid c2">
          <Card><h3 className="mb">Monthly Revenue</h3><Bars data={(revenue.monthly || []).map((m) => ({ label: m.month, value: m.value }))} /></Card>
          <Card>
            <h3 className="mb">Totals</h3>
            <dl className="kv">
              <dt>Total Collected</dt><dd>{fmtMoney(revenue.total)}</dd>
              <dt>Total Bookings</dt><dd>{revenue.bookings}</dd>
              <dt>Avg Deal Size</dt><dd>{revenue.bookings ? fmtMoney(revenue.total / revenue.bookings) : '—'}</dd>
            </dl>
          </Card>
        </div>
      )}

      {tab === 'funnel' && (
        <Card>
          <h3 className="mb">Conversion Funnel <span className="small muted">(click to filter)</span></h3>
          <FunnelBars stages={funnel.map((f) => ({ label: f.label, count: f.count }))} onClick={(s) => nav(`/leads?status=${encodeURIComponent(funnel.find((f) => f.label === s.label)?.stage || s.label)}`)} />
        </Card>
      )}

      {tab === 'source' && (
        <Card pad={false}>
          {sources.length === 0 ? <Empty /> : (
            <DataTable
              rows={sources}
              onRowClick={(r) => nav(`/leads?source=${encodeURIComponent(r.source)}`)}
              columns={[
                { key: 'source', label: 'Source', render: (r) => <Badge tone="brand">{r.source}</Badge> },
                { key: 'total', label: 'Leads' },
                { key: 'bookings', label: 'Bookings' },
                { key: 'conversion', label: 'Conversion %', render: (r) => <Badge tone={r.conversion >= 10 ? 'green' : r.conversion >= 4 ? 'amber' : 'red'}>{r.conversion}%</Badge> }
              ]}
            />
          )}
        </Card>
      )}

      {tab === 'visit' && visit && (
        <div className="grid c3">
          <Stat label="Scheduled Visits" value={visit.scheduled} />
          <Stat label="Completed" value={visit.completed} color="var(--green)" />
          <Stat label="Visit Success Rate" value={`${visit.rate}%`} color="var(--brand)" />
          <Card pad={false} className="full"><DataTable rows={[{ visit: 'Overall', completed: visit.completed, scheduled: visit.scheduled, rate: visit.rate + '%' }]} columns={[{ key: 'visit', label: 'Metric' }, { key: 'completed', label: 'Completed' }, { key: 'scheduled', label: 'Scheduled' }, { key: 'rate', label: 'Rate %' }]} /></Card>
        </div>
      )}

      {tab === 'lost' && lost && (
        <div className="grid c2">
          <Card><h3 className="mb">Lost Reasons <span className="small muted">(click to view lost leads)</span></h3><Donut data={lost.byReason.map((r) => ({ label: r.reason, value: r.count }))} getLink={() => '/leads?status=lost'} /></Card>
          <Card pad={false}>
            {lost.rows.length === 0 ? <Empty text="No lost leads" /> : (
              <DataTable
                rows={lost.rows}
                columns={[
                  { key: 'name', label: 'Lead' },
                  { key: 'source', label: 'Source', render: (r) => <Badge tone="brand">{r.source}</Badge> },
                  { key: 'owner', label: 'Owner' },
                  { key: 'reason', label: 'Lost Reason', render: (r) => <Badge tone="red">{r.reason}</Badge> }
                ]}
              />
            )}
          </Card>
        </div>
      )}

      {tab === 'growth' && (
        <Card>
          <h3 className="mb">Monthly Growth (Leads vs Bookings)</h3>
          <Lines data={growth.map((g) => ({ label: g.month, leads: g.leads, bookings: g.bookings }))} keys={['leads', 'bookings']} />
        </Card>
      )}

      {tab === 'heatmap' && (
        <Card>
          <h3 className="mb">Demand Heatmap (Area × City)</h3>
          {heatmap.length === 0 ? <Empty text="No demand data" /> : (
            <div className="heatgrid">
              {heatmap.map((h, i) => (
                <div key={i} className="heat-cell" style={{ background: `rgba(37, 99, 235, ${0.08 + (h.intensity / 100) * 0.72})`, cursor: 'pointer' }} onClick={() => nav(`/leads?city=${encodeURIComponent(h.city)}&area=${encodeURIComponent(h.area)}`)} title="Click to view leads in this area">
                  <b>{h.area}</b>
                  <div className="small muted">{h.city} · {h.n} leads</div>
                  <div className="small" style={{ color: 'var(--green)' }}>{h.bookings} bookings</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'custom' && (
        <Card>
          <h3 className="mb">Custom Report Builder</h3>
          <div className="flex gap mb" style={{ flexWrap: 'wrap' }}>
            <Field label="Dimension"><Select value={customDim} onChange={(e) => setCustomDim(e.target.value)}>
              <option value="source">Source</option><option value="area">Area</option><option value="city">City</option>
              <option value="project">Project</option><option value="exec">Executive</option><option value="stage">Stage</option>
            </Select></Field>
            <Field label="Metric"><Select value={customMetric} onChange={(e) => setCustomMetric(e.target.value)}>
              <option value="count">Lead Count</option><option value="revenue">Revenue (est.)</option><option value="bookings">Bookings</option>
            </Select></Field>
            <Field label="Export"><div className="flex gap"><Button onClick={() => api.download('/reports/custom', { dim: customDim, metric: customMetric, export: 'csv' }).catch((e) => toast(e.message, 'error'))}>⤓ CSV</Button><Button onClick={() => api.shareFile('/reports/custom', { dim: customDim, metric: customMetric, export: 'csv' }, 'Custom Report').then((m) => { if (m === 'downloaded') toast('Sharing not available — file downloaded', 'info'); }).catch((e) => toast(e.message, 'error'))}>Share</Button></div></Field>
          </div>
          <DataTable
            rows={custom}
            onRowClick={(r) => {
              const map = { source: 'source', area: 'area', city: 'city', project: 'project', exec: 'owner', stage: 'status' };
              const p = map[customDim];
              const val = customDim === 'stage' && r.key ? r.key : r.dimension;
              if (p && val) nav(`/leads?${p}=${encodeURIComponent(val)}`);
            }}
            columns={[
              { key: 'dimension', label: 'Dimension' },
              { key: 'value', label: customMetric === 'revenue' ? 'Revenue' : customMetric === 'bookings' ? 'Bookings' : 'Count', render: (r) => customMetric === 'revenue' ? fmtMoney(r.value) : r.value }
            ]}
          />
        </Card>
      )}

      {tab === 'commission' && commission && (
        <div className="grid c2">
          <Card><Stat label="Pending" value={fmtMoney(commission.pending)} color="var(--amber)" /></Card>
          <Card><Stat label="Paid" value={fmtMoney(commission.paid)} color="var(--green)" /></Card>
          <Card pad={false} className="full">
            {commission.rows.length === 0 ? <Empty /> : (
              <DataTable
                rows={commission.rows}
                columns={[
                  { key: 'partner_name', label: 'Partner' },
                  { key: 'unit_number', label: 'Unit' },
                  { key: 'amount', label: 'Amount', render: (r) => fmtMoney(r.amount) },
                  { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'paid' ? 'green' : 'amber'}>{r.status}</Badge> }
                ]}
              />
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
