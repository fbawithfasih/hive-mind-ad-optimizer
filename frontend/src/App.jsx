import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import './index.css';
import { getMeApi, getOnboardingStatus } from './services/api.js';
import Dashboard        from './pages/Dashboard.jsx';
import LoginPage        from './pages/LoginPage.jsx';
import SignupPage       from './pages/SignupPage.jsx';
import VerifyEmailPage  from './pages/VerifyEmailPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import ResetPasswordPage  from './pages/ResetPasswordPage.jsx';
import OnboardingPage   from './pages/OnboardingPage.jsx';
import BillingPage      from './pages/BillingPage.jsx';

function Spinner() {
  return (
    <div style={{ minHeight: '100vh', background: '#0F172A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#475569', fontSize: 14 }}>Loading…</div>
    </div>
  );
}

function RequireAuth({ user, children }) {
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// Wraps the dashboard — only redirects to onboarding when user has no org yet.
// Once an org exists, the dashboard is always accessible regardless of onboarding progress.
function ProtectedDashboard({ user, onboarded, onLogout, setUser }) {
  const hasOrg = user?.organizations?.length > 0;
  if (!hasOrg && onboarded === false) {
    return <Navigate to="/onboarding" replace />;
  }
  return <Dashboard user={user} onboarded={onboarded} onLogout={onLogout} setUser={setUser} />;
}

export default function App() {
  const [user, setUser]         = useState(null);
  const [checked, setChecked]   = useState(false);
  const [onboarded, setOnboarded] = useState(null); // null = still checking

  async function loadUser() {
    try {
      const u = await getMeApi();
      setUser(u);
      // Only check onboarding when the user belongs to at least one org;
      // without an org the endpoint returns 400.
      if (u?.organizations?.length > 0) {
        try {
          const status = await getOnboardingStatus();
          setOnboarded(status.complete);
        } catch {
          setOnboarded(true);
        }
      } else {
        setOnboarded(false); // no org → must create one before accessing dashboard
      }
    } catch {
      setUser(false);
      setOnboarded(true);
    } finally {
      setChecked(true);
    }
  }

  useEffect(() => { loadUser(); }, []);

  if (!checked) return <Spinner />;

  const loggedIn = !!user;

  return (
    <Routes>
      {/* ── Public auth routes ─────────────────────────────────────── */}
      <Route path="/login"
        element={loggedIn ? <Navigate to="/" replace /> : <LoginPage onLogin={u => { setUser(u); setOnboarded(null); loadUser(); }} />}
      />
      <Route path="/signup"
        element={loggedIn ? <Navigate to="/" replace /> : <SignupPage onSignup={u => { setUser(u); setOnboarded(false); }} />}
      />
      <Route path="/verify-email"  element={<VerifyEmailPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password"  element={<ResetPasswordPage />} />

      {/* ── Protected routes ───────────────────────────────────────── */}
      <Route path="/onboarding" element={
        <RequireAuth user={user}>
          <OnboardingPage user={user} onComplete={() => setOnboarded(true)} onOrgCreated={loadUser} />
        </RequireAuth>
      } />
      <Route path="/billing" element={
        <RequireAuth user={user}>
          <BillingPage user={user} onLogout={() => setUser(false)} />
        </RequireAuth>
      } />

      {/* ── Dashboard (default) ────────────────────────────────────── */}
      <Route path="/*" element={
        loggedIn
          ? <ProtectedDashboard user={user} onboarded={onboarded} onLogout={() => setUser(false)} setUser={setUser} />
          : <Navigate to="/login" replace />
      } />
    </Routes>
  );
}
