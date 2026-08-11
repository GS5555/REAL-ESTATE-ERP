import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { api } from '../api';
import { Field, Input, Button } from '../components/ui';

export default function Login() {
  const { login, verifyOtp } = useStore();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [slug, setSlug] = useState('skyline');
  const [companies, setCompanies] = useState([]);
  const [brand, setBrand] = useState(null);
  const [otpRequired, setOtpRequired] = useState(false);
  const [mfaUserId, setMfaUserId] = useState(null);
  const [demoOtp, setDemoOtp] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/public/company/list').then(setCompanies).catch(() => {});
  }, []);

  useEffect(() => {
    if (slug) {
      api.get(`/public/branding/${slug}`).then((b) => {
        setBrand(b);
        const theme = b.theme || {};
        const root = document.documentElement.style;
        if (theme.primary) root.setProperty('--brand', theme.primary);
        if (theme.primaryDark) root.setProperty('--brand-dark', theme.primaryDark);
      }).catch(() => setBrand(null));
    }
  }, [slug]);

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const data = await login(email, password);
      if (data && data.otpRequired) {
        setOtpRequired(true);
        setMfaUserId(data.mfaUserId);
        setDemoOtp(data.demoOtp || '');
        return;
      }
      nav('/dashboard');
    } catch (e2) {
      setErr(e2.message);
    } finally { setBusy(false); }
  };

  const submitOtp = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      await verifyOtp(mfaUserId, code);
      nav('/dashboard');
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };

  const brandName = brand?.name || (slug === 'skyline' ? 'Skyline Developers' : slug);

  return (
    <div className="login-bg">
      <div className="login-card">
        {brand?.logo && <img src={brand.logo} alt="logo" style={{ height: 52, marginBottom: 14 }} />}
        <h1>{otpRequired ? 'Verify OTP' : `Welcome to ${brandName}`}</h1>
        <div className="sub">{brand?.name ? 'White-labelled for your organization' : 'Real Estate ERP & CRM Platform'}</div>

        {!otpRequired ? (
          <form onSubmit={submit}>
            <Field label="Company (theme preview)">
              <select className="select" value={slug} onChange={(e) => setSlug(e.target.value)}>
                {companies.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Email">
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="username" />
            </Field>
            <Field label="Password">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
            </Field>
            {err && <div className="badge red mb" style={{ marginBottom: 10 }}>{err}</div>}
            <Button variant="primary" type="submit" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>{busy ? 'Signing in…' : 'Sign in'}</Button>
          </form>
        ) : (
          <form onSubmit={submitOtp}>
            {demoOtp && <div className="badge amber mb" style={{ marginBottom: 10 }}>Demo OTP: {demoOtp}</div>}
            <Field label="One-time password">
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit OTP" maxLength={6} />
            </Field>
            {err && <div className="badge red mb" style={{ marginBottom: 10 }}>{err}</div>}
            <Button variant="primary" type="submit" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>Verify</Button>
          </form>
        )}

        <div className="muted small mt" style={{ marginTop: 18 }}>
          Demo accounts: admin@skyline.dev / Admin@123 · manager@skyline.dev / Manager@123 · rohan@skyline.dev / Exec@12345
        </div>
      </div>
    </div>
  );
}
