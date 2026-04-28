import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { getOnboardingStatus, resendVerificationApi, syncProfilesApi, createOrgApi } from '../services/api.js';

const STEPS = [
  { key: 'emailVerified',        actionKey: 'verify_email',     icon: '✉️',  title: 'Verify your email',          desc: 'Click the link we sent to activate your account.' },
  { key: 'credentialsConnected', actionKey: 'connect_amazon',   icon: '🔑',  title: 'Connect Amazon account',      desc: 'Link your Amazon Advertising API credentials.' },
  { key: 'profileSynced',        actionKey: 'sync_profile',     icon: '📋',  title: 'Sync your seller profiles',   desc: 'Import your Amazon advertising profiles.' },
  { key: 'firstOptimization',    actionKey: 'optimize_listing', icon: '✨',  title: 'Optimize your first listing', desc: 'Run AI optimization on a product listing.' },
  { key: 'firstReport',          actionKey: 'generate_report',  icon: '📊',  title: 'Generate your first report',  desc: 'Run an advertising report from the dashboard.' },
];

const ACTIONS = {
  verify_email:      { label: 'Resend verification email', action: 'resend' },
  connect_amazon:    { label: 'Connect Amazon account', href: '/api/sp-oauth/start' },
  sync_profile:      { label: 'Sync seller profiles', action: 'sync_profiles' },
  optimize_listing:  { label: 'Go to Listing Optimizer', href: '/?tab=listings' },
  generate_report:   { label: 'Go to Reports', href: '/?tab=reports' },
};

