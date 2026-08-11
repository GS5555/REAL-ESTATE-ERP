import { useEffect, useState } from 'react';
import { api, fmtDateTime } from '../api';
import { Card, Badge, DataTable, Input, Empty } from '../components/ui';

const ACTION_TONES = { create: 'green', update: 'blue', delete: 'red', merge: 'purple', assign: 'amber', approve: 'green', reserve: 'amber' };

export default function AuditLog() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    api.get('/audit').then(setItems).catch(() => {});
  }, []);

  const filtered = items.filter((a) => (q ? JSON.stringify(a).toLowerCase().includes(q.toLowerCase()) : true));

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ fontSize: 20 }}>Audit Log</h2>
        <div className="grow" />
        <Input className="search-input" placeholder="Filter by user / action / entity…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Card pad={false}>
        {filtered.length === 0 ? <Empty text="No audit entries" /> : (
          <DataTable
            rows={filtered}
            columns={[
              { key: 'created_at', label: 'Time', render: (r) => fmtDateTime(r.created_at) },
              { key: 'user_name', label: 'User' },
              { key: 'action', label: 'Action', render: (r) => <Badge tone={ACTION_TONES[r.action?.split('.')[0]] || 'gray'}>{r.action}</Badge> },
              { key: 'entity', label: 'Entity', render: (r) => <span className="small">{r.entity}</span> },
              { key: 'detail', label: 'Detail', render: (r) => <span className="small muted">{JSON.stringify(r.detail).slice(0, 70)}</span> },
              { key: 'ip', label: 'IP' }
            ]}
          />
        )}
      </Card>
      <div className="small muted mt">Every create, edit, delete, assignment and approval is recorded immutably.</div>
    </div>
  );
}
