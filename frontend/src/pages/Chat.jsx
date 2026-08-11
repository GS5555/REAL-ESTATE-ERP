import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { api, fmtDateTime } from '../api';
import { Card, Button, Input, Badge, Modal, Empty } from '../components/ui';
import { useToast } from '../components/ui';

const EMOJIS = ['👍', '❤️', '😂'];

export default function Chat() {
  const { user, can } = useStore();
  const toast = useToast();
  const [convs, setConvs] = useState([]);
  const [open, setOpen] = useState(null);
  const [thread, setThread] = useState(null);
  const [body, setBody] = useState('');
  const [newModal, setNewModal] = useState(false);
  const [users, setUsers] = useState([]);
  const [picked, setPicked] = useState([]);
  const [title, setTitle] = useState('');
  const bottom = useRef(null);
  const typing = useRef(0);

  const loadConvs = () => api.get('/conversations').then(setConvs).catch(() => {});
  useEffect(() => { loadConvs(); const t = setInterval(loadConvs, 3000); return () => clearInterval(t); }, []);

  useEffect(() => { api.get('/orgchart/org').then((o) => setUsers(o.users || [])).catch(() => api.get('/users').then(setUsers).catch(() => setUsers([]))); }, []);

  const openConv = (id) => {
    setOpen(id);
    api.get(`/conversations/${id}`).then((d) => { setThread(d); api.post(`/conversations/${id}/read`).catch(() => {}); }).catch(() => setThread(null));
  };

  const send = async () => {
    if (!body.trim() || !open) return;
    try {
      await api.post(`/conversations/${open}/messages`, { body });
      setBody('');
      const d = await api.get(`/conversations/${open}`);
      setThread(d);
    } catch (e) { toast(e.message, 'error'); }
  };

  const onTyping = () => {
    if (Date.now() - typing.current > 3000 && open) {
      typing.current = Date.now();
      api.post(`/conversations/${open}/typing`, { typing: true }).catch(() => {});
    }
  };

  const react = async (mid, emoji) => {
    if (!open) return;
    await api.post(`/conversations/${open}/messages/${mid}/react`, { emoji }).catch(() => {});
    const d = await api.get(`/conversations/${open}`);
    setThread(d);
  };

  const moderate = async (mid) => {
    await api.del(`/conversations/${open}/messages/${mid}`).catch(() => {});
    const d = await api.get(`/conversations/${open}`);
    setThread(d);
  };

  const startChat = async () => {
    if (!picked.length) return toast('Pick at least one member', 'error');
    try {
      const r = await api.post('/conversations', { kind: picked.length > 1 ? 'group' : 'direct', title: title || null, member_ids: picked });
      setNewModal(false); setPicked([]); setTitle('');
      loadConvs(); openConv(r.id); toast('Chat started', 'success');
    } catch (e) { toast(e.message, 'error'); }
  };

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [thread?.messages?.length]);

  const me = user?.id;
  const others = (thread?.members || []).filter((m) => m.id !== me);
  const convTitle = open && (thread?.conversation?.title || others.map((m) => m.name).join(', ') || 'Chat');

  return (
    <div style={{ display: 'flex', gap: 14, height: 'calc(100vh - 140px)' }}>
      <Card pad={false} style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="toolbar" style={{ padding: '12px 14px', marginBottom: 0 }}>
          <b>Conversations</b>
          {can('chat.moderate') && <Badge tone="purple" title="Admins can view every chat and group">All</Badge>}
          <div className="grow" />
          <Button sm variant="primary" onClick={() => setNewModal(true)}>+ New</Button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {convs.length === 0 && <Empty text="No conversations yet" />}
          {convs.map((c) => (
            <div key={c.id} onClick={() => openConv(c.id)} style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: open === c.id ? 'var(--brand-light)' : undefined }}>
              <div className="flex between items-center">
                <b className="small">{c.title || (c.kind === 'direct' ? 'Direct chat' : c.kind)}</b>
                {c.unread > 0 && <Badge tone="red">{c.unread}</Badge>}
              </div>
              <div className="small muted">{c.kind} chat</div>
            </div>
          ))}
        </div>
      </Card>

      <Card pad={false} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!open ? <Empty text="Select a conversation to start chatting" /> : (
          <>
            <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>{convTitle}</div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
              {(thread?.messages || []).map((m) => {
                const own = m.sender_id === me;
                const reactions = (() => { try { return JSON.parse(m.reactions || '{}'); } catch { return {}; } })();
                return (
                  <div key={m.id} className="mb" style={{ display: 'flex', flexDirection: 'column', alignItems: own ? 'flex-end' : 'flex-start' }}>
                    <div style={{ background: own ? 'var(--brand)' : '#eef1f8', color: own ? '#fff' : 'var(--text)', borderRadius: 12, borderBottomRightRadius: own ? 4 : 12, borderBottomLeftRadius: own ? 12 : 4, padding: '8px 12px', maxWidth: '70%' }}>
                      {!own && <div className="small" style={{ fontWeight: 600, color: 'var(--brand-dark)' }}>{m.sender_name}</div>}
                      <div>{m.body}</div>
                    </div>
                    <div className="small muted" style={{ marginTop: 2 }}>{fmtDateTime(m.created_at)}</div>
                    <div className="flex gap items-center" style={{ marginTop: 2 }}>
                      {EMOJIS.map((e) => <button key={e} className="btn ghost sm" onClick={() => react(m.id, e)}>{e}</button>)}
                      {Object.values(reactions).filter(Boolean).map((r, i) => <Badge key={i} tone="brand">{r}</Badge>)}
                      {can('chat.moderate') && <button className="btn ghost sm" onClick={() => moderate(m.id)}>✕</button>}
                    </div>
                  </div>
                );
              })}
              <div ref={bottom} />
            </div>
            <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10 }}>
              <Input value={body} onChange={(e) => { setBody(e.target.value); onTyping(); }} placeholder="Type a message…" onKeyDown={(e) => e.key === 'Enter' && send()} />
              <Button variant="primary" onClick={send}>Send</Button>
            </div>
          </>
        )}
      </Card>

      {newModal && (
        <Modal title="New Chat" onClose={() => setNewModal(false)} footer={<>
          <Button onClick={() => setNewModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={startChat} disabled={!picked.length}>Start Chat</Button>
        </>}>
          <Field label="Group name (optional)"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="For group chats" /></Field>
          <label className="field" style={{ display: 'block', fontSize: 12.5, fontWeight: 600 }}>Members</label>
          <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
            {users.map((u) => (
              <label key={u.id} className="flex items-center gap" style={{ padding: '6px 4px', cursor: 'pointer' }}>
                <input type="checkbox" checked={picked.includes(u.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, u.id] : picked.filter((id) => id !== u.id))} />
                <span>{u.name} <span className="small muted">({u.role})</span></span>
              </label>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
