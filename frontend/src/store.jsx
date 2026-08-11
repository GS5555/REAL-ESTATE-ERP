import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { api } from './api';

const StoreCtx = createContext(null);

export function StoreProvider({ children }) {
  const [user, setUser] = useState(null);
  const [company, setCompany] = useState(null);
  const [perms, setPerms] = useState([]);
  const [ready, setReady] = useState(false);
  const [lang, setLang] = useState(localStorage.getItem('pp_lang') || 'en');
  const [notifs, setNotifs] = useState({ items: [], unread: 0 });

  const applyTheme = useCallback((settings) => {
    const theme = settings?.branding?.theme || {};
    const root = document.documentElement.style;
    if (theme.primary) { root.setProperty('--brand', theme.primary); }
    if (theme.primaryDark) root.setProperty('--brand-dark', theme.primaryDark);
    else root.setProperty('--brand-dark', theme.primary || '#1d4ed8');
    if (theme.accent) root.setProperty('--accent', theme.accent);
    document.title = settings?.branding?.companyName
      ? `${settings.branding.companyName} — ERP & CRM`
      : 'Propease — Real Estate ERP & CRM';
  }, []);

  const refreshNotifs = useCallback(async () => {
    if (!localStorage.getItem('pp_token')) return;
    try {
      const n = await api.get('/notifications');
      setNotifs(n);
    } catch { /* ignore */ }
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await api.post('/auth/login', { email, password });
    if (data.otpRequired) return data;
    localStorage.setItem('pp_token', data.token);
    setUser(data.user);
    if (data.user?.company) {
      setCompany(data.user.company);
      applyTheme(data.user.company.settings);
    }
    const p = await api.get('/auth/permissions');
    setPerms(p.permissions || []);
    refreshNotifs();
    return data;
  }, [applyTheme, refreshNotifs]);

  const verifyOtp = useCallback(async (userId, code) => {
    const data = await api.post('/auth/otp-verify', { userId, code });
    localStorage.setItem('pp_token', data.token);
    setUser(data.user);
    if (data.user?.company) {
      setCompany(data.user.company);
      applyTheme(data.user.company.settings);
    }
    const p = await api.get('/auth/permissions');
    setPerms(p.permissions || []);
    refreshNotifs();
    return data;
  }, [applyTheme, refreshNotifs]);

  const logout = useCallback(() => {
    localStorage.removeItem('pp_token');
    setUser(null); setCompany(null); setPerms([]);
    location.href = '/login';
  }, []);

  // bootstrap
  useEffect(() => {
    (async () => {
      const token = localStorage.getItem('pp_token');
      if (!token) { setReady(true); return; }
      try {
        const me = await api.get('/auth/me');
        setUser(me.user);
        if (me.company) { setCompany(me.company); applyTheme(me.company.settings); }
        const p = await api.get('/auth/permissions');
        setPerms(p.permissions || []);
        refreshNotifs();
      } catch { localStorage.removeItem('pp_token'); }
      setReady(true);
    })();
  }, [applyTheme, refreshNotifs]);

  const value = useMemo(() => ({
    user, company, perms, ready, lang, setLang, notifs, refreshNotifs, login, verifyOtp, logout,
    can: (perm) => perms.includes(perm),
    isAdmin: () => user?.role === 'super_admin'
  }), [user, company, perms, ready, lang, notifs, refreshNotifs, login, verifyOtp, logout]);

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export const useStore = () => useContext(StoreCtx);
