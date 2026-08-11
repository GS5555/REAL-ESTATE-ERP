import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { api, fmtDateTime } from '../api';
import { Card, Badge, Button, DataTable, Field, Input, Select, Modal, Textarea } from '../components/ui';

export default function FieldForce() {
  const { can } = useStore();
  const [map, setMap] = useState(null);
  const [plan, setPlan] = useState(null);
  const [missed, setMissed] = useState([]);
  const [route, setRoute] = useState(null);
  const [tab, setTab] = useState('map');
  const [date, setDate] = useState('');
  const [userId, setUserId] = useState('');
  const [users, setUsers] = useState([]);
  const [mapsCfg, setMapsCfg] = useState(null);

  const load = () => {
    api.get('/field-force/map', { date, user_id: userId }).then(setMap).catch(() => {});
    api.get('/field-force/plan', { date }).then(setPlan).catch(() => {});
    api.get('/field-force/missed', { date }).then((d) => setMissed(d.rows || [])).catch(() => {});
  };
  useEffect(() => { load(); }, [date, userId]);
  useEffect(() => { api.get('/users').then(setUsers).catch(() => {}); }, []);
  useEffect(() => {
    api.get('/settings').then((co) => setMapsCfg(co.settings?.config?.maps || {})).catch(() => {});
  }, []);

  const showRoute = (id, name) => api.get(`/field-force/route/${id}`).then((d) => setRoute({ ...d, name }));

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ fontSize: 20 }}>Field Force</h2>
        <Input type="date" title="Date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Select value={userId} onChange={(e) => setUserId(e.target.value)} style={{ width: 160 }}>
          <option value="">All users</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
        <div className="grow" />
        <div className="seg">
          {['map', 'plan', 'missed', 'routes'].map((t) => (
            <button key={t} className={tab === t ? 'seg-on' : ''} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
          ))}
        </div>
        {can('sitevisit.approve') && <Button sm onClick={async () => { await api.post('/field-force/mark-missed'); load(); }}>Mark Missed Visits</Button>}
      </div>

      {tab === 'map' && <LiveMap map={map} cfg={mapsCfg} />}

      {tab === 'plan' && (
        <div className="grid c2">
          <Card>
            <h3 className="mb">Daily Visit Plan</h3>
            {(plan?.visits || []).map((v) => (
              <VisitRow key={v.id} v={v} />
            ))}
            {(plan?.visits || []).length === 0 && <div className="empty">No visits scheduled today</div>}
          </Card>
          <Card>
            <h3 className="mb">Quick Check-in</h3>
            <div className="muted small mb">Mark today's attendance with geo-location. Demo uses preset coordinates.</div>
            <div className="flex gap mb">
              <Button sm onClick={() => api.post('/field-force/attendance', { action: 'checkin', latitude: 19.076, longitude: 72.8777, geofenced: true }).then(() => alert('Checked in'))}>Check-in</Button>
              <Button sm ghost onClick={() => api.post('/field-force/attendance', { action: 'checkout' }).then(() => alert('Checked out'))}>Check-out</Button>
              <Button sm ghost onClick={async () => { if (navigator.geolocation) navigator.geolocation.getCurrentPosition(async (p) => { await api.post('/field-force/location', { lat: p.coords.latitude, lng: p.coords.longitude }); load(); alert('Live location updated'); }); }}>📡 Update My Location</Button>
            </div>
          </Card>
        </div>
      )}

      {tab === 'missed' && (
        <Card>
          <h3 className="mb">Missed Visit Alerts</h3>
          {missed.length === 0 && <div className="empty">No missed visits — good job 🎉</div>}
          {missed.map((v) => (
            <div key={v.id} className="flex between" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div><b>{v.lead_name}</b><div className="small muted">{v.project_name} · {v.user_name} · scheduled {fmtDateTime(v.scheduled_at)}</div></div>
              <div className="flex gap">
                <Button sm ghost onClick={() => showRoute(v.user_id, v.user_name)}>Route</Button>
                <Button sm onClick={() => api.post(`/field-force/visits/${v.id}/checkin`, { latitude: 19.076, longitude: 72.8777 }).then(load)}>Check-in Now</Button>
              </div>
            </div>
          ))}
        </Card>
      )}

      {tab === 'routes' && (
        <Card>
          <h3 className="mb">Executive Route History</h3>
          {(map?.execs || []).map((e) => (
            <div key={e.id} className="flex between" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div><b>{e.name}</b><div className="small muted">{e.role} · last seen {e.last_seen_at ? fmtDateTime(e.last_seen_at) : '—'}</div></div>
              <Button sm ghost onClick={() => showRoute(e.id, e.name)}>View Route</Button>
            </div>
          ))}
        </Card>
      )}

      {route && (
        <Modal title={`Route history — ${route.name}`} onClose={() => setRoute(null)}>
          <div className="small muted mb">Geo-verified site visits (check-in trail)</div>
          {(route.visits || []).map((v) => (
            <div key={v.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <b>{v.lead_name}</b> <Badge tone={v.status === 'verified' ? 'green' : 'blue'}>{v.status}</Badge>
              <div className="small muted">{v.project_name} · in {fmtDateTime(v.checkin_at)} {v.distance_km ? `· ${Math.round(v.distance_km * 10) / 10} km` : ''} {v.duration_mins ? `· ${v.duration_mins} min` : ''}</div>
              {v.feedback && <div className="small">📝 {v.feedback}</div>}
            </div>
          ))}
          {(route.visits || []).length === 0 && <div className="empty">No completed visits</div>}
        </Modal>
      )}
    </div>
  );
}

