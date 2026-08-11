import { useRef, useState } from 'react';
import { api } from '../api';
import { useToast } from './ui';

// Reusable multi-image uploader: base64 → POST /api/upload → /uploads/<file>
export default function ImageUpload({ images = [], onChange, max = 10, accept = 'image/*' }) {
  const toast = useToast();
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const pick = async (files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    setBusy(true);
    try {
      for (const f of list) {
        if (images.length >= max) { toast(`Max ${max} images`, 'error'); break; }
        const dataUrl = await readFile(f);
        const r = await api.post('/upload', { data: dataUrl, filename: f.name });
        onChange([...images, r.url]);
        images = [...images, r.url];
      }
    } catch (e) {
      toast(e.message || 'Upload failed', 'error');
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  const remove = (i) => onChange(images.filter((_, x) => x !== i));

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        {images.map((u, i) => (
          <div key={i} style={{ position: 'relative' }}>
            <img src={u} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
            <button
              type="button"
              onClick={() => remove(i)}
              style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', border: 'none', background: '#ef4444', color: '#fff', fontSize: 11, cursor: 'pointer', lineHeight: '20px', textAlign: 'center', padding: 0 }}
            >✕</button>
          </div>
        ))}
        {images.length === 0 && !busy && (
          <div style={{ width: 72, height: 72, borderRadius: 8, border: '1px dashed var(--border)', display: 'grid', placeItems: 'center', color: '#94a3b8', fontSize: 11, textAlign: 'center' }}>No images</div>
        )}
      </div>
      <input ref={inputRef} type="file" accept={accept} multiple style={{ display: 'none' }} onChange={(e) => pick(e.target.files)} />
      <button type="button" className="btn sm" disabled={busy || images.length >= max} onClick={() => inputRef.current && inputRef.current.click()}>
        {busy ? 'Uploading…' : `+ Add Image${images.length ? ` (${images.length}/${max})` : ''}`}
      </button>
    </div>
  );
}

function readFile(f) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read file'));
    r.readAsDataURL(f);
  });
}
