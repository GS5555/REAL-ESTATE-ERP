import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import { Card, Button, Field, Input, Select, Tabs, Badge, Stat, DataTable, Modal } from '../components/ui';
import { useToast } from '../components/ui';

const TYPE_LABEL = { employee: 'Employee', broker: 'Broker', subbroker: 'Sub-broker' };

export default function Referrals() {
  const { can } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState('referrers');
  const [cfg, setCfg] = useState({ enabled: true, defaultAmount: 5000, currency: 'INR' });
  const [people, setPeople] = useState([]);
  const [stats, setStats] = useState(null);
  const [rewards, setRewards] = useState([]);
  const [myRef, setMyRef] = useState(null);
  const [busy, setBusy] = useState(false);
  const [amountModal, setAmountModal] = useState(null);

  const isAdmin = can('subbroker.view') || can('settings.edit');

  const load = () => {
    if (isAdmin) {
      api.get('/referrals/config').then((r) => setCfg(r.config || {})).catch(() => {});
      api.get('/referrals/links').then((r) => { setPeople(r.people || []); setStats(r.stats || null); }).catch(() => {});
      api.get('/referrals/rewards').then((r) => setRewards(r.rewards || [])).catch(() => {});
    } else {
      api.get('/referrals/my').then((r) => setMyRef(r)).catch(() => {});
    }
  };
  useEffect(() => { load(); }, []);

  const saveConfig = async () => {
    setBusy(true);
    try {
      await api.put('/referrals/config', cfg);
      toast('Referral settings saved', 'success');
      load();
    } catch (e) { toast(e.message || 'Save failed', 'error'); }
    setBusy(false);
  };

  const updateAmount = async (code) => {
    try {
      await api.patch(`/referrals/links/${code}`, { amount: Number(amountModal.amount), status: amountModal.status });
      toast('Referral amount updated', 'success');
      setAmountModal(null);
      load();
    } catch (e) { toast(e.message || 'Update failed', 'error'); }
  };

  const markPaid = async (id) => {
    await api.patch(`/referrals/rewards/${id}`, { status: 'paid' });
    toast('Reward marked paid', 'success');
    load();
  };

  const copy = (text) => {
    navigator.clipboard?.writeText(text).then(() => toast('Copied to clipboard', 'success')).catch(() => toast('Copy failed', 'error'));
  };

  const tabs = isAdmin
    ? [
        { key: 'referrers', label: 'Referral Links' },
        { key: 'settings', label: 'Settings & Amount' },
        { key: 'rewards', label: 'Rewards' }
      ]
    : [{ key: 'referrers', label: 'My Referral Link' }];

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ fontSize: 20 }}>Referrals</h2>
        <div className="grow" />
        <Badge tone="brand">Refer &amp; Earn</Badge>
      </div>
      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {/* Stats strip */}
      {isAdmin && tab !== 'settings' && stats && (
        <div className="grid c4 mb">
          <Stat label="Referral Links" value={stats.total} sub={`${stats.active} active`} color="var(--brand)" />
          <Stat label="Clicks" value={stats.clicks} sub="total link clicks" />
          <Stat label="Referred Leads" value={stats.leads} sub={`${stats.won} won`} color="var(--green)" />
          <Stat label="Pending Amount" value={fmtMoney(stats.pending_amount)} sub={`${fmtMoney(stats.paid_amount)} paid`} color="var(--amber)" />
        </div>
      )}

      {tab === 'referrers' && !isAdmin && myRef && (
        <div className="grid c2">
          <Card>
            <h3 className="mb">Your Referral Link</h3>
            <div className="small muted mb">Share this link with friends, clients and colleagues. When a referred lead converts into a deal, you earn the referral amount.</div>
            <Field label="Referral code">
              <div className="flex gap">
                <Input readOnly value={myRef.referral?.ref_code || ''} />
                <Button onClick={() => copy(myRef.referral?.ref_code || '')}>Copy</Button>
              </div>
            </Field>
            <Field label="Referral link">
              <div className="flex gap">
                <Input readOnly value={myRef.share?.url || ''} />
                <Button onClick={() => copy(myRef.share?.url || '')}>Copy</Button>
              </div>
            </Field>
            <div className="small muted mb">Referral amount: <b>{fmtMoney(myRef.referral?.amount)}</b></div>
            <h4 className="mb">Share</h4>
            <div className="flex gap">
              <Button sm onClick={() => window.open(myRef.share?.whatsapp, '_blank')}>WhatsApp</Button>
              <Button sm onClick={() => window.location.href = myRef.share?.email}>Email</Button>
              <Button sm onClick={() => window.open(myRef.share?.twitter, '_blank')}>X / Twitter</Button>
              <Button sm onClick={() => window.open(myRef.share?.facebook, '_blank')}>Facebook</Button>
              <Button sm onClick={() => window.open(myRef.share?.linkedin, '_blank')}>LinkedIn</Button>
            </div>
          </Card>
          <Card>
            <h3 className="mb">How it works</h3>
            <div className="small" style={{ lineHeight: 1.7 }}>
              1. Copy your unique referral link above.<br />
              2. Share it via WhatsApp, email or social media.<br />
              3. When a referred lead books or wins a deal, your referral reward is reserved automatically.<br />
              4. The admin approves and pays out rewards.
            </div>
          </Card>
        </div>
      )}

      {tab === 'referrers' && isAdmin && (
        <Card pad={false}>
          {people.length === 0 ? (
            <div className="empty">No employees, brokers or sub-brokers found yet. Add them and referral links are created automatically.</div>
          ) : (
            <DataTable
              rows={people}
              columns={[
                { key: 'name', label: 'Referrer', render: (r) => <div><b>{r.name}</b><div className="small muted">{TYPE_LABEL[r.type]} · {r.phone || '—'}</div></div> },
                { key: 'ref_code', label: 'Code', render: (r) => <Badge tone="brand">{r.referral?.ref_code}</Badge> },
                { key: 'amount', label: 'Amount', render: (r) => (
                  <div className="flex gap items-center">
                    <span>{fmtMoney(r.referral?.amount)}</span>
                    <Button sm ghost onClick={() => setAmountModal({ code: r.referral?.ref_code, name: r.name, amount: r.referral?.amount, status: r.referral?.status })}>Edit</Button>
                  </div>
                ) },
                { key: 'clicks', label: 'Clicks', render: (r) => r.referral?.clicks || 0 },
                { key: 'leads', label: 'Leads', render: (r) => r.lead_count || 0 },
                { key: 'pending', label: 'Pending', render: (r) => fmtMoney(r.pending || 0) },
                { key: 'paid', label: 'Paid', render: (r) => fmtMoney(r.paid || 0) },
                { key: 'share', label: 'Share', render: (r) => (
                  <Button sm ghost onClick={() => window.open(`/ref/${r.referral?.ref_code}`, '_blank')}>Share</Button>
                ) }
              ]}
            />
          )}
        </Card>
      )}

      {tab === 'settings' && isAdmin && (
        <div className="grid c2">
          <Card>
            <h3 className="mb">Referral Program Settings</h3>
            <Field label="Default referral amount">
              <Input type="number" value={cfg.defaultAmount} onChange={(e) => setCfg({ ...cfg, defaultAmount: e.target.value })} />
            </Field>
            <Field label="Currency">
              <Select value={cfg.currency || 'INR'} onChange={(e) => setCfg({ ...cfg, currency: e.target.value })}>
                <option>INR</option><option>USD</option><option>AED</option>
              </Select>
            </Field>
            <Field label="Landing title">
              <Input value={cfg.landingTitle || ''} onChange={(e) => setCfg({ ...cfg, landingTitle: e.target.value })} placeholder="Refer & Earn — company name" />
            </Field>
            <Button variant="primary" disabled={busy} onClick={saveConfig}>{busy ? 'Saving…' : 'Save Settings'}</Button>
            <div className="small muted mt">The default amount applies to new referral links. You can override it per referrer from the Referral Links tab.</div>
          </Card>
          <Card>
            <h3 className="mb">Referral calculation</h3>
            <div className="small" style={{ lineHeight: 1.8 }}>
              <b>When does a reward get reserved?</b> A reward is created the moment a lead arrives through a referral link (code attached).<br />
              <b>How is the amount decided?</b> The per-referrer amount on the Referral Links tab; falls back to the default amount.<br />
              <b>Who can manage amounts?</b> Super admin, company admin and any role with the "Manage Sub-brokers" permission.<br />
              <b>Pay-out:</b> Rewards start as <Badge tone="amber">pending</Badge> and are moved to <Badge tone="green">paid</Badge> from the Rewards tab.
            </div>
          </Card>
        </div>
      )}

      {tab === 'rewards' && isAdmin && (
        <Card pad={false}>
          {rewards.length === 0 ? <div className="empty">No rewards yet.</div> : (
            <DataTable
              rows={rewards}
              columns={[
                { key: 'created_at', label: 'Date', render: (r) => r.created_at },
                { key: 'referrer_name', label: 'Referrer', render: (r) => <div><b>{r.referrer_name}</b><div className="small muted">{TYPE_LABEL[r.referrer_type] || r.referrer_type}</div></div> },
                { key: 'lead_name', label: 'Referred Lead', render: (r) => <div>{r.lead_name}<div className="small muted">{r.lead_phone}</div></div> },
                { key: 'amount', label: 'Amount', render: (r) => fmtMoney(r.amount) },
                { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'paid' ? 'green' : 'amber'}>{r.status}</Badge> },
                { key: 'act', label: '', render: (r) => r.status === 'pending' && <Button sm ghost onClick={() => markPaid(r.id)}>Mark Paid</Button> }
              ]}
            />
          )}
        </Card>
      )}

      {amountModal && (
        <Modal title={`Edit referral amount — ${amountModal.name}`} onClose={() => setAmountModal(null)} footer={<>
          <Button onClick={() => setAmountModal(null)}>Cancel</Button>
          <Button variant="primary" onClick={() => updateAmount(amountModal.code)}>Save</Button>
        </>}>
          <div className="frm-grid">
            <Field label="Referral amount"><Input type="number" value={amountModal.amount} onChange={(e) => setAmountModal({ ...amountModal, amount: e.target.value })} /></Field>
            <Field label="Status">
              <Select value={amountModal.status} onChange={(e) => setAmountModal({ ...amountModal, status: e.target.value })}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </Select>
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

function fmtMoney(v) {
  const n = Number(v || 0);
  const cur = '₹';
  return cur + n.toLocaleString('en-IN');
}