function VisitRow({ v }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex between items-center" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div>
        <b>{v.lead_name}</b> <Badge tone={v.status === 'done' ? 'green' : v.status === 'verified' ? 'blue' : 'amber'}>{v.status}</Badge>
        <div className="small muted">{v.project_name} · {v.user_name} · {fmtDateTime(v.scheduled_at)}</div>
      </div>
      {!done && v.status !== 'done' && v.status !== 'verified' && (
        <Button sm onClick={async () => { await api.post(`/field-force/visits/${v.id}/checkin`, { latitude: 19.076, longitude: 72.8777, photo_url: '/visits/demo.jpg' }); setDone(true); }}>Check-in</Button>
      )}
      {done && <Badge tone="green">✓ done</Badge>}
    </div>
  );
}

function LiveMap({ map, cfg }) {
  if (!map) return <div className="empty">Loading map…</div>;
  const key = cfg?.apiKey || '';
  const embedBase = cfg?.embedBase || 'https://www.google.com/maps';
  const points = [
    ...(map.execs || []).filter((e) => e.lat != null && e.lng != null).map((e) => ({ ...e, kind: 'exec' })),
    ...(map.projects || []).map((p) => ({ ...p, kind: 'project', lat: 19.06 + Math.random() * 0.1, lng: 72.85 + Math.random() * 0.1 }))
  ];
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const center = points.length ? { lat: lats.reduce((a, b) => a + b, 0) / lats.length, lng: lngs.reduce((a, b) => a + b, 0) / lngs.length } : { lat: 19.076, lng: 72.8777 };

  if (key) {
    const q = points.filter((p) => p.lat != null && p.lng != null).map((p) => `${p.lat},${p.lng}`).join('|');
    return (
      <Card>
        <div className="flex between mb">
          <h3>Live Team Map <span className="small muted">— Google Maps</span></h3>
          <a className="btn btn-sm" style={{ textDecoration: 'none' }} target="_blank" rel="noreferrer" href={`${embedBase}/search/${center.lat},${center.lng}`}>Open in Google Maps</a>
        </div>
        <iframe
          title="field-force-map"
          width="100%"
          height="480"
          frameBorder="0"
          style={{ border: 0, borderRadius: 12 }}
          src={`https://www.google.com/maps/embed/v1/view?key=${encodeURIComponent(key)}&center=${center.lat},${center.lng}&zoom=12${q ? `&markers=${encodeURIComponent(q)}` : ''}`}
          allowFullScreen
          loading="lazy"
        />
        <div className="flex gap mt small">
          {(map.projects || []).map((p) => <span key={p.id} style={{ background: '#eef2ff', color: '#1d4ed8', padding: '3px 8px', borderRadius: 6, fontWeight: 600 }}>🏢 {p.name}</span>)}
          {(map.execs || []).filter((e) => e.lat != null).map((e) => <span key={e.id} style={{ background: '#2563eb', color: '#fff', padding: '3px 8px', borderRadius: 6 }}>● {e.name}</span>)}
        </div>
      </Card>
    );
  }

  const minLat = Math.min(...lats) - 0.05, maxLat = Math.max(...lats) + 0.05;
  const minLng = Math.min(...lngs) - 0.05, maxLng = Math.max(...lngs) + 0.05;
  const px = (lng) => 50 + ((lng - minLng) / (maxLng - minLng)) * 900;
  const py = (lat) => 420 - ((lat - minLat) / (maxLat - minLat)) * 380;
  return (
    <Card>
      <h3 className="mb">Live Team Map <span className="small muted">— executives & projects (demo projection)</span></h3>
      <div className="small muted mb" style={{ background: '#f8fafc', border: '1px solid var(--border)', padding: '8px 12px', borderRadius: 8 }}>
        No Google Maps API key configured. Add one in <b>Settings → Integrations → Google Maps</b> to show a real interactive map.
      </div>
      <div style={{ position: 'relative', height: 460, background: '#eef4ff', borderRadius: 12, overflow: 'hidden' }}>
        <svg width="1000" height="460" viewBox="0 0 1000 460" style={{ width: '100%', height: '100%' }}>
          <rect width="1000" height="460" fill="#eef4ff" />
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <line x1="0" y1={i * 115 + 10} x2="1000" y2={i * 115 + 10} stroke="#cbd5e1" strokeDasharray="6 6" />
              <line x1={i * 250 + 10} y1="0" x2={i * 250 + 10} y2="460" stroke="#cbd5e1" strokeDasharray="6 6" />
            </g>
          ))}
          {(map.projects || []).map((p, i) => (
            <g key={p.id}>
              <circle cx={px(72.85 + Math.random() * 0.1)} cy={py(19.06 + Math.random() * 0.1)} r="14" fill="#fff" stroke="#2563eb" strokeWidth="2" />
              <text x={px(72.85 + Math.random() * 0.1)} y={py(19.06 + Math.random() * 0.1) + 4} textAnchor="middle" fontSize="11" fill="#2563eb" fontWeight="700">🏢</text>
            </g>
          ))}
          {(map.execs || []).filter((e) => e.lat != null).map((e) => (
            <g key={e.id}>
              <circle cx={px(e.lng)} cy={py(e.lat)} r="16" fill="#2563eb" opacity="0.15" />
              <circle cx={px(e.lng)} cy={py(e.lat)} r="9" fill="#2563eb" stroke="#fff" strokeWidth="2" />
              <text x={px(e.lng)} y={py(e.lat) - 14} textAnchor="middle" fontSize="11" fill="#0f172a" fontWeight="600">{e.name.split(' ')[0]}</text>
            </g>
          ))}
        </svg>
        <div style={{ position: 'absolute', left: 12, top: 12 }}>
          {map.projects.map((p) => <div key={p.id} className="small" style={{ background: '#fff', padding: '3px 8px', borderRadius: 6, marginBottom: 4, boxShadow: '0 1px 4px rgba(0,0,0,.12)' }}>🏢 {p.name}</div>)}
          {(map.execs || []).map((e) => <div key={e.id} className="small" style={{ background: '#2563eb', color: '#fff', padding: '3px 8px', borderRadius: 6, marginBottom: 4 }}>● {e.name}</div>)}
        </div>
      </div>
    </Card>
  );
}
