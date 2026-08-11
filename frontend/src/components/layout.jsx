import { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../store';
import { Avatar, Badge } from './ui';
import { api, fmtDateTime } from '../api';
import { translations } from '../i18n';

const ICONS = {
  Dashboard: '▦', Leads: '◎', Pipeline: '☰', Projects: '⌂', Inventory: '▣', Customers: '☺',
  Employees: '👥', Finance: '₹', Marketing: '◎', Reports: '▤', AI: '✦', Settings: '⚙',
  Users: '⚓', Audit: '📋', Support: '✉', Admin: '⚑', Portal: '☷', Activities: '⏱', Field: '⌖',
  Org: '☷', Tasks: '☑', Chat: '💬', SupportChat: '✉', Listings: '⌂', Loans: '₹', Billing: '£',   Gps: '⌖', Referrals: '♻', Subbrokers: '☲'
};

function item(path, label, perm, icon) {
  return { path, label, perm, icon };
}

function buildNav(user, can, isAdmin) {
  const admin = [];
  if (isAdmin) {
    admin.push(item('/admin', 'Developer Panel', 'dashboard.view', ICONS.Admin));
  }
  const rows = [];
  rows.push(item('/dashboard', 'Dashboard', 'dashboard.view', ICONS.Dashboard));
  if (can('lead.view') || can('lead.create')) {
    rows.push(item('/leads', 'Leads', 'lead.view', ICONS.Leads));
    rows.push(item('/leads/pipeline', 'Pipeline', 'pipeline.view', ICONS.Pipeline));
  }
  if (can('activity.view') || can('activity.create')) rows.push(item('/activities', 'Activities', 'activity.view', ICONS.Activities));
  if (can('sitevisit.view') || can('sitevisit.approve')) rows.push(item('/field-force', 'Field Force', 'sitevisit.view', ICONS.Field));
  if (can('gps.view') || can('gps.own')) rows.push(item('/gps-reports', 'GPS Reports', 'gps.view', ICONS.Gps));
  if (can('project.view')) rows.push(item('/projects', 'Projects', 'project.view', ICONS.Projects));
  if (can('inventory.view')) rows.push(item('/inventory', 'Inventory', 'inventory.view', ICONS.Inventory));
  if (can('customer.view')) rows.push(item('/customers', 'Customers', 'customer.view', ICONS.Customers));
  if (can('listing.view')) rows.push(item('/listings', 'Listings', 'listing.view', ICONS.Listings));
  if (can('loan.view')) rows.push(item('/loans', 'Home Loans', 'loan.view', ICONS.Loans));
  if (can('finance.view') || can('finance.invoice')) rows.push(item('/billing', 'Billing & Reminders', 'finance.view', ICONS.Billing));
  if (can('employee.view')) rows.push(item('/employees', 'Employees', 'employee.view', ICONS.Employees));
  if (can('finance.view') || can('commission.view')) rows.push(item('/finance', 'Finance', 'finance.view', ICONS.Finance));
  if (can('marketing.view')) rows.push(item('/marketing', 'Marketing', 'marketing.view', ICONS.Marketing));
  if (can('subbroker.view') || can('lead.view')) rows.push(item('/referrals', 'Referrals', 'subbroker.view', ICONS.Referrals));
  if (can('subbroker.view')) rows.push(item('/subbrokers', 'Sub-brokers', 'subbroker.view', ICONS.Subbrokers));
  if (can('report.view')) rows.push(item('/reports', 'Reports', 'report.view', ICONS.Reports));
  if (can('lead.view')) rows.push(item('/ai', 'AI Assistant', 'lead.view', ICONS.AI));
  if (can('chat.use')) rows.push(item('/chat', 'Team Chat', 'chat.use', ICONS.Chat));
  if (can('support.chat')) rows.push(item('/support-chat', 'Support Chat', 'support.chat', ICONS.SupportChat));
  if (can('org.view')) rows.push(item('/organization', 'Organization', 'org.view', ICONS.Org));
  if (can('task.view')) rows.push(item('/tasks', 'Tasks', 'task.view', ICONS.Tasks));
  if (can('settings.view')) rows.push(item('/settings', 'Settings', 'settings.view', ICONS.Settings));
  if (can('settings.users')) rows.push(item('/users', 'Users & Roles', 'settings.users', ICONS.Users));
  if (can('audit.view')) rows.push(item('/audit', 'Audit Log', 'audit.view', ICONS.Audit));
  if (can('support.view')) rows.push(item('/support', 'Support', 'support.view', ICONS.Support));
  return [...admin, ...rows];
}

export default function Layout({ children }) {
  const { user, company, can, logout, lang, setLang, notifs, refreshNotifs } = useStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();

  const branding = company?.settings?.branding || {};
  const navItems = buildNav(user, can, user?.role === 'super_admin');
  const title = navItems.find((i) => loc.pathname.startsWith(i.path) && i.path !== '/')?.label
    || (loc.pathname === '/' ? 'Dashboard' : 'Propease');

  const markRead = async (id) => {
    await api.post('/notifications/read', id ? { id } : {});
    refreshNotifs();
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <div className="brand">
          {branding.logo
            ? <img className="logo" src={branding.logo} alt="logo" />
            : <div style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--brand)', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700 }}>🏠</div>}
          <div>
            <div className="bname">{user?.role === 'super_admin' ? 'Propease Platform' : (branding.companyName || company?.name || 'Company')}</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>{branding.tagline || 'ERP & CRM'}</div>
          </div>
        </div>
        <nav>
          {navItems.map((it, i) => (
            <NavLink key={i} to={it.path} className={({ isActive }) => (isActive ? 'active' : '')} onClick={() => setMobileOpen(false)}>
              <span className="nav-icon">{it.icon}</span> {it.label}
            </NavLink>
          ))}
        </nav>
        <div className="side-footer">
          <div className="mb">Role: <Badge tone="blue">{user?.role?.replace(/_/g, ' ')}</Badge></div>
          <button className="btn ghost sm" onClick={logout}>⏻ Logout</button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="flex items-center gap" style={{ minWidth: 0 }}>
            <button className="btn ghost sm" style={{ display: 'none' }} onClick={() => setMobileOpen(true)}>☰</button>
            <div className="tb-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
          </div>
          <div className="tb-right">
            <select className="select" style={{ width: 'auto', padding: '5px 8px', fontSize: 12 }} value={lang} onChange={(e) => { setLang(e.target.value); localStorage.setItem('pp_lang', e.target.value); }}>
              <option value="en">EN</option>
              <option value="hi">हिंदी</option>
            </select>
            <div style={{ position: 'relative' }}>
              <button className="btn ghost sm" onClick={() => { setNotifOpen(!notifOpen); if (!notifOpen) refreshNotifs(); }}>
                🔔 {notifs.unread > 0 && <Badge tone="red">{notifs.unread}</Badge>}
              </button>
              {notifOpen && (
                <div className="notif-pop">
                  <div style={{ padding: '10px 14px', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>Notifications</div>
                  <div style={{ maxHeight: 380, overflowY: 'auto' }}>
                    {notifs.items.length === 0 && <div className="empty">No notifications</div>}
                    {notifs.items.map((n) => (
                      <div key={n.id} onClick={() => markRead(n.id)} style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer', opacity: n.read ? 0.6 : 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{n.title}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{n.body}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtDateTime(n.created_at)}</div>
                      </div>
                    ))}
                  </div>
                  {notifs.unread > 0 && <div style={{ padding: 8, textAlign: 'center' }}><button className="btn sm" onClick={() => markRead()}>Mark all read</button></div>}
                </div>
              )}
            </div>
            <div className="flex items-center gap" style={{ marginLeft: 6 }}>
              <Avatar name={user?.name} />
              <div style={{ lineHeight: 1.2 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{user?.name}</div>
                <div className="muted small">{user?.role?.replace(/_/g, ' ')}</div>
              </div>
            </div>
          </div>
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
