import { createContext, useContext, useState } from 'react';
import { initials } from '../api';

export function Card({ children, className = '', pad = true }) {
  return <div className={`card ${pad ? 'card-pad' : ''} ${className}`}>{children}</div>;
}

export function Stat({ label, value, sub, color }) {
  return (
    <Card className="stat">
      <div className="s-label">{label}</div>
      <div className="s-value" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="s-sub">{sub}</div>}
    </Card>
  );
}

export function Badge({ children, tone = 'gray' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export const PriorityTone = { Hot: 'red', Warm: 'amber', Cold: 'blue', Lost: 'gray', Junk: 'gray' };

export function Button({ children, onClick, variant, className = '', type = 'button', disabled }) {
  return (
    <button type={type} className={`btn ${variant || ''} ${className}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={wide ? { maxWidth: 900 } : undefined}>
        <div className="m-head">
          <span>{title}</span>
          <button className="btn ghost sm" onClick={onClose}>✕</button>
        </div>
        <div className="m-body">{children}</div>
        {footer && <div className="m-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, full }) {
  return <div className={`field ${full ? 'full' : ''}`}><label>{label}</label>{children}</div>;
}

export function Input(props) { return <input className="input" {...props} />; }
export function Select({ children, ...props }) { return <select className="select" {...props}>{children}</select>; }
export function Textarea(props) { return <textarea className="textarea" {...props} />; }

export function DataTable({ columns, rows, empty = 'No data', onRowClick }) {
  if (!rows || !rows.length) return <div className="empty">{empty}</div>;
  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead><tr>{columns.map((c, i) => <th key={i}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} onClick={onRowClick ? () => onRowClick(r) : undefined} style={onRowClick ? { cursor: 'pointer' } : undefined}>
              {columns.map((c, j) => <td key={j}>{c.render ? c.render(r) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Avatar({ name, size }) {
  return <span className={`avatar ${size === 'lg' ? 'lg' : ''}`}>{initials(name)}</span>;
}

export function Empty({ text = 'Nothing here yet' }) {
  return <div className="empty">{text}</div>;
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <div key={t.key} className={`tab ${active === t.key ? 'active' : ''}`} onClick={() => onChange(t.key)}>{t.label}</div>
      ))}
    </div>
  );
}

const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = (msg, type = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
  };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function Spinner() {
  return <div className="empty"><span style={{ fontSize: 20 }}>⏳</span></div>;
}

export function Switch({ checked, onChange }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="slider" />
    </label>
  );
}
