import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { api, fmtDateTime } from '../api';
import { Card, Button, Input, Select, Badge, Modal, Empty, Field } from '../components/ui';
import { useToast } from '../components/ui';

const STATUS_TONES = { open: 'blue', pending: 'amber', resolved: 'green', closed: 'gray' };

export default function SupportChat() {
  const { user } = useStore();
  const toast = useToast();
  const [chats, setChats] = useState([]);
  const [open, setOpen] = useState(null);
  const [thread, setThread] = useState(null);
  const [body, setBody] = useState('');
  const [status, setStatus] = useState('');
  const [newModal, setNewModal] = useState(false);
  const [form, setForm] = useState({ customer_name: '', customer_phone: '', subject: '', channel: 'chat' });
  const bottom = useRef(null);

  const loadChats = () => api.get('/support/chats').then(setChats).catch(() => {});
  useEffect(() => { loadChats(); const t = setInterval(loadChats, 3000); return () => clearInterval(t); }, []);

  const openChat = (id) => {
    setOpen(id);
    api.get(`/support/chats/${id}`).then((d) => { setThread(d); setStatus(d.chat?.status || ''); }).catch(() => setThread(null));
  };

  const reply = async () => {
    if (!body.trim() || !open) return;
    try {
      await api.post(`/support/chats/${open}/messages`, { body, sender_type: 'agent' });
      setBody('');
      const d = await api.get(`/support/chats/${open}`);
      setThread(d);
    } catch (e) { toast(e.message, 'error'); }
  };

  const assignSelf = async () => {
    if (!open) return;
    try { await api.post(`/support/chats/${open}/assign`, { user_id: user.id }); toast('Assigned to you', 'success'); } catch (e) { toast(e.message, 'error'); }
  };

  const changeStatus = async (s) => {
    if (!open) return;
    try { await api.post(`/support/chats/${open}/status`, { status: s }); setStatus(s); loadChats(); toast('Status updated', 'success'); } catch (e) { toast(e.message, 'error'); }
  };

  const create = async () => {
    if (!form.customer_name && !form.customer_phone) return toast('Customer name or phone required', 'error');
    try {
      const r = await api.post('/support/chats', form);
      setNewModal(false); setForm({ customer_name: '', customer_phone: '', subject: '', channel: 'chat' });
      loadChats(); openChat(r.id); toast('Chat created', 'success');
    } catch (e) { toast(e.message, 'error'); }
  };

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [thread?.messages?.length]);

  return (
    <div style={{ display: 'flex', gap: 14, height: 'calc(100vh - 140px)' }}>
      <Card pad={false} style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="toolbar" style={{ padding: '12px 14px', marginBottom: 0 }}>
          <b>Support Inbox</b>
          <div className="grow" />
          <Button sm variant="primary" onClick={() => setNewModal(true)}>+ New</Button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {chats.length === 0 && <Empty text="No support chats" />}
          {chats.map((c) => (
            <div key={c.id} onClick={() => openChat(c.id)} style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: open === c.id ? 'var(--brand-light)' : undefined }}>
              <div className="flex between items-center">
                <b className="small">{c.customer_name || 'Anonymous'}</b>
                <div className="flex gap items-center">
                  <Badge tone={STATUS_TONES[c.status] || 'gray'}>{c.status}</Badge>
                  {c.unread > 0 && <Badge tone="red">{c.unread}</Badge>}
                </div>
              </div>
              <div className="small muted">{c.subject || c.channel} · {c.customer_phone || '—'}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card pad={false} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!open ? <Empty text="Select a chat to reply" /> : (
          <>
            <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <b>{thread?.chat?.customer_name || 'Customer'}</b>
                <span className="small muted"> · {thread?.chat?.customer_phone || '—'} · {thread?.chat?.subject || thread?.chat?.channel}</span>
              </div>
              <Select value={status} onChange={(e) => changeStatus(e.target.value)} style={{ width: 130 }}>
                <option value="open">Open</option>
                <option value="pending">Pending</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </Select>
              <Button sm onClick={assignSelf}>Assign to me</Button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
              {(thread?.messages || []).map((m) => {
                const agent = m.sender_type === 'agent';
                return (
                  <div key={m.id} className="mb" style={{ display: 'flex', flexDirection: 'column', alignItems: agent ? 'flex-end' : 'flex-start' }}>
                    <div style={{ background: agent ? 'var(--brand)' : '#eef1f8', color: agent ? '#fff' : 'var(--text)', borderRadius: 12, borderBottomRightRadius: agent ? 4 : 12, borderBottomLeftRadius: agent ? 12 : 4, padding: '8px 12px', maxWidth: '70%' }}>
                      <div className="small" style={{ fontWeight: 600, color: agent ? '#dbeafe' : 'var(--brand-dark)' }}>{m.sender_name}</div>
                      <div>{m.body}</div>
                    </div>
                    <div className="small muted" style={{ marginTop: 2 }}>{fmtDateTime(m.created_at)}</div>
                  </div>
                );
              })}
              <div ref={bottom} />
            </div>
            <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10 }}>
              <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Reply as agent…" onKeyDown={(e) => e.key === 'Enter' && reply()} />
              <Button variant="primary" onClick={reply}>Send</Button>
            </div>
          </>
        )}
      </Card>

      {newModal && (
        <Modal title="New Support Chat" onClose={() => setNewModal(false)} footer={<>
          <Button onClick={() => setNewModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={create}>Create</Button>
        </>}>
          <div className="frm-grid">
            <Field label="Customer name"><Input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} /></Field>
            <Field label="Customer phone"><Input value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })} /></Field>
            <Field label="Subject"><Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></Field>
            <Field label="Channel"><Select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}><option>chat</option><option>whatsapp</option><option>email</option><option>phone</option><option>website</option></Select></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