function CreateOrgGate({ onCreated }) {
  const [name, setName]       = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError]       = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError('');
    try {
      await createOrgApi(name.trim());
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to create organization.');
      setCreating(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0F172A', display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: '#1E293B', borderBottom: '1px solid #334155', padding: '16px 24px' }}>
        <span style={{ fontWeight: 700, fontSize: 16, color: '#F1F5F9' }}>AMAIOP Setup</span>
      </header>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 16px' }}>
        <div style={{ width: '100%', maxWidth: 480 }}>
          <h1 style={{ margin: '0 0 8px', fontSize: 24, fontWeight: 700, color: '#F1F5F9', textAlign: 'center' }}>
            Create your organization
          </h1>
          <p style={{ margin: '0 0 32px', fontSize: 14, color: '#94A3B8', textAlign: 'center' }}>
            An organization groups your Amazon accounts and team members.
          </p>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94A3B8', marginBottom: 6 }}>
                Organization name
              </label>
              <input
                type="text" value={name} onChange={e => setName(e.target.value)} required autoFocus
                placeholder="Acme Sellers"
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', borderRadius: 8, border: '1px solid #334155', background: '#1E293B', color: '#F1F5F9', fontSize: 14, outline: 'none' }}
              />
            </div>
            {error && <p style={{ margin: 0, fontSize: 13, color: '#F43F5E' }}>{error}</p>}
            <button type="submit" disabled={creating || !name.trim()} style={{
              padding: '11px 0', borderRadius: 8, border: 'none', fontSize: 14, fontWeight: 600,
              background: 'linear-gradient(135deg,#3B82F6,#8B5CF6)', color: '#fff',
              cursor: creating ? 'not-allowed' : 'pointer', opacity: creating ? 0.7 : 1,
            }}>
              {creating ? 'Creating…' : 'Create organization →'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function OnboardingPage({ user, onComplete, onOrgCreated }) {
  const navigate = useNavigate();
  const [status, setStatus]       = useState(null);
  const [loading, setLoading]     = useState(true);
  const [resendMsg, setResendMsg] = useState('');
  const [syncMsg, setSyncMsg]     = useState('');
  const [syncing, setSyncing]     = useState(false);

  const hasOrg = user?.organizations?.length > 0;

  useEffect(() => {
    if (!hasOrg) return;
    getOnboardingStatus()
      .then(setStatus)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [hasOrg]);

  useEffect(() => {
    if (status?.complete) {
      onComplete?.();
      setTimeout(() => navigate('/'), 1500);
    }
  }, [status, navigate, onComplete]);

  if (!hasOrg) {
    return <CreateOrgGate onCreated={onOrgCreated ?? (() => window.location.reload())} />;
  }

  async function handleSyncProfiles() {
    setSyncing(true);
    setSyncMsg('');
    try {
      const result = await syncProfilesApi();
      setSyncMsg(`Synced ${result.synced} profile${result.synced !== 1 ? 's' : ''}.`);
      const updated = await getOnboardingStatus();
      setStatus(updated);
    } catch (err) {
      const detail = err.response?.data?.detail;
      const base   = err.response?.data?.error ?? 'Failed to sync profiles.';
      setSyncMsg(detail ? `${base} — ${JSON.stringify(detail)}` : base);
    } finally {
      setSyncing(false);
    }
  }

  async function handleResend() {
    try {
      await resendVerificationApi();
      setResendMsg('Verification email sent — check your inbox.');
    } catch (err) {
      setResendMsg(err.response?.data?.error ?? 'Failed to send email.');
    }
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0F172A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#475569', fontSize: 14 }}>Loading…</p>
    </div>
  );

  const steps  = status?.steps ?? {};
  const done   = status?.progress?.completed ?? 0;
  const total  = status?.progress?.total ?? STEPS.length;
  const pct    = Math.round((done / total) * 100);
  const next   = status?.nextStep;

  return (
    <div style={{ minHeight: '100vh', background: '#0F172A', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header style={{ background: '#1E293B', borderBottom: '1px solid #334155', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 700, fontSize: 16, color: '#F1F5F9' }}>AMAIOP Setup</span>
        <Link to="/" style={{ fontSize: 13, color: '#64748B', textDecoration: 'none' }}>Skip for now →</Link>
      </header>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 16px' }}>
        <div style={{ width: '100%', maxWidth: 560 }}>

          {/* Progress header */}
          <div style={{ marginBottom: 32, textAlign: 'center' }}>
            <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 700, color: '#F1F5F9' }}>
              {status?.complete ? '🎉 All set!' : 'Get started with AMAIOP'}
            </h1>
            <p style={{ margin: '0 0 20px', fontSize: 14, color: '#94A3B8' }}>
              {status?.complete ? 'Redirecting to your dashboard…' : `${done} of ${total} steps complete`}
            </p>
            {/* Progress bar */}
            <div style={{ height: 6, background: '#1E293B', borderRadius: 99, overflow: 'hidden', border: '1px solid #334155' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg,#3B82F6,#8B5CF6)', borderRadius: 99, transition: 'width 0.4s ease' }} />
            </div>
          </div>

          {/* Steps */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {STEPS.map((step, i) => {
              const complete = !!steps[step.key];
              const isCurrent = !complete && next === step.actionKey;
              return (
                <div key={step.key} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 16, padding: '16px 20px',
                  background: '#1E293B', borderRadius: 12,
                  border: `1px solid ${complete ? '#10B98140' : isCurrent ? '#3B82F640' : '#334155'}`,
                  opacity: complete ? 0.75 : 1,
                }}>
                  {/* Check / icon */}
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
                    background: complete ? '#10B98120' : isCurrent ? '#3B82F620' : '#0F172A',
                    border: `2px solid ${complete ? '#10B981' : isCurrent ? '#3B82F6' : '#334155'}`,
                    color: complete ? '#10B981' : '#94A3B8',
                  }}>
                    {complete ? '✓' : step.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 600, color: complete ? '#94A3B8' : '#F1F5F9' }}>
                      {step.title}
                    </p>
                    <p style={{ margin: 0, fontSize: 13, color: '#64748B' }}>{step.desc}</p>
                    {/* Inline action for current step */}
                    {isCurrent && ACTIONS[next] && (
                      <div style={{ marginTop: 10 }}>
                        {ACTIONS[next].action === 'resend' ? (
                          <>
                            <button onClick={handleResend} style={{
                              padding: '7px 16px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600,
                              background: 'linear-gradient(135deg,#3B82F6,#8B5CF6)', color: '#fff', cursor: 'pointer',
                            }}>
                              {ACTIONS[next].label}
                            </button>
                            {resendMsg && <span style={{ marginLeft: 10, fontSize: 12, color: '#10B981' }}>{resendMsg}</span>}
                          </>
                        ) : ACTIONS[next].action === 'sync_profiles' ? (
                          <>
                            <button onClick={handleSyncProfiles} disabled={syncing} style={{
                              padding: '7px 16px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600,
                              background: 'linear-gradient(135deg,#3B82F6,#8B5CF6)', color: '#fff', cursor: syncing ? 'not-allowed' : 'pointer',
                              opacity: syncing ? 0.7 : 1,
                            }}>
                              {syncing ? 'Syncing…' : ACTIONS[next].label}
                            </button>
                            {syncMsg && <span style={{ marginLeft: 10, fontSize: 12, color: syncMsg.startsWith('Synced') ? '#10B981' : '#F43F5E' }}>{syncMsg}</span>}
                          </>
                        ) : (
                          <a href={ACTIONS[next].href} style={{
                            display: 'inline-block', padding: '7px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                            background: 'linear-gradient(135deg,#3B82F6,#8B5CF6)', color: '#fff', textDecoration: 'none',
                          }}>
                            {ACTIONS[next].label}
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                  {complete && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#10B981', background: '#10B98120', padding: '3px 8px', borderRadius: 99, whiteSpace: 'nowrap', marginTop: 4 }}>
                      Done
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <p style={{ textAlign: 'center', marginTop: 24, fontSize: 13, color: '#475569' }}>
            <Link to="/" style={{ color: '#64748B', textDecoration: 'none' }}>Skip setup and go to dashboard →</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
