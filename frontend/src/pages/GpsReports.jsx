import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { api, fmtDateTime } from '../api';
import { Card, Button, Field, Input, Select, Badge, DataTable, Stat, Empty } from '../components/ui';

const EXEC_ROLES = ['sales_executive', 'telecaller', 'team_leader', 'sales_manager', 'executive', 'sr_executive', 'assistant_manager'];

function haversine(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export default function GpsReports() {
  const { user, can } = useStore();
  const [users, setUsers] = useState([]);
  const [start, setStart] = useState(new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10));
  const [end, setEnd] = useState(new Date().toISOString().slice(0, 10));
  const [selected, setSelected] = useState('');
  const [trace, setTrace] = useState([]);
  const [map, setMap] = useState(null);
  const canView = can('gps.view');

  useEffect(() => {
    if (canView) {
      api.get('/users').then((u) => setUsers((u || []).filter((x) => EXEC_ROLES.includes(x.role)))).catch(() => setUsers([]));
    }
  }, [canView]);

  const load = () => {
    const params = { start, end, user_id: canView && selected ? selected : undefined };
    api.get('/field-force/trace', params).then(setTrace).catch(() => {});
    api.get('/field-force/map').then(setMap).catch(() => {});
  };
  useEffect(() => { load(); }, [start, end, selected]);

  const rows = canView && selected ? trace.filter((r) => r.user_id === selected) : trace;
  const withGps = rows.filter((r) => r.lat != null && r.lng != null);
  const acc = rows.filter((r) => r.accuracy != null).map((r) => r.accuracy);
  const bat = rows.filter((r) => r.battery != null).map((r) => r.battery);
  const gpsOff = rows.filter((r) => r.gps_enabled === 0).length;
  let dist = 0;
  for (let i = 1; i < withGps.length; i++) dist += haversine(withGps[i - 1], withGps[i]);

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ fontSize: 20 }}>GPS Movement Reports</h2>
        <div className="grow" />
        <Field label="From"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        {canView && (
          <Field label="Executive">
            <Select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ minWidth: 170 }}>
              <option value="">All</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </Field>
        )}
        <Button variant="primary" onClick={load}>Apply</Button>
      </div>

      <div className="grid c4 mb">
        <Stat label="Total Points" value={rows.length} />
        <Stat label="Avg Accuracy (m)" value={acc.length ? Math.round(acc.reduce((a, b) => a + b, 0) / acc.length) : '—'} />
        <Stat label="Battery Range" value={bat.length ? `${Math.min(...bat)}–${Math.max(...bat)}%` : '—'} color="var(--green)" />
        <Stat label="GPS-Off Points" value={gpsOff} color={gpsOff ? 'var(--red)' : undefined} />
      </div>

      <Card className="mb">
        <h3 className="mb">Summary <span className="small muted">— estimated distance {withGps.length > 1 ? Math.round(dist * 10) / 10 : 0} km across {withGps.length} located points</span></h3>
        {rows.length === 0 ? <Empty text="No GPS points in this range" /> : (
          <DataTable
            rows={rows}
            columns={[
              { key: 'created_at', label: 'Time', render: (r) => fmtDateTime(r.created_at) },
              { key: 'user_name', label: 'Executive', render: (r) => r.user_name || '—' },
              { key: 'lat', label: 'Lat', render: (r) => Number(r.lat || 0).toFixed(5) },
              { key: 'lng', label: 'Lng', render: (r) => Number(r.lng || 0).toFixed(5) },
              { key: 'accuracy', label: 'Accuracy', render: (r) => r.accuracy != null ? `${r.accuracy}m` : '—' },
              { key: 'battery', label: 'Battery', render: (r) => r.battery != null ? `${r.battery}%` : '—' },
              { key: 'speed', label: 'Speed', render: (r) => r.speed != null ? `${r.speed}` : '—' },
              { key: 'gps_enabled', label: 'GPS', render: (r) => <Badge tone={r.gps_enabled === 0 ? 'red' : 'green'}>{r.gps_enabled === 0 ? 'OFF' : 'ON'}</Badge> }
            ]}
          />
        )}
      </Card>

      <Card>
        <h3 className="mb">Live Executives <span className="small muted">— current locations & projects</span></h3>
        {!map ? <div className="small muted">Loading…</div> : (
          <>
            {(map.execs || []).length === 0 && <div className="small muted mb">No live executives</div>}
            {(map.execs || []).map((e) => (
              <div key={e.id} className="flex between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div><b>{e.name}</b><div className="small muted">{e.role} · {e.lat != null ? `${Number(e.lat).toFixed(5)}, ${Number(e.lng).toFixed(5)}` : 'no location'}</div></div>
                <span className="small muted">{e.last_seen_at ? `last seen ${fmtDateTime(e.last_seen_at)}` : '—'}</span>
              </div>
            ))}
            <div className="small muted mt">
              Projects on map: {(map.projects || []).map((p) => p.name).join(', ') || 'none'}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
