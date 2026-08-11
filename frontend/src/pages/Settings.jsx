import { useEffect, useState, useRef } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import { Card, Button, Field, Input, Select, Textarea, Tabs, Switch, Badge } from '../components/ui';
import { useToast } from '../components/ui';

export default function Settings() {
  const { company, can, refreshNotifs } = useStore();
  const toast = useToast();
  const [settings, setSettings] = useState(company?.settings || {});
  const [tab, setTab] = useState('branding');
  const [flags, setFlags] = useState([]);
  const [apiKeys, setApiKeys] = useState([]);
  const [sub, setSub] = useState(null);
  const logoInputRef = useRef(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [bkCfg, setBkCfg] = useState(null);
  const [bkHist, setBkHist] = useState([]);
  const [bkBusy, setBkBusy] = useState(false);

  const load = () => {
    api.get('/settings').then((co) => setSettings(co.settings || {})).catch(() => {});
    api.get('/webhooks').then(() => {}).catch(() => {});
    api.get('/api-keys').then(setApiKeys).catch(() => {});
    api.get('/subscription').then(setSub).catch(() => {});
    api.get('/backups/config').then((r) => setBkCfg(r.config)).catch(() => {});
    api.get('/backups/history').then((r) => setBkHist(r.backups || [])).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const setPath = (path, value) => {
    setSettings((s) => {
      const copy = JSON.parse(JSON.stringify(s));
      const parts = path.split('.');
      let cur = copy;
      for (let i = 0; i < parts.length - 1; i++) { cur[parts[i]] = cur[parts[i]] || {}; cur = cur[parts[i]]; }
      cur[parts[parts.length - 1]] = value;
      return copy;
    });
  };

  const save = async () => {
    await api.put('/settings', settings);
    toast('Settings saved — branding updates instantly', 'success');
    window.location.reload();
  };

  const readFile = (f) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(f);
  });

  const uploadLogo = async (files) => {
    const f = (files || [])[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) return toast('Please pick an image file (png/svg/jpg)', 'error');
    setLogoBusy(true);
    try {
      const dataUrl = await readFile(f);
      const r = await api.post('/upload', { data: dataUrl, filename: f.name });
      setPath('branding.logo', r.url);
      toast('Logo uploaded — press Save to apply', 'success');
    } catch (e) {
      toast(e.message || 'Upload failed', 'error');
    }
    setLogoBusy(false);
    if (logoInputRef.current) logoInputRef.current.value = '';
  };

  const createKey = async () => {
    const name = prompt('Key name:');
    if (!name) return;
    const r = await api.post('/api-keys', { name, scopes: ['lead.import'] });
    alert(`Save this key now: ${r.key}\nIt won't be shown again.`);
    load();
  };

  const toggleFlag = async (key) => {
    const enabled = flags.find((f) => f.key === key)?.enabled ? 0 : 1;
    await api.post('/feature-flags', { company_id: company.id, key, enabled });
    load();
  };

  const changePlan = async (plan) => {
    if (!confirm(`Switch to ${plan} plan?`)) return;
    await api.put('/subscription', { plan });
    toast(`Plan updated to ${plan}`, 'success');
    load();
  };

  const saveDomain = async () => {
    await api.put('/subscription', { plan: sub.plan, custom_domain: sub.customDomain });
    toast('Custom domain saved', 'success');
    load();
  };

  const saveBackup = async () => {
    await api.put('/backups/config', bkCfg);
    toast('Backup settings saved', 'success');
    load();
  };

  const runBackupNow = async (format) => {
    setBkBusy(true);
    try {
      await api.post('/backups/run', { format });
      toast(`Backup (${format}) started — see history below`, 'success');
      load();
    } catch (e) {
      toast(e.message || 'Backup failed', 'error');
    }
    setBkBusy(false);
  };

  const downloadBackup = (b) => {
    window.location.href = `/api/backups/${b.id}/download`;
  };

  const allFlags = ['ai', 'voice', 'multilang', 'offline', 'qrcode', 'portal', 'callrecord', 'digital_sign', 'kyc', 'biometric'];  const flagLabels = {
    ai: 'AI Features', voice: 'Voice Entry', multilang: 'Multi-language', offline: 'Offline Mode',
    qrcode: 'QR Codes', portal: 'Customer Portal', callrecord: 'Call Recording', digital_sign: 'Digital Signing',
    kyc: 'KYC Verification', biometric: 'Biometric Login'
  };

  const tabs = [
    { key: 'branding', label: 'Branding' },
    { key: 'company', label: 'Company Info' },
    { key: 'banking', label: 'Bank & Tax' },
    { key: 'plan', label: 'Plan & Domain' },
    { key: 'integrations', label: 'Integrations' },
    { key: 'features', label: 'Feature Toggles' },
    { key: 'api', label: 'API & Webhooks' },
    { key: 'backup', label: 'Backup' },
    { key: 'terms', label: 'Terms & Portal' }
  ];

  const b = settings.branding || {};

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ fontSize: 20 }}>Company Settings</h2>
        <div className="grow" />
        {can('settings.edit') && <Button variant="primary" onClick={save}>💾 Save Changes</Button>}
      </div>
      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'branding' && (
        <div className="grid c2">
          <Card>
            <h3 className="mb">White-label Branding</h3>
            <Field label="Company Name"><Input value={b.companyName || ''} onChange={(e) => setPath('branding.companyName', e.target.value)} /></Field>
            <Field label="Tagline"><Input value={b.tagline || ''} onChange={(e) => setPath('branding.tagline', e.target.value)} /></Field>
            <Field label="Company Logo">
              <div className="flex gap">
                <Input value={b.logo || ''} onChange={(e) => setPath('branding.logo', e.target.value)} placeholder="https://…/logo.png or /uploads/…" />
                <Button onClick={() => logoInputRef.current?.click()} disabled={logoBusy}>{logoBusy ? 'Uploading…' : 'Upload'}</Button>
                {b.logo && <Button sm ghost onClick={() => setPath('branding.logo', '')} title="Remove logo">✕</Button>}
                <input ref={logoInputRef} type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" style={{ display: 'none' }} onChange={(e) => uploadLogo(e.target.files)} />
              </div>
              <div className="small muted">Upload your company logo, or paste an external URL above. The logo appears in the app shell, login screen and customer portal.</div>
            </Field>
            <Field label="Primary Theme Color"><div className="flex gap"><input type="color" value={b.theme?.primary || '#2563eb'} onChange={(e) => setPath('branding.theme.primary', e.target.value)} style={{ width: 44, height: 36, border: '1px solid var(--border)', borderRadius: 8, background: 'transparent' }} /><Input value={b.theme?.primary || '#2563eb'} onChange={(e) => setPath('branding.theme.primary', e.target.value)} /></div></Field>
            <Field label="Dark Shade"><Input value={b.theme?.primaryDark || ''} onChange={(e) => setPath('branding.theme.primaryDark', e.target.value)} /></Field>
            <Field label="Accent Color"><div className="flex gap"><input type="color" value={b.theme?.accent || '#f59e0b'} onChange={(e) => setPath('branding.theme.accent', e.target.value)} style={{ width: 44, height: 36, border: '1px solid var(--border)', borderRadius: 8, background: 'transparent' }} /><Input value={b.theme?.accent || '#f59e0b'} onChange={(e) => setPath('branding.theme.accent', e.target.value)} /></div></Field>
            <Field label="Login Screen Image URL (optional)"><Input value={b.loginScreen || ''} onChange={(e) => setPath('branding.loginScreen', e.target.value)} /></Field>
            <Field label="Splash Screen Image URL (optional)"><Input value={b.splashScreen || ''} onChange={(e) => setPath('branding.splashScreen', e.target.value)} /></Field>
          </Card>
          <Card>
            <h3 className="mb">Live Preview</h3>
            <div className="card mb" style={{ background: 'linear-gradient(135deg, var(--brand-dark), var(--brand))', color: '#fff', padding: 24 }}>
              <div className="flex items-center gap mb">
                {b.logo ? <img src={b.logo} style={{ height: 40, width: 40, objectFit: 'contain', background: '#fff', borderRadius: 8 }} alt="logo" /> : <div style={{ width: 40, height: 40, borderRadius: 8, background: '#fff', display: 'grid', placeItems: 'center', color: 'var(--brand)' }}>🏠</div>}
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{b.companyName || 'Your Company'}</div>
                  <div style={{ fontSize: 12, opacity: 0.85 }}>{b.tagline || 'Real Estate ERP & CRM'}</div>
                </div>
              </div>
              <Button variant="primary">Button preview</Button>
            </div>
            <div className="small muted">Theme applies instantly across login, app shell, buttons, charts and customer portal. No code changes needed.</div>
          </Card>
        </div>
      )}

      {tab === 'company' && (
        <div className="grid c2">
          <Card>
            <Field label="GST Number"><Input value={settings.config?.gst || ''} onChange={(e) => setPath('config.gst', e.target.value)} /></Field>
            <Field label="RERA Number"><Input value={settings.config?.rera || ''} onChange={(e) => setPath('config.rera', e.target.value)} /></Field>
            <Field label="Registered Address" full><Textarea value={settings.config?.address || ''} onChange={(e) => setPath('config.address', e.target.value)} /></Field>
            <Field label="Support Phone"><Input value={settings.config?.support?.phone || ''} onChange={(e) => setPath('config.support.phone', e.target.value)} /></Field>
            <Field label="Support Email"><Input value={settings.config?.support?.email || ''} onChange={(e) => setPath('config.support.email', e.target.value)} /></Field>
            <Field label="Website"><Input value={settings.config?.website || ''} onChange={(e) => setPath('config.website', e.target.value)} /></Field>
          </Card>
          <Card>
            <h3 className="mb">Social Media</h3>
            <Field label="Facebook"><Input value={settings.config?.social?.facebook || ''} onChange={(e) => setPath('config.social.facebook', e.target.value)} /></Field>
            <Field label="Instagram"><Input value={settings.config?.social?.instagram || ''} onChange={(e) => setPath('config.social.instagram', e.target.value)} /></Field>
            <Field label="LinkedIn"><Input value={settings.config?.social?.linkedin || ''} onChange={(e) => setPath('config.social.linkedin', e.target.value)} /></Field>
            <h3 className="mb mt">Invoice Template</h3>
            <Select value={settings.config?.invoiceTemplate || 'Standard'} onChange={(e) => setPath('config.invoiceTemplate', e.target.value)}>
              <option>Standard</option><option>Minimal</option><option>Corporate</option>
            </Select>
          </Card>
        </div>
      )}

      {tab === 'banking' && (
        <Card>
          <h3 className="mb">Bank Details (printed on invoices)</h3>
          <div className="frm-grid">
            <Field label="Bank Name"><Input value={settings.config?.bank?.bank || ''} onChange={(e) => setPath('config.bank.bank', e.target.value)} /></Field>
            <Field label="Account Number"><Input value={settings.config?.bank?.account || ''} onChange={(e) => setPath('config.bank.account', e.target.value)} /></Field>
            <Field label="IFSC"><Input value={settings.config?.bank?.ifsc || ''} onChange={(e) => setPath('config.bank.ifsc', e.target.value)} /></Field>
            <Field label="Branch"><Input value={settings.config?.bank?.branch || ''} onChange={(e) => setPath('config.bank.branch', e.target.value)} /></Field>
            <Field label="GST Number"><Input value={settings.config?.gst || ''} onChange={(e) => setPath('config.gst', e.target.value)} /></Field>
            <Field label="RERA Number"><Input value={settings.config?.rera || ''} onChange={(e) => setPath('config.rera', e.target.value)} /></Field>
          </div>
        </Card>
      )}

      {tab === 'plan' && sub && (
        <div className="grid c2">
          <Card>
            <h3 className="mb">Subscription Plan</h3>
            <div className="grid c3 mb" style={{ gap: 10 }}>
              {[['standard', 'Starter'], ['pro', 'Professional'], ['enterprise', 'Enterprise']].map(([key, label]) => (
                <button
                  key={key}
                  className="btn plan-card"
                  style={{ flexDirection: 'column', padding: 16, textAlign: 'center', border: sub.plan === key ? '2px solid var(--brand)' : '1px solid var(--border)' }}
                  onClick={() => changePlan(key)}
                >
                  <b>{label}</b>
                  <div className="small muted">
                    {key === 'standard' ? 'Core CRM' : key === 'pro' ? 'Growth tools' : 'Full platform'}
                  </div>
                  {sub.plan === key && <Badge tone="brand">Active</Badge>}
                </button>
              ))}
            </div>
            <div className="small muted">Changing plan gates/ungates modules instantly (feature flags below).</div>
          </Card>
          <Card>
            <h3 className="mb">White-label Domain</h3>
            <Field label="Custom Domain">
              <Input
                placeholder="app.yourbrand.com"
                value={sub.customDomain || ''}
                onChange={(e) => setSub({ ...sub, customDomain: e.target.value })}
              />
            </Field>
            <div className="small muted mb">Point a CNAME to this instance; the portal and app shell will serve under your domain and branding.</div>
            <Button sm variant="primary" onClick={saveDomain}>Save Domain</Button>
          </Card>
        </div>
      )}

      {tab === 'integrations' && (
        <div className="grid c2">
          <Card>
            <h3 className="mb">Social Media API</h3>
            <div className="small muted mb">Used for lead intake & auto-posting. Configure your own base URLs and access tokens — nothing is hardcoded.</div>
            <Field label="Facebook — API Base URL"><Input value={settings.config?.socialApi?.facebook?.baseUrl || ''} onChange={(e) => setPath('config.socialApi.facebook.baseUrl', e.target.value)} placeholder="https://graph.facebook.com/v19.0" /></Field>
            <Field label="Facebook — Access Token"><Input type="password" value={settings.config?.socialApi?.facebook?.token || ''} onChange={(e) => setPath('config.socialApi.facebook.token', e.target.value)} placeholder="••••••••" /></Field>
            <Field label="Facebook — Page ID"><Input value={settings.config?.socialApi?.facebook?.pageId || ''} onChange={(e) => setPath('config.socialApi.facebook.pageId', e.target.value)} /></Field>
            <Field label="Instagram — API Base URL"><Input value={settings.config?.socialApi?.instagram?.baseUrl || ''} onChange={(e) => setPath('config.socialApi.instagram.baseUrl', e.target.value)} placeholder="https://graph.facebook.com/v19.0" /></Field>
            <Field label="Instagram — Access Token"><Input type="password" value={settings.config?.socialApi?.instagram?.token || ''} onChange={(e) => setPath('config.socialApi.instagram.token', e.target.value)} placeholder="••••••••" /></Field>
            <Field label="LinkedIn — API Base URL"><Input value={settings.config?.socialApi?.linkedin?.baseUrl || ''} onChange={(e) => setPath('config.socialApi.linkedin.baseUrl', e.target.value)} placeholder="https://api.linkedin.com/v2" /></Field>
            <Field label="LinkedIn — Access Token"><Input type="password" value={settings.config?.socialApi?.linkedin?.token || ''} onChange={(e) => setPath('config.socialApi.linkedin.token', e.target.value)} placeholder="••••••••" /></Field>
          </Card>
          <Card>
            <h3 className="mb">WhatsApp Business</h3>
            <Field label="Provider"><Input value={settings.config?.whatsappConfig?.provider || ''} onChange={(e) => setPath('config.whatsappConfig.provider', e.target.value)} /></Field>
            <Field label="Business Number"><Input value={settings.config?.whatsappConfig?.phoneNumber || ''} onChange={(e) => setPath('config.whatsappConfig.phoneNumber', e.target.value)} /></Field>
            <Field label="API Base URL"><Input value={settings.config?.whatsappConfig?.apiBase || ''} onChange={(e) => setPath('config.whatsappConfig.apiBase', e.target.value)} placeholder="https://graph.facebook.com/v19.0" /></Field>
            <Field label="Access Token"><Input type="password" value={settings.config?.whatsappConfig?.token || ''} onChange={(e) => setPath('config.whatsappConfig.token', e.target.value)} placeholder="••••••••" /></Field>
            <Field label="Phone Number ID"><Input value={settings.config?.whatsappConfig?.phoneNumberId || ''} onChange={(e) => setPath('config.whatsappConfig.phoneNumberId', e.target.value)} /></Field>
            <div className="small muted">Webhook endpoint for lead aggregation: <code>/api/webhook/lead</code></div>
          </Card>
          <Card>
            <h3 className="mb">SMS</h3>
            <Field label="Provider"><Input value={settings.config?.smsConfig?.provider || ''} onChange={(e) => setPath('config.smsConfig.provider', e.target.value)} /></Field>
            <Field label="API Base URL"><Input value={settings.config?.smsConfig?.apiBase || ''} onChange={(e) => setPath('config.smsConfig.apiBase', e.target.value)} placeholder="https://api.msg91.com/api/v5" /></Field>
            <Field label="API Key"><Input type="password" value={settings.config?.smsConfig?.apiKey || ''} onChange={(e) => setPath('config.smsConfig.apiKey', e.target.value)} placeholder="••••••••" /></Field>
            <Field label="Sender ID"><Input value={settings.config?.smsConfig?.senderId || ''} onChange={(e) => setPath('config.smsConfig.senderId', e.target.value)} /></Field>
          </Card>
          <Card>
            <h3 className="mb">B2B Portal Imports</h3>
            <div className="small muted mb">Base URLs & API keys for importing listings with images from property portals.</div>
            <Field label="99acres — API Base URL"><Input value={settings.config?.b2b?.['99acres']?.baseUrl || ''} onChange={(e) => setPath('config.b2b.99acres.baseUrl', e.target.value)} placeholder="https://www.99acres.com" /></Field>
            <Field label="99acres — API Key"><Input type="password" value={settings.config?.b2b?.['99acres']?.apiKey || ''} onChange={(e) => setPath('config.b2b.99acres.apiKey', e.target.value)} placeholder="••••••••" /></Field>
            <Field label="Housing.com — API Base URL"><Input value={settings.config?.b2b?.['housing.com']?.baseUrl || ''} onChange={(e) => setPath('config.b2b.housing.com.baseUrl', e.target.value)} placeholder="https://housing.com" /></Field>
            <Field label="Housing.com — API Key"><Input type="password" value={settings.config?.b2b?.['housing.com']?.apiKey || ''} onChange={(e) => setPath('config.b2b.housing.com.apiKey', e.target.value)} placeholder="••••••••" /></Field>
            <Field label="MagicBricks — API Base URL"><Input value={settings.config?.b2b?.magicbricks?.baseUrl || ''} onChange={(e) => setPath('config.b2b.magicbricks.baseUrl', e.target.value)} placeholder="https://www.magicbricks.com" /></Field>
            <Field label="MagicBricks — API Key"><Input type="password" value={settings.config?.b2b?.magicbricks?.apiKey || ''} onChange={(e) => setPath('config.b2b.magicbricks.apiKey', e.target.value)} placeholder="••••••••" /></Field>
            <Field label="NoBroker — API Base URL"><Input value={settings.config?.b2b?.nobroker?.baseUrl || ''} onChange={(e) => setPath('config.b2b.nobroker.baseUrl', e.target.value)} placeholder="https://www.nobroker.in" /></Field>
            <Field label="NoBroker — API Key"><Input type="password" value={settings.config?.b2b?.nobroker?.apiKey || ''} onChange={(e) => setPath('config.b2b.nobroker.apiKey', e.target.value)} placeholder="••••••••" /></Field>
          </Card>
          <Card>
            <h3 className="mb">Google Maps (Field Force)</h3>
            <div className="small muted mb">Used for site-visit GPS, field-force tracking and "get directions" links.</div>
            <Field label="Maps JavaScript API Key"><Input type="password" value={settings.config?.maps?.apiKey || ''} onChange={(e) => setPath('config.maps.apiKey', e.target.value)} placeholder="AIza…" /></Field>
            <Field label="Embed / Directions Base URL"><Input value={settings.config?.maps?.embedBase || ''} onChange={(e) => setPath('config.maps.embedBase', e.target.value)} placeholder="https://www.google.com/maps" /></Field>
          </Card>
          <Card>
            <h3 className="mb">Email (SMTP)</h3>
            <Field label="SMTP Host"><Input value={settings.config?.emailConfig?.smtp || ''} onChange={(e) => setPath('config.emailConfig.smtp', e.target.value)} /></Field>
            <Field label="From Address"><Input value={settings.config?.emailConfig?.from || ''} onChange={(e) => setPath('config.emailConfig.from', e.target.value)} /></Field>
            <h3 className="mb mt">Lead Intake (Aggregation)</h3>
            <div className="small muted mb">Send enquiries from portals, ads and landing pages to:</div>
            <div className="card mb" style={{ background: '#f8fafc' }}><code className="small">POST /api/intake</code> (X-API-Key)</div>
            <div className="card mb" style={{ background: '#f8fafc' }}><code className="small">POST /api/forms/intake</code> (Google Forms compatible)</div>
            <div className="card" style={{ background: '#f8fafc' }}><code className="small">POST /api/webhook/lead</code> (WhatsApp Cloud API)</div>
          </Card>
        </div>
      )}

      {tab === 'features' && (
        <Card>
          <h3 className="mb">Module / Feature Toggles</h3>
          {allFlags.map((f) => (
            <div key={f} className="flex between items-center" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <b>{flagLabels[f]}</b>
                <div className="small muted">{f}</div>
              </div>
              <Switch checked={flags.find((x) => x.key === f)?.enabled !== 0} onChange={() => toggleFlag(f)} />
            </div>
          ))}
        </Card>
      )}

      {tab === 'api' && (
        <div className="grid c2">
          <Card>
            <h3 className="mb">API Keys</h3>
            {apiKeys.length === 0 && <div className="small muted mb">No keys yet</div>}
            {apiKeys.map((k) => (
              <div key={k.id} className="flex between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div><b>{k.name}</b><div className="small muted">{k.scopes?.join(', ')} · used {k.last_used || 'never'}</div></div>
                <Badge tone="brand">active</Badge>
              </div>
            ))}
            <Button className="mt" onClick={createKey}>+ Create API Key</Button>
          </Card>
          <Card>
            <h3 className="mb">Webhooks</h3>
            <div className="small muted">Third-party ERP / accounting integration hooks.</div>
            <div className="mt small">Endpoint: <code>POST /api/webhook/lead</code> with header <code>x-company-id</code></div>
            <div className="small muted mt">Integrate with Tally, Zoho Books, QuickBooks via the public API and webhooks.</div>
          </Card>
        </div>
      )}

      {tab === 'backup' && (
        <div className="grid c2">
          <Card>
            <h3 className="mb">Backup Schedule</h3>
            <div className="small muted mb">Automatic daily backups run at the configured time and optionally upload to cloud storage. A confirmation email is sent when a backup completes.</div>
            <div className="flex between items-center" style={{ padding: '8px 0' }}>
              <div><b>Automatic daily backup</b><div className="small muted">Run once per day at the time below</div></div>
              <Switch checked={!!bkCfg?.enabled} onChange={(e) => setBkCfg({ ...(bkCfg || {}), enabled: e.target.checked })} />
            </div>
            <div className="grid c2">
              <Field label="Scheduled time">
                <Input type="time" value={bkCfg?.time || '02:00'} onChange={(e) => setBkCfg({ ...(bkCfg || {}), time: e.target.value })} />
              </Field>
              <Field label="Format">
                <Select value={bkCfg?.format || 'db'} onChange={(e) => setBkCfg({ ...(bkCfg || {}), format: e.target.value })}>
                  <option value="db">Full database (.db)</option>
                  <option value="csv">Excel / CSV (.csv)</option>
                  <option value="txt">Plain text (.txt)</option>
                </Select>
              </Field>
            </div>
            <Field label="Custom backup folder (optional)">
              <Input value={bkCfg?.localPath || ''} onChange={(e) => setBkCfg({ ...(bkCfg || {}), localPath: e.target.value })} placeholder="e.g. /backups or D:\backups" />
            </Field>
            <Field label="Confirmation email (optional)">
              <Input value={bkCfg?.notifyEmail || ''} onChange={(e) => setBkCfg({ ...(bkCfg || {}), notifyEmail: e.target.value })} placeholder="admin@yourcompany.com" />
            </Field>
            <Button variant="primary" onClick={saveBackup}>Save Backup Settings</Button>
          </Card>

          <Card>
            <h3 className="mb">Cloud Upload</h3>
            <Field label="Provider">
              <Select value={bkCfg?.cloud?.provider || 'none'} onChange={(e) => setBkCfg({ ...(bkCfg || {}), cloud: { ...(bkCfg?.cloud || {}), provider: e.target.value } })}>
                <option value="none">Local only</option>
                <option value="gdrive">Google Drive</option>
                <option value="onedrive">OneDrive</option>
                <option value="dropbox">Dropbox</option>
                <option value="webhook">Custom webhook</option>
              </Select>
            </Field>
            {bkCfg?.cloud?.provider && bkCfg.cloud.provider !== 'none' && (
              <>
                <Field label={bkCfg.cloud.provider === 'webhook' ? 'Webhook URL' : 'API base URL (optional)'}>
                  <Input value={bkCfg.cloud.endpoint || ''} onChange={(e) => setBkCfg({ ...bkCfg, cloud: { ...bkCfg.cloud, endpoint: e.target.value } })} placeholder="https://…" />
                </Field>
                <Field label="Access token">
                  <Input type="password" value={bkCfg.cloud.token || ''} onChange={(e) => setBkCfg({ ...bkCfg, cloud: { ...bkCfg.cloud, token: e.target.value } })} placeholder="••••••••" />
                </Field>
                <Field label="Target folder / path">
                  <Input value={bkCfg.cloud.folder || ''} onChange={(e) => setBkCfg({ ...bkCfg, cloud: { ...bkCfg.cloud, folder: e.target.value } })} placeholder="e.g. /Backups" />
                </Field>
                <div className="small muted mb">
                  {bkCfg.cloud.provider === 'gdrive' && 'Google Drive upload uses the media upload API with your access token.'}
                  {bkCfg.cloud.provider === 'onedrive' && 'OneDrive upload uses the Graph API (PUT /me/drive/root:/…).'}
                  {bkCfg.cloud.provider === 'dropbox' && 'Dropbox upload uses the content upload API — token must have files.read/write scope.'}
                  {bkCfg.cloud.provider === 'webhook' && 'Webhook receives { filename, data (base64), size, uploadedAt } as JSON.'}
                </div>
              </>
            )}
            <h3 className="mb mt">Run Backup Now</h3>
            <div className="flex gap mb">
              <Button variant="primary" disabled={bkBusy} onClick={() => runBackupNow('db')}>{bkBusy ? 'Running…' : 'Backup .db'}</Button>
              <Button variant="primary" disabled={bkBusy} onClick={() => runBackupNow('csv')}>{bkBusy ? 'Running…' : 'Backup Excel (.csv)'}</Button>
              <Button variant="primary" disabled={bkBusy} onClick={() => runBackupNow('txt')}>{bkBusy ? 'Running…' : 'Backup .txt'}</Button>
            </div>
            <div className="small muted">The current format selection above is used for automatic backups; these buttons let you run any format immediately.</div>
          </Card>

          <Card style={{ gridColumn: '1 / -1' }}>
            <h3 className="mb">Backup History</h3>
            {bkHist.length === 0 && <div className="small muted">No backups yet.</div>}
            <table className="table">
              <thead><tr><th>When</th><th>Type</th><th>Format</th><th>File</th><th>Size</th><th>Status</th><th>Cloud</th><th></th></tr></thead>
              <tbody>
                {bkHist.map((b) => (
                  <tr key={b.id}>
                    <td className="small">{b.created_at}</td>
                    <td><Badge tone={b.kind === 'auto' ? 'brand' : 'default'}>{b.kind}</Badge></td>
                    <td>{b.format}</td>
                    <td className="small">{b.filename}</td>
                    <td className="small">{b.size ? Math.max(1, Math.round(b.size / 1024)) + ' KB' : '—'}</td>
                    <td><Badge tone={b.status === 'completed' ? 'success' : 'danger'}>{b.status}</Badge></td>
                    <td className="small">{b.cloud_status === 'uploaded' ? 'Uploaded' : b.cloud_status === 'failed' ? `Failed${b.cloud_error ? ` (${b.cloud_error})` : ''}` : b.cloud_status || '—'}</td>
                    <td>{b.status === 'completed' && <Button sm ghost onClick={() => downloadBackup(b)}>Download</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {tab === 'terms' && (
        <Card>
          <h3 className="mb">Terms & Conditions (customer portal)</h3>
          <Textarea style={{ minHeight: 160 }} value={settings.terms || ''} onChange={(e) => setPath('terms', e.target.value)} />
          <h3 className="mb mt">Lead Assignment Rule</h3>
          <Select value={settings.assignment?.mode || 'round_robin'} onChange={(e) => setPath('assignment.mode', e.target.value)}>
            <option value="round_robin">Round Robin</option>
            <option value="area">Area-wise</option>
            <option value="project">Project-wise</option>
            <option value="source">Source-wise</option>
            <option value="manager">Manager-wise</option>
          </Select>
        </Card>
      )}
    </div>
  );
}
