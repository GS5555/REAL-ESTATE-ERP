import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { api, fmtMoney, fmtDate } from '../api';
import { Card, Button, Badge, Field, Input, Select, Textarea, DataTable, Modal, Empty, Tabs } from '../components/ui';
import ImageUpload from '../components/ImageUpload';
import { useToast } from '../components/ui';

const EMPTY_FORM = { title: '', category: 'Residential', subtype: 'Apartment', transaction_type: 'Sale', price: '', size: '', location: '', city: '', status: 'active', contact_name: '', contact_phone: '', images: [] };
const STATUS_TONES = { active: 'green', pending: 'amber', sold: 'purple', withdrawn: 'gray' };

export default function Listings() {
  const { can } = useStore();
  const toast = useToast();
  const [meta, setMeta] = useState({ categories: {}, transactionTypes: [], sources: [] });
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [ttype, setTtype] = useState('');
  const [status, setStatus] = useState('');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [impModal, setImpModal] = useState(false);
  const [impTab, setImpTab] = useState('b2b');
  const [imp, setImp] = useState({ source: 'MagicBricks', rows: '', count: 10 });
  const [b2b, setB2b] = useState({ source: '99acres', url: '', images: '', busy: false });

  const load = () => {
    api.get('/listings', { q, category, transaction_type: ttype, status, price_min: priceMin, price_max: priceMax }).then((d) => { setItems(d.items || []); setTotal(d.total || 0); }).catch(() => {});
  };
  useEffect(() => { load(); }, [q, category, ttype, status, priceMin, priceMax]);
  useEffect(() => { api.get('/listings/meta').then(setMeta).catch(() => {}); }, []);

  const openNew = () => { setEditing(null); setForm(EMPTY_FORM); setModal(true); };
  const openEdit = (r) => { setEditing(r); setForm({ ...EMPTY_FORM, ...r }); setModal(true); };

  const save = async () => {
    if (!form.title) return toast('Title required', 'error');
    try {
      if (editing) await api.patch(`/listings/${editing.id}`, form);
      else await api.post('/listings', form);
      setModal(false); load(); toast(editing ? 'Listing updated' : 'Listing created', 'success');
    } catch (e) { toast(e.message, 'error'); }
  };

  const importDemo = async () => {
    try {
      const r = await api.post('/listings/import/demo', { source: imp.source, count: Number(imp.count) || 10 });
      toast(`Demo import: ${r.created} created, ${r.duplicates || 0} duplicates`, 'success');
      setImpModal(false); load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const importJson = async () => {
    let rows;
    try { rows = JSON.parse(imp.rows); } catch { return toast('Rows are not valid JSON', 'error'); }
    try {
      const r = await api.post('/listings/import', { source: imp.source, rows });
      toast(`Import: ${r.created} created, ${r.updated} updated, ${r.duplicates} duplicates, ${r.skipped} skipped`, 'success');
      setImpModal(false); load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const importB2b = async () => {
    const urls = b2b.images.split(/\n|,/).map((s) => s.trim()).filter(Boolean);
    if (!b2b.url && !urls.length) return toast('Paste a portal URL or image URLs', 'error');
    setB2b({ ...b2b, busy: true });
    try {
      const r = await api.post('/listings/b2b/import', { source: b2b.source, url: b2b.url, images: urls });
      toast(`B2B import: ${r.imagesImported || 0} images saved from ${r.source || b2b.source}${r.listing ? ' + listing created' : ''}`, 'success');
      setImpModal(false); load();
    } catch (e) { toast(e.message, 'error'); }
    setB2b({ ...b2b, busy: false });
  };

  const subtypes = (meta.categories && meta.categories[form.category]) || [];

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ fontSize: 20 }}>Property Listings</h2>
        <div className="grow" />
        {can('listing.import') && <Button onClick={() => setImpModal(true)}>↑ Import</Button>}
        {can('listing.export') && <Button onClick={() => api.download('/listings/export/csv').catch((e) => toast(e.message, 'error'))}>⤓ Export</Button>}
        {can('listing.create') && <Button variant="primary" onClick={openNew}>+ New</Button>}
      </div>

      <div className="toolbar">
        <Input className="search-input" placeholder="Search title / location…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {Object.keys(meta.categories || {}).map((c) => <option key={c}>{c}</option>)}
        </Select>
        <Select value={ttype} onChange={(e) => setTtype(e.target.value)}>
          <option value="">All types</option>
          {(meta.transactionTypes || []).map((t) => <option key={t}>{t}</option>)}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option>active</option><option>draft</option><option>sold</option><option>rented</option><option>expired</option>
        </Select>
        <Input type="number" placeholder="Min price" style={{ width: 110 }} value={priceMin} onChange={(e) => setPriceMin(e.target.value)} />
        <Input type="number" placeholder="Max price" style={{ width: 110 }} value={priceMax} onChange={(e) => setPriceMax(e.target.value)} />
        {(status || priceMin || priceMax) && <Button sm variant="ghost" onClick={() => { setStatus(''); setPriceMin(''); setPriceMax(''); }}>✕</Button>}
      </div>

      <Card pad={false}>
        {items.length === 0 ? <Empty text="No listings found" /> : (
          <DataTable
            rows={items}
            columns={[
              { key: 'title', label: 'Title', render: (r) => <div className="flex items-center gap"><img src={(r.images || [])[0] || ''} alt="" style={{ width: 44, height: 40, objectFit: 'cover', borderRadius: 6, background: '#f1f5f9' }} /><div><b>{r.title}</b><div className="small muted">{r.location}</div></div></div> },
              { key: 'category', label: 'Category', render: (r) => <div><Badge tone="brand">{r.category}</Badge> <span className="small muted">{r.subtype}</span></div> },
              { key: 'transaction_type', label: 'Type', render: (r) => <Badge tone="gray">{r.transaction_type}</Badge> },
              { key: 'price', label: 'Price', render: (r) => fmtMoney(r.price) },
              { key: 'city', label: 'Location' },
              { key: 'source', label: 'Source' },
              { key: 'status', label: 'Status', render: (r) => <Badge tone={STATUS_TONES[r.status] || 'gray'}>{r.status}</Badge> },
              { key: 'updated_at', label: 'Updated', render: (r) => fmtDate(r.updated_at) },
              { key: 'action', label: '', render: (r) => <Button sm ghost onClick={() => openEdit(r)}>Edit</Button> }
            ]}
          />
        )}
      </Card>
      <div className="small muted mt">{total} listings</div>

      {modal && (
        <Modal title={editing ? 'Edit Listing' : 'New Listing'} onClose={() => setModal(false)} wide footer={<>
          <Button onClick={() => setModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!form.title}>Save</Button>
        </>}>
          <div className="frm-grid">
            <Field label="Title" full><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Category"><Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{Object.keys(meta.categories || {}).map((c) => <option key={c}>{c}</option>)}</Select></Field>
            <Field label="Subtype"><Select value={form.subtype} onChange={(e) => setForm({ ...form, subtype: e.target.value })}><option value="">—</option>{subtypes.map((s) => <option key={s}>{s}</option>)}</Select></Field>
            <Field label="Transaction type"><Select value={form.transaction_type} onChange={(e) => setForm({ ...form, transaction_type: e.target.value })}>{(meta.transactionTypes || []).map((t) => <option key={t}>{t}</option>)}</Select></Field>
            <Field label="Price (₹)"><Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field>
            <Field label="Size (sq ft)"><Input type="number" value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} /></Field>
            <Field label="Location"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
            <Field label="City"><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
            <Field label="Status"><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option>active</option><option>pending</option><option>sold</option><option>withdrawn</option></Select></Field>
            <Field label="Contact name"><Input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} /></Field>
            <Field label="Contact phone"><Input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} /></Field>
          </div>
          <div className="mt">
            <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: 'block' }}>Listing Photos</label>
            <ImageUpload images={form.images || []} onChange={(images) => setForm({ ...form, images })} />
          </div>
          <div className="mt">
            <Field label="Description" full><Textarea value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          </div>
        </Modal>
      )}

      {impModal && (
        <Modal title="Import Listings" onClose={() => setImpModal(false)} wide>
          <Tabs tabs={[{ key: 'b2b', label: 'B2B Portal (Images)' }, { key: 'feed', label: 'JSON Feed / Demo' }]} active={impTab} onChange={setImpTab} />
          {impTab === 'b2b' && (
            <div>
              <div className="frm-grid">
                <Field label="Portal"><Select value={b2b.source} onChange={(e) => setB2b({ ...b2b, source: e.target.value })}>{(meta.sources || []).filter((s) => ['99acres', 'Housing.com', 'MagicBricks', 'NoBroker'].includes(s)).map((s) => <option key={s}>{s}</option>)}</Select></Field>
                <Field label="Portal listing URL (auto-fetch images)"><Input value={b2b.url} onChange={(e) => setB2b({ ...b2b, url: e.target.value })} placeholder="https://www.99acres.com/…" /></Field>
              </div>
              <div className="mb">
                <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: 'block' }}>Direct image URLs (one per line / comma-separated)</label>
                <Textarea value={b2b.images} onChange={(e) => setB2b({ ...b2b, images: e.target.value })} placeholder="https://img.staticmb.com/…/photo.jpg&#10;https://imgs.99acres.com/…/photo2.jpg" style={{ minHeight: 90 }} />
              </div>
              <div className="small muted mb">Images are fetched server-side and stored in your uploads so they never break due to portal hotlink protection.</div>
              <Button variant="primary" onClick={importB2b} disabled={b2b.busy}>{b2b.busy ? 'Importing…' : 'Import from Portal'}</Button>
            </div>
          )}
          {impTab === 'feed' && (
            <div>
              <div className="frm-grid">
                <Field label="Source"><Select value={imp.source} onChange={(e) => setImp({ ...imp, source: e.target.value })}>{(meta.sources || []).map((s) => <option key={s}>{s}</option>)}</Select></Field>
                <Field label="Demo count"><Input type="number" value={imp.count} onChange={(e) => setImp({ ...imp, count: e.target.value })} /></Field>
                <Field label="JSON rows (paste feed)" full><Textarea value={imp.rows} onChange={(e) => setImp({ ...imp, rows: e.target.value })} placeholder='[{"title":"2 BHK Apartment","price":"₹1.2 Cr","location":"Andheri East"}]' style={{ minHeight: 120 }} /></Field>
              </div>
              <div className="flex gap">
                <Button variant="primary" onClick={importDemo}>Import demo data</Button>
                <Button variant="success" onClick={importJson}>Import pasted JSON</Button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
