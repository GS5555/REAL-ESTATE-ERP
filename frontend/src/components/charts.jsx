import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, LineChart, Line, Legend } from 'recharts';

const COLORS = ['#2563eb', '#7c3aed', '#16a34a', '#f59e0b', '#dc2626', '#0891b2', '#db2777', '#65a30d'];

export function Bars({ data, dataKey = 'value', xKey = 'label', height = 240, color = 'var(--brand)', onClick, getLink }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef1f8" />
        <XAxis dataKey={xKey} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={42} />
        <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e4e7f0', fontSize: 12 }} cursor={onClick || getLink ? { fill: 'rgba(37,99,235,0.08)' } : {}} />
        <Bar dataKey={dataKey} fill={color} radius={[6, 6, 0, 0]} cursor={onClick || getLink ? 'pointer' : 'default'}
          onClick={(entry) => { const link = getLink ? getLink(entry) : null; if (link) window.location.href = link; else if (onClick) onClick(entry); }} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Lines({ data, keys, xKey = 'label', height = 240 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef1f8" />
        <XAxis dataKey={xKey} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={42} />
        <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e4e7f0', fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {keys.map((k, i) => <Line key={k} type="monotone" dataKey={k} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />)}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Donut({ data, height = 220, onClick, getLink }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="label" innerRadius={48} outerRadius={75} paddingAngle={3}
          cursor={onClick || getLink ? 'pointer' : 'default'}
          onClick={(entry) => { const link = getLink ? getLink(entry) : null; if (link) window.location.href = link; else if (onClick) onClick(entry); }}>
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e4e7f0', fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function FunnelBars({ stages, onClick }) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <div>
      {stages.map((s, i) => (
        <div key={i} className="mb" style={{ display: 'grid', gridTemplateColumns: '150px 1fr 40px', gap: 10, alignItems: 'center', cursor: onClick ? 'pointer' : 'default' }} onClick={onClick ? () => onClick(s) : undefined}>
          <span className="small muted" style={{ whiteSpace: 'nowrap' }}>{s.label}</span>
          <div className="bar"><div style={{ width: `${(s.count / max) * 100}%`, background: COLORS[i % COLORS.length] }} /></div>
          <span className="small" style={{ textAlign: 'right' }}>{s.count}</span>
        </div>
      ))}
    </div>
  );
}
