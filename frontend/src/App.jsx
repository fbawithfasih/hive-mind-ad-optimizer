import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { CommandPaletteProvider } from './components/command/CommandPaletteProvider.jsx';
import './index.css';
import { getMeApi, getOnboardingStatus } from './services/api.js';
import Dashboard        from './pages/Dashboard.jsx';
import HubPage          from './pages/HubPage.jsx';
import LoginPage        from './pages/LoginPage.jsx';
import SignupPage       from './pages/SignupPage.jsx';
import VerifyEmailPage  from './pages/VerifyEmailPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import ResetPasswordPage  from './pages/ResetPasswordPage.jsx';
import OnboardingPage   from './pages/OnboardingPage.jsx';
import BillingPage      from './pages/BillingPage.jsx';
import SpApiOAuthError  from './pages/auth/spapi/error.jsx';
import InvitePage       from './pages/InvitePage.jsx';

function Spinner() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-app-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: 'var(--text-faint)', fontSize: 14 }}>Loading…</div>
    </div>
  );
}

function RequireAuth({ user, children }) {
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// Redirect to /billing when the trial has expired and no subscription exists.
// Billing page itself is always reachable so the user can subscribe.
function RequireAccess({ user, children }) {
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace />;
  const trialExpired = user?.currentOrg?.trialExpired;
  if (trialExpired && location.pathname !== '/billing') {
    return <Navigate to="/billing" replace />;
  }
  return children;
}

function ProtectedDashboard({ user, onboarded, onLogout, setUser }) {
  const hasOrg = user?.organizations?.length > 0;
  if (!hasOrg && onboarded === false) {
    return <Navigate to="/onboarding" replace />;
  }
  return <Dashboard user={user} onboarded={onboarded} onLogout={onLogout} setUser={setUser} />;
}

function ProtectedHub({ user, onLogout }) {
  const hasOrg = user?.organizations?.length > 0;
  if (!hasOrg) return <Navigate to="/onboarding" replace />;
  return <HubPage user={user} onLogout={onLogout} />;
}

export default function App() {
  const [user, setUser]         = useState(null);
  const [checked, setChecked]   = useState(false);
  const [onboarded, setOnboarded] = useState(null);

  async function loadUser() {
    try {
      const u = await getMeApi();
      setUser(u);
      if (u?.organizations?.length > 0) {
        try {
          const status = await getOnboardingStatus();
          setOnboarded(status.complete);
        } catch {
          setOnboarded(true);
        }
      } else {
        setOnboarded(false);
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
    <CommandPaletteProvider>
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

      {/* SP-API OAuth error landing — public so the page renders even if the
          session cookie wasn't set yet during the OAuth round-trip. */}
      <Route path="/auth/spapi/error" element={<SpApiOAuthError />} />
      {/* Invitation landing. Handles its own auth redirect — an invitee may not
          be signed in, or may be signed in as the wrong account. */}
      <Route path="/invite" element={<InvitePage />} />

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

      {/* ── Hub (home) — trial-gated ───────────────────────────────── */}
      <Route path="/" element={
        loggedIn
          ? <RequireAccess user={user}><ProtectedHub user={user} onLogout={() => setUser(false)} /></RequireAccess>
          : <Navigate to="/login" replace />
      } />

      {/* ── Dashboard — trial-gated ────────────────────────────────── */}
      <Route path="/app/*" element={
        loggedIn
          ? <RequireAccess user={user}><ProtectedDashboard user={user} onboarded={onboarded} onLogout={() => setUser(false)} setUser={setUser} /></RequireAccess>
          : <Navigate to="/login" replace />
      } />

      <Route path="*" element={<Navigate to={loggedIn ? '/' : '/login'} replace />} />
    </Routes>
    </CommandPaletteProvider>
  );
}
