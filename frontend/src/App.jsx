import { Suspense, lazy, Component } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useStore } from './store';
import Layout from './components/layout';

const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Leads = lazy(() => import('./pages/Leads'));
const LeadDetail = lazy(() => import('./pages/LeadDetail'));
const Pipeline = lazy(() => import('./pages/Pipeline'));
const Projects = lazy(() => import('./pages/Projects'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Customers = lazy(() => import('./pages/Customers'));
const CustomerDetail = lazy(() => import('./pages/CustomerDetail'));
const Employees = lazy(() => import('./pages/Employees'));
const Finance = lazy(() => import('./pages/Finance'));
const Marketing = lazy(() => import('./pages/Marketing'));
const Reports = lazy(() => import('./pages/Reports'));
const AIPage = lazy(() => import('./pages/AI'));
const Settings = lazy(() => import('./pages/Settings'));
const UsersRoles = lazy(() => import('./pages/UsersRoles'));
const AuditLog = lazy(() => import('./pages/Audit'));
const Support = lazy(() => import('./pages/Support'));
const Admin = lazy(() => import('./pages/Admin'));
const Activities = lazy(() => import('./pages/Activities'));
const FieldForce = lazy(() => import('./pages/FieldForce'));
const CustomerPortal = lazy(() => import('./pages/Portal'));
// V2 pages
const Organization = lazy(() => import('./pages/Organization'));
const Tasks = lazy(() => import('./pages/Tasks'));
const Chat = lazy(() => import('./pages/Chat'));
const SupportChat = lazy(() => import('./pages/SupportChat'));
const Listings = lazy(() => import('./pages/Listings'));
const Loans = lazy(() => import('./pages/Loans'));
const Billing = lazy(() => import('./pages/Billing'));
const GpsReports = lazy(() => import('./pages/GpsReports'));
const ProjectCatalogue = lazy(() => import('./pages/ProjectCatalogue'));
const Referrals = lazy(() => import('./pages/Referrals'));
const ReferralLanding = lazy(() => import('./pages/ReferralLanding'));
const Subbrokers = lazy(() => import('./pages/Subbrokers'));

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error, info) { console.error('route error', error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="empty" style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', textAlign: 'center' }}>
          <div>
            <h3>Something went wrong rendering this page</h3>
            <p className="muted small">An unexpected error occurred. Try navigating to another page or reload.</p>
            <button className="btn" style={{ marginTop: 12 }} onClick={() => { this.setState({ hasError: false }); }}>Try again</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function Page({ children }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<div className="empty">Loading…</div>}>{children}</Suspense>
    </ErrorBoundary>
  );
}

function RequireAuth({ children }) {
  const { ready, user } = useStore();
  if (!ready) return <div className="empty">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Page>{children}</Page>;
}

function InLayout({ children }) {
  return <Layout>{children}</Layout>;
}

export default function App() {
  const loc = useLocation();
  const portal = loc.pathname.startsWith('/portal');
  const share = loc.pathname.startsWith('/share');

  if (portal) {
    return (
      <Routes>
        <Route path="/portal/:token" element={<Page><CustomerPortal /></Page>} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  if (share) {
    return (
      <Routes>
        <Route path="/share/:slug" element={<Page><ProjectCatalogue /></Page>} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const ref = loc.pathname === '/ref' || loc.pathname.startsWith('/ref/');
  if (ref) {
    return (
      <Routes>
        <Route path="/ref/:code" element={<Page><ReferralLanding /></Page>} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Page><Login /></Page>} />
      <Route path="/" element={<RequireAuth><InLayout><Dashboard /></InLayout></RequireAuth>} />
      <Route path="/dashboard" element={<RequireAuth><InLayout><Dashboard /></InLayout></RequireAuth>} />
      <Route path="/leads" element={<RequireAuth><InLayout><Leads /></InLayout></RequireAuth>} />
      <Route path="/leads/:id" element={<RequireAuth><InLayout><LeadDetail /></InLayout></RequireAuth>} />
      <Route path="/leads/pipeline" element={<RequireAuth><InLayout><Pipeline /></InLayout></RequireAuth>} />
      <Route path="/activities" element={<RequireAuth><InLayout><Activities /></InLayout></RequireAuth>} />
      <Route path="/field-force" element={<RequireAuth><InLayout><FieldForce /></InLayout></RequireAuth>} />
      <Route path="/projects" element={<RequireAuth><InLayout><Projects /></InLayout></RequireAuth>} />
      <Route path="/inventory" element={<RequireAuth><InLayout><Inventory /></InLayout></RequireAuth>} />
      <Route path="/customers" element={<RequireAuth><InLayout><Customers /></InLayout></RequireAuth>} />
      <Route path="/customers/:id" element={<RequireAuth><InLayout><CustomerDetail /></InLayout></RequireAuth>} />
      <Route path="/employees" element={<RequireAuth><InLayout><Employees /></InLayout></RequireAuth>} />
      <Route path="/finance" element={<RequireAuth><InLayout><Finance /></InLayout></RequireAuth>} />
      <Route path="/marketing" element={<RequireAuth><InLayout><Marketing /></InLayout></RequireAuth>} />
      <Route path="/reports" element={<RequireAuth><InLayout><Reports /></InLayout></RequireAuth>} />
      <Route path="/ai" element={<RequireAuth><InLayout><AIPage /></InLayout></RequireAuth>} />
      <Route path="/settings" element={<RequireAuth><InLayout><Settings /></InLayout></RequireAuth>} />
      <Route path="/users" element={<RequireAuth><InLayout><UsersRoles /></InLayout></RequireAuth>} />
      <Route path="/audit" element={<RequireAuth><InLayout><AuditLog /></InLayout></RequireAuth>} />
      <Route path="/support" element={<RequireAuth><InLayout><Support /></InLayout></RequireAuth>} />
      <Route path="/admin" element={<RequireAuth><InLayout><Admin /></InLayout></RequireAuth>} />
      {/* V2 routes */}
      <Route path="/organization" element={<RequireAuth><InLayout><Organization /></InLayout></RequireAuth>} />
      <Route path="/tasks" element={<RequireAuth><InLayout><Tasks /></InLayout></RequireAuth>} />
      <Route path="/chat" element={<RequireAuth><InLayout><Chat /></InLayout></RequireAuth>} />
      <Route path="/support-chat" element={<RequireAuth><InLayout><SupportChat /></InLayout></RequireAuth>} />
      <Route path="/listings" element={<RequireAuth><InLayout><Listings /></InLayout></RequireAuth>} />
      <Route path="/loans" element={<RequireAuth><InLayout><Loans /></InLayout></RequireAuth>} />
      <Route path="/billing" element={<RequireAuth><InLayout><Billing /></InLayout></RequireAuth>} />
      <Route path="/gps-reports" element={<RequireAuth><InLayout><GpsReports /></InLayout></RequireAuth>} />
      <Route path="/referrals" element={<RequireAuth><InLayout><Referrals /></InLayout></RequireAuth>} />
      <Route path="/subbrokers" element={<RequireAuth><InLayout><Subbrokers /></InLayout></RequireAuth>} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
