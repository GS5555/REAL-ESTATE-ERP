const BASE = '/api';

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const token = localStorage.getItem('pp_token');
  const h = { 'Content-Type': 'application/json', ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: h,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (e) {
    throw new Error('Network error — are you online?');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (res.status === 202 && data && data.queued) {
    return { queued: true };
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    if (res.status === 401) {
      localStorage.removeItem('pp_token');
      if (!location.pathname.startsWith('/login') && !location.pathname.startsWith('/portal')) {
        location.href = '/login';
      }
    }
    throw err;
  }
  return data;
}

export const api = {
  get: (p, q) => request(p + (q ? '?' + new URLSearchParams(q).toString() : '')),
  post: (p, body) => request(p, { method: 'POST', body }),
  put: (p, body) => request(p, { method: 'PUT', body }),
  patch: (p, body) => request(p, { method: 'PATCH', body }),
  del: (p) => request(p, { method: 'DELETE' }),
  upload: (p, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return request(p, { method: 'POST', headers: {}, body: undefined });
  },
  // Export/csv downloads: fetch with the JWT header (plain <a href> links can't
  // send Authorization, which caused 401 Unauthorized), then trigger a download.
  download: async (path, q) => {
    const token = localStorage.getItem('pp_token');
    const h = { 'Content-Type': 'application/json' };
    if (token) h.Authorization = `Bearer ${token}`;
    const url = BASE + path + (q ? '?' + new URLSearchParams(q).toString() : '');
    const res = await fetch(url, { headers: h });
    if (!res.ok) {
      let msg = `Export failed (${res.status})`;
      try { const d = await res.json(); msg = d.error || msg; } catch {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    let name = 'export.csv';
    const m = /filename="?([^";]+)"?/i.exec(disposition);
    if (m) name = m[1];
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  },
  // Share a file (Excel/PDF) via the native share sheet (WhatsApp, Email, Drive,
  // and other installed apps). Falls back to a plain download when the browser
  // does not support sharing files. Returns 'shared' | 'downloaded' | false.
  shareFile: async (path, q, title = '') => {
    const token = localStorage.getItem('pp_token');
    const h = { 'Content-Type': 'application/json' };
    if (token) h.Authorization = `Bearer ${token}`;
    const url = BASE + path + (q ? '?' + new URLSearchParams(q).toString() : '');
    const res = await fetch(url, { headers: h });
    if (!res.ok) {
      let msg = `Sharing failed (${res.status})`;
      try { const d = await res.json(); msg = d.error || msg; } catch {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    let name = 'file.csv';
    const m = /filename="?([^";]+)"?/i.exec(disposition);
    if (m) name = m[1];
    const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      try {
        await navigator.share({ files: [file], title: title || name, text: title || name });
        return 'shared';
      } catch (e) {
        if (e && e.name === 'AbortError') return 'shared';
      }
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);
    return 'downloaded';
  }
};

export function fmtMoney(n) {
  if (n == null || isNaN(n)) return '₹0';
  if (n >= 10000000) return '₹' + (n / 10000000).toFixed(2) + ' Cr';
  if (n >= 100000) return '₹' + (n / 100000).toFixed(2) + ' L';
  return '₹' + Number(n).toLocaleString('en-IN');
}

export function fmtDate(d) {
  if (!d) return '—';
  const x = new Date(d);
  if (isNaN(x)) return String(d).slice(0, 10);
  return x.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(d) {
  if (!d) return '—';
  const x = new Date(d);
  if (isNaN(x)) return '—';
  return x.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ' ' + x.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

export function initials(name) {
  if (!name) return '?';
  return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}
