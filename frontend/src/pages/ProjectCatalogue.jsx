import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, fmtMoney, fmtDate } from '../api';
import { Badge, Button, Modal } from '../components/ui';

export default function ProjectCatalogue() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [qr, setQr] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.get(`/public/catalogue/${slug}`).then(setData).catch((e) => { if (e.status === 404) setNotFound(true); });
  }, [slug]);

  const shareUrl = data ? `${window.location.origin}${data.shareUrl || `/share/${slug}`}` : '';

  const copy = async () => {
    try { await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  const openQr = async () => {
    try { const r = await api.get(`/public/catalogue/${slug}/qr`); setQr(r.url); } catch { /* ignore */ }
  };

  if (notFound) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f4f6fb', padding: 20 }}>
        <div className="card card-pad" style={{ maxWidth: 420, textAlign: 'center' }}>
          <h2 style={{ fontSize: 22, marginBottom: 8 }}>Catalogue not found</h2>
          <p className="muted small">This project share link may be invalid or has been removed.</p>
        </div>
      </div>
    );
  }

  if (!data) return <div className="empty" style={{ minHeight: '80vh', display: 'grid', placeItems: 'center' }}>Loading…</div>;

  const { project, builder, media, priceList, updates, rera } = data;
  const photos = media && media.length ? media.map((m) => m.url || m.media_url).filter(Boolean) : project.photos || [];
  const amenities = project.amenities || [];
  const brochure = project.brochure_url;

  return (
    <div style={{ background: '#f4f6fb', minHeight: '100vh', padding: 24 }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '28px 32px', borderBottom: '1px solid var(--border)' }}>
            <div className="flex between items-center" style={{ gap: 12, flexWrap: 'wrap' }}>
              <div className="flex items-center" style={{ gap: 14 }}>
                {builder.logo && <img src={builder.logo} alt="" style={{ width: 52, height: 52, borderRadius: 10, objectFit: 'cover', border: '1px solid var(--border)' }} />}
                <div>
                  <h1 style={{ fontSize: 24 }}>{project.name}</h1>
                  <div className="small muted">{builder.name}</div>
                </div>
              </div>
              <div className="flex gap" style={{ flexWrap: 'wrap' }}>
                {project.type && <Badge tone="brand">{project.type}</Badge>}
                {project.status && <Badge tone="green">{project.status}</Badge>}
                {project.city && <Badge tone="gray">📍 {project.city}</Badge>}
                {project.location && <Badge tone="gray">{project.location}</Badge>}
              </div>
            </div>
            <p className="muted mt" style={{ maxWidth: 760 }}>{project.description}</p>
            <div className="flex gap mt" style={{ flexWrap: 'wrap' }}>
              <Button variant="primary" onClick={copy}>{copied ? 'Copied!' : 'Copy share link'}</Button>
              <Button onClick={openQr}>QR code</Button>
              {brochure && <a className="btn" href={brochure} target="_blank" rel="noreferrer">Download brochure</a>}
            </div>
          </div>

          {photos.length > 0 && (
            <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--border)' }}>
              <h3 className="mb">Photo Gallery</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                {photos.slice(0, 8).map((p, i) => (
                  <img key={i} src={p} alt="" style={{ width: '100%', height: 160, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)' }} />
                ))}
              </div>
            </div>
          )}

          {amenities.length > 0 && (
            <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--border)' }}>
              <h3 className="mb">Amenities</h3>
              <div className="flex gap" style={{ flexWrap: 'wrap' }}>
                {amenities.map((a) => <Badge key={a} tone="blue">{a}</Badge>)}
              </div>
            </div>
          )}

          {priceList.length > 0 && (
            <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--border)' }}>
              <h3 className="mb">Price List</h3>
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>{Object.keys(priceList[0]).filter((k) => k !== 'id' && k !== 'project_id' && k !== 'created_at').map((k) => <th key={k}>{k}</th>)}</tr>
                  </thead>
                  <tbody>
                    {priceList.map((r, i) => (
                      <tr key={i}>
                        {Object.keys(r).filter((k) => k !== 'id' && k !== 'project_id' && k !== 'created_at').map((k) => (
                          <td key={k}>{/price|amount/i.test(k) && !isNaN(Number(r[k])) ? fmtMoney(Number(r[k])) : r[k]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {updates.length > 0 && (
            <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--border)' }}>
              <h3 className="mb">Construction Updates</h3>
              <div className="timeline">
                {updates.map((u) => (
                  <div key={u.id} className="tl-item">
                    <b>{u.title || u.status}</b>
                    <div className="small muted">{fmtDate(u.date || u.created_at)}</div>
                    {u.description && <div className="small mt">{u.description}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ padding: '20px 32px' }}>
            <div className="small muted">RERA: <b style={{ color: 'var(--text)' }}>{rera || 'Not available'}</b></div>
            <div className="small muted mt">© {new Date().getFullYear()} {builder.name}. All rights reserved.</div>
          </div>
        </div>
      </div>

      {qr && (
        <Modal title="Scan to view catalogue" onClose={() => setQr(null)}>
          <div className="flex" style={{ flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <img src={qr} alt="QR code" style={{ width: 180, height: 180, borderRadius: 10, border: '1px solid var(--border)' }} />
            <div className="small" style={{ wordBreak: 'break-all', textAlign: 'center' }}>{shareUrl}</div>
            <Button variant="primary" onClick={() => window.open(shareUrl, '_blank')}>Open</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
