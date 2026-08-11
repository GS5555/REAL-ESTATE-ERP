import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Button, Input, Field, Select, Card } from '../components/ui';
import { useToast } from '../components/ui';

export default function ReferralLanding() {
  const { code } = useParams();
  const [sp] = useSearchParams();
  const toast = useToast();
  const [info, setInfo] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '', city: '', budget: '', requirement: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!code) return;
    api.get(`/referrals/share/${code}?company=${sp.get('company') || ''}`)
      .then(setInfo)
      .catch(() => setInfo(null));
    api.post(`/referrals/click/${code}`, { company: sp.get('company') || '' }).catch(() => {});
  }, [code]);

  const submit = async () => {
    if (!form.name || !form.phone) return toast('Please enter your name and phone', 'error');
    setBusy(true);
    try {
      await api.post('/referrals/attribute', { ...form, ref_code: code, company_id: sp.get('company') || '' });
      setDone(true);
    } catch (e) { toast(e.message || 'Submission failed', 'error'); }
    setBusy(false);
  };

  const brand = info?.referrer_name ? `Referred by ${info.referrer_name}` : 'Referral';

  return (
    <div className="login-bg">
      <Card className="login-card" style={{ maxWidth: 460, width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 26 }}>GIFT</div>
          <h2 style={{ margin: '6px 0 4px' }}>{brand}</h2>
          <div className="small muted">You've been referred for personalised real estate guidance.</div>
        </div>

        {done ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: 30 }}>OK</div>
            <h3>Thank you!</h3>
            <p className="small">Our team will get in touch with you shortly.</p>
          </div>
        ) : (
          <div className="frm-grid">
            <Field label="Full name *"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Phone *"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Email"><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="City"><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
            <Field label="Budget (₹)">
              <Select value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })}>
                <option value="">Select budget</option>
                <option>Below 25 Lakh</option><option>25–50 Lakh</option><option>50 Lakh–1 Cr</option>
                <option>1–2 Cr</option><option>Above 2 Cr</option>
              </Select>
            </Field>
            <Field label="Requirement"><Input value={form.requirement} onChange={(e) => setForm({ ...form, requirement: e.target.value })} placeholder="e.g. 3BHK flat in Pune" /></Field>
            <div style={{ gridColumn: '1 / -1' }}>
              <Button variant="primary" disabled={busy} onClick={submit} style={{ width: '100%' }}>{busy ? 'Submitting…' : 'Submit'}</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
