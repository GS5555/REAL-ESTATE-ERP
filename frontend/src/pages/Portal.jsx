import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, fmtMoney, fmtDate } from '../api';
import { Card, Badge, Button } from '../components/ui';

export default function CustomerPortal() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get(`/portal/customer/${token}`).then(setD).catch((e) => setErr(e.message));
  }, [token]);

  if (err) return <div className="login-bg"><div className="card card-pad">{err}</div></div>;
  if (!d) return <div className="login-bg"><div className="card card-pad">Loading portal…</div></div>;

  const brand = d.company?.settings?.branding || {};
  const theme = brand.theme || {};

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ background: `linear-gradient(135deg, ${theme.primaryDark || '#1d4ed8'}, ${theme.primary || '#2563eb'})`, color: '#fff', padding: '26px 20px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div className="flex items-center gap">
            {brand.logo ? <img src={brand.logo} alt="logo" style={{ height: 44, background: '#fff', borderRadius: 8, padding: 2 }} /> : <div style={{ width: 44, height: 44, borderRadius: 8, background: '#fff', display: 'grid', placeItems: 'center' }}>🏠</div>}
            <div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{brand.companyName || d.company?.name}</div>
              <div style={{ fontSize: 12, opacity: 0.9 }}>Customer Portal · Welcome, {d.customer.name}</div>
            </div>
          </div>
          <Button onClick={() => window.print()}>🖨 Print / Save PDF</Button>
        </div>
      </div>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: 20 }}>
        <div className="grid c3 mb">
          <Card><div className="s-label">Outstanding</div><div className="s-value" style={{ color: d.outstanding > 0 ? 'var(--red)' : 'var(--green)' }}>{fmtMoney(d.outstanding)}</div></Card>
          <Card><div className="s-label">Loyalty Points</div><div className="s-value">★ {d.customer.loyalty_points}</div></Card>
          <Card><div className="s-label">KYC Status</div><div className="s-value"><Badge tone={d.customer.kyc_status === 'verified' ? 'green' : 'amber'}>{d.customer.kyc_status}</Badge></div></Card>
        </div>

        <div className="grid c2">
          <Card>
            <h3 className="mb">My Properties</h3>
            {d.units.length === 0 ? <div className="empty">No units</div> : d.units.map((u, i) => (
              <div key={i} className="flex between" style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                <div><b>Unit {u.number}</b><div className="small muted">{u.unit_type} · {u.carpet_area} sq.ft</div></div>
                <div style={{ textAlign: 'right' }}>
                  <div>{fmtMoney(u.price)}</div>
                  <Badge tone={u.availability === 'Sold' ? 'green' : 'blue'}>{u.availability}</Badge>
                </div>
              </div>
            ))}
          </Card>
          <Card>
            <h3 className="mb">Payment Schedule & Receipts</h3>
            {d.payments.length === 0 ? <div className="empty">No payments yet</div> : d.payments.map((p, i) => (
              <div key={i} className="flex between" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div><b>{p.receipt_no}</b><div className="small muted">{fmtDate(p.date)} · {p.mode}</div></div>
                <div style={{ textAlign: 'right' }}>{fmtMoney(p.amount)}</div>
              </div>
            ))}
          </Card>
          <Card>
            <h3 className="mb">Invoices</h3>
            {d.invoices.length === 0 ? <div className="empty">No invoices</div> : d.invoices.map((i, idx) => (
              <div key={idx} className="flex between" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div><b>{i.number}</b><div className="small muted">due {fmtDate(i.due_date)}</div></div>
                <div style={{ textAlign: 'right' }}>
                  <div>{fmtMoney(i.amount)}</div>
                  <Badge tone={i.status === 'paid' ? 'green' : i.status === 'overdue' ? 'red' : 'amber'}>{i.status}</Badge>
                </div>
              </div>
            ))}
          </Card>
          <Card>
            <h3 className="mb">Documents</h3>
            {d.documents.length === 0 ? <div className="empty">No documents shared yet</div> : d.documents.map((doc, i) => (
              <div key={i} className="flex between" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <span>📄 {doc.name}</span>
                <Badge tone={doc.verified ? 'green' : 'gray'}>{doc.verified ? 'verified' : 'pending'}</Badge>
              </div>
            ))}
          </Card>
        </div>

        <div className="card card-pad mt">
          <h3 className="mb">Construction Updates</h3>
          <div className="small muted">Connect your project manager to receive stage-wise construction updates, payment reminders and agreement documents here. Raise a ticket from the main app if you need access.</div>
        </div>
        <div className="muted small mt" style={{ textAlign: 'center' }}>Powered by Propease — Enterprise Real Estate ERP & CRM</div>
      </div>
    </div>
  );
}
