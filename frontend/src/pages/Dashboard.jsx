import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { api, fmtMoney, fmtDate } from '../api';
import { Card, Stat, Badge, DataTable, Avatar, Button } from '../components/ui';
import { Bars, Donut, FunnelBars, Lines } from '../components/charts';

export default function Dashboard() {
  const { user, can } = useStore();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [widgets, setWidgets] = useState(null);

  useEffect(() => {
    api.get('/dashboard').then(setData).catch(() => {});
    api.get('/dashboard/widgets').then(setWidgets).catch(() => {});
  }, []);

  if (!data) return <div className="empty">Loading dashboard…</div>;

  const k = data.kpis;
  const funnelData = data.funnel || [];
  const sourceData = (data.sources || []).map((s) => ({ label: s.source, value: s.n }));
  const fw = data.forecastWindows || {};
  const trendData = (data.trend || []).map((t) => ({ label: t.week.slice(5), from: t.week, value: t.count }));
  const todayStr = new Date().toISOString().slice(0, 10);

  const goProject = (r) => nav(`/leads?project=${encodeURIComponent(r.name)}`);
  const convRows = (data.convByExec || []).map((c) => ({ ...c, id: (data.execs || []).find((e) => e.name === c.name)?.id || '' }));

  return (
    <div>
      <div className="toolbar">
        <div>
          <h2 style={{ fontSize: 20 }}>Good day, {user?.name?.split(' ')[0]} 👋</h2>
          <div className="muted">Click any chart segment to open that slice in its section.</div>
        </div>
        <div className="grow" />
        {can('lead.create') && <Link to="/leads"><Button variant="primary">+ New Lead</Button></Link>}
      </div>

      <div className="grid c4 mb">
        <Link to="/leads"><Stat label="Total Leads" value={k.total} /></Link>
        <Link to="/leads?priority=Hot"><Stat label="Hot Leads" value={k.hot} color="var(--red)" /></Link>
        <Link to={`/leads?from=${todayStr}`}><Stat label="New Today" value={k.newToday} color="var(--brand)" /></Link>
        <Link to="/leads?status=booking"><Stat label="Bookings" value={k.bookings} color="var(--green)" /></Link>
        <Link to="/leads?status=lost"><Stat label="Lost" value={k.lost} color="var(--muted)" /></Link>
        <Stat label="Conversion Rate" value={`${k.active}%`} color="var(--accent)" />
        <Link to="/finance"><Stat label="Revenue Collected" value={fmtMoney(k.collected)} color="var(--green)" /></Link>
        <Stat label="Avg Response" value={`${k.responseAvg}m`} color="var(--purple)" />
      </div>

      <div className="grid c3 mb">
        <Card>
          <h3 className="mb">Forecast (Bookings)</h3>
          <div className="grid c3" style={{ textAlign: 'center' }}>
            <div><div className="s-value">{fw.d30?.bookings ?? 0}</div><div className="small muted">30 days</div></div>
            <div><div className="s-value" style={{ color: 'var(--brand)' }}>{fw.d60?.bookings ?? 0}</div><div className="small muted">60 days</div></div>
            <div><div className="s-value" style={{ color: 'var(--green)' }}>{fw.d90?.bookings ?? 0}</div><div className="small muted">90 days</div></div>
          </div>
          <div className="small muted" style={{ textAlign: 'center', marginTop: 8 }}>Pipeline value {fmtMoney(fw.pipelineValue || 0)}</div>
        </Card>
        <Card>
          <h3 className="mb">Forecast (Revenue)</h3>
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <div className="s-value" style={{ fontSize: 22 }}>{fmtMoney(fw.d90?.revenue || 0)}</div>
            <div className="small muted">next 90 days</div>
          </div>
          <div className="grid c2" style={{ textAlign: 'center', fontSize: 13 }}>
            <div>{fmtMoney(fw.d30?.revenue || 0)}<div className="small muted">30d</div></div>
            <div>{fmtMoney(fw.d60?.revenue || 0)}<div className="small muted">60d</div></div>
          </div>
        </Card>
        <Card>
          <h3 className="mb">Lead Aging</h3>
          {(data.aging || []).map((a) => (
            <div key={a.label} className="flex between" style={{ padding: '5px 0' }}>
              <span className="small">{a.label}</span>
              <Badge tone={a.count > 15 ? 'red' : a.count > 8 ? 'amber' : 'gray'}>{a.count}</Badge>
            </div>
          ))}
        </Card>
      </div>

      <div className="grid c2">
        <Card>
          <h3 className="mb">Sales Funnel</h3>
          <FunnelBars stages={funnelData} onClick={(s) => nav(`/leads?status=${encodeURIComponent(s.key)}`)} />
        </Card>
        <Card>
          <h3 className="mb">Leads by Source <span className="small muted">(click a slice)</span></h3>
          {sourceData.length ? <Donut data={sourceData} getLink={(entry) => `/leads?source=${encodeURIComponent(entry.label)}`} /> : <div className="empty">No source data</div>}
        </Card>
        <Card>
          <h3 className="mb">Weekly Lead Trend (8 weeks) <span className="small muted">(click to filter by week)</span></h3>
          <Bars data={trendData} getLink={(entry) => `/leads?from=${entry.from}`} />
        </Card>
        <Card>
          <h3 className="mb">Conversion by Executive</h3>
          <DataTable
            rows={convRows}
            onRowClick={(r) => nav(`/leads?owner=${r.id}`)}
            columns={[
              { key: 'name', label: 'Executive', render: (r) => <div className="flex items-center gap"><Avatar name={r.name} /> {r.name}</div> },
              { key: 'leads', label: 'Leads' },
              { key: 'bookings', label: 'Bookings' },
              { key: 'conversion', label: 'Conv %', render: (r) => <Badge tone={r.conversion >= 15 ? 'green' : r.conversion >= 7 ? 'amber' : 'red'}>{r.conversion}%</Badge> }
            ]}
          />
        </Card>
      </div>

      <div className="grid c3 mt">
        <Card>
          <h3 className="mb">Daily Ranking</h3>
          {(data.ranking || []).map((r, i) => (
            <div key={i} className="flex between items-center" style={{ padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
              <div className="flex items-center gap">
                <span className={`rank ${i === 0 ? 'rank-1' : ''}`}>{i + 1}</span>
                <b>{r.name}</b>
              </div>
              <span className="small muted">{r.score} pts</span>
            </div>
          ))}
        </Card>
        <Card>
          <h3 className="mb">Conversion by Project <span className="small muted">(click to filter)</span></h3>
          <DataTable
            rows={data.convByProject || []}
            onRowClick={goProject}
            columns={[
              { key: 'name', label: 'Project' },
              { key: 'leads', label: 'Leads' },
              { key: 'conversion', label: 'Conv %', render: (r) => <Badge tone="blue">{r.conversion}%</Badge> }
            ]}
          />
        </Card>
        <Card>
          <h3 className="mb">Pending Follow-ups</h3>
          {data.followups?.length ? (
            <div>
              {data.followups.slice(0, 6).map((f, i) => (
                <div key={i} className="flex between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontWeight: 500 }}>{f.lead_name || 'Lead'} — {f.subject || f.type}</div>
                    <div className="small muted">{f.type} · due {fmtDate(f.scheduled_at)}</div>
                  </div>
                  <Badge tone="amber">due</Badge>
                </div>
              ))}
            </div>
          ) : <div className="empty">All caught up!</div>}
        </Card>
      </div>
    </div>
  );
}
