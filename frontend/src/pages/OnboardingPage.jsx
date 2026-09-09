import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { getOnboardingStatus, resendVerificationApi, syncProfilesApi, createOrgApi } from '../services/api.js';

// Setup ends where the trial's argument begins: the agent's first proposals.
// The two Amazon consents are one step here and two actions underneath —
// `actionKeys` lists both so the card stays "current" through either.
const STEPS = [
  { key: 'emailVerified',        actionKeys: ['verify_email'],                  icon: '✉️', title: 'Verify your email',            desc: 'Click the link we sent to activate your account.' },
  { key: 'credentialsConnected', actionKeys: ['connect_amazon', 'connect_ads'], icon: '🔑', title: 'Connect your Amazon account',  desc: 'Two quick consents: Seller Central, then Advertising. About two minutes.' },
  { key: 'profileSynced',        actionKeys: ['sync_profile'],                  icon: '📋', title: 'Sync your seller profiles',    desc: 'Import your Amazon advertising profiles. This also enrols the agent, in shadow mode.' },
  { key: 'firstProposals',       actionKeys: ['await_proposals'],               icon: '🤖', title: 'Review your first proposals',  desc: 'The agent reads your last 30 days of search terms and proposes what it would have negated — usually within the hour.' },
];

const ACTIONS = {
  verify_email:     { label: 'Resend verification email', action: 'resend' },
  connect_amazon:   { label: 'Connect Seller Central', href: '/api/sp-oauth/start' },
  connect_ads:      { label: 'Connect Amazon Advertising', href: '/api/sp-oauth/ads-start' },
  sync_profile:     { label: 'Sync seller profiles', action: 'sync_profiles' },
  await_proposals:  { label: 'Open the agent', href: '/?tab=agent' },
};

/** The two consents behind one step, as a pair of dots. */
function ConsentDots({ detail }) {
  const dot = (ok, label) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: ok ? 'var(--success)' : 'var(--text-subtle)' }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: ok ? 'var(--success)' : 'var(--border-strong)' }} />
      {label}{ok ? ' ✓' : ''}
    </span>
  );
  return (
    <div style={{ display: 'flex', gap: 14, marginTop: 6 }} aria-label="Amazon consents">
      {dot(!!detail?.spConnected, 'Seller Central')}
      {dot(!!detail?.adsConnected, 'Advertising')}
    </div>
  );
}

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
    <div style={{ minHeight: '100vh', background: 'var(--bg-app-2)', display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: 'var(--bg-panel)', borderBottom: '1px solid var(--border-strong)', padding: '16px 24px' }}>
        <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>AMAIOP Setup</span>
      </header>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 16px' }}>
        <div style={{ width: '100%', maxWidth: 480 }}>
          <h1 style={{ margin: '0 0 8px', fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', textAlign: 'center' }}>
            Create your organization
          </h1>
          <p style={{ margin: '0 0 32px', fontSize: 14, color: 'var(--text-muted)', textAlign: 'center' }}>
            An organization groups your Amazon accounts and team members.
          </p>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                Organization name
              </label>
              <input
                type="text" value={name} onChange={e => setName(e.target.value)} required autoFocus
                placeholder="Acme Sellers"
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border-strong)', background: 'var(--bg-panel)', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }}
              />
            </div>
            {error && <p style={{ margin: 0, fontSize: 13, color: 'var(--rose)' }}>{error}</p>}
            <button type="submit" disabled={creating || !name.trim()} style={{
              padding: '11px 0', borderRadius: 8, border: 'none', fontSize: 14, fontWeight: 600,
              background: 'linear-gradient(135deg,var(--info-strong),var(--accent-strong))', color: '#fff',
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
    <div style={{ minHeight: '100vh', background: 'var(--bg-app-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: 'var(--text-faint)', fontSize: 14 }}>Loading…</p>
    </div>
  );

  const steps  = status?.steps ?? {};
  const done   = status?.progress?.completed ?? 0;
  const total  = status?.progress?.total ?? STEPS.length;
  const pct    = Math.round((done / total) * 100);
  const next   = status?.nextStep;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-app-2)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header style={{ background: 'var(--bg-panel)', borderBottom: '1px solid var(--border-strong)', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>AMAIOP Setup</span>
        <Link to={status?.demo ? '/?tab=overview' : '/'} style={{ fontSize: 13, color: 'var(--text-subtle)', textDecoration: 'none' }}>
          {status?.demo ? 'Skip for now — explore with sample data →' : 'Skip for now →'}
        </Link>
      </header>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 16px' }}>
        <div style={{ width: '100%', maxWidth: 560 }}>

          {/* Progress header */}
          <div style={{ marginBottom: 32, textAlign: 'center' }}>
            <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>
              {status?.complete ? '🎉 All set!' : 'Get started with Hive Mind Ad Optimizer'}
            </h1>
            <p style={{ margin: '0 0 20px', fontSize: 14, color: 'var(--text-muted)' }}>
              {status?.complete ? 'Redirecting to your dashboard…' : `${done} of ${total} steps complete`}
            </p>
            {/* Progress bar */}
            <div style={{ height: 6, background: 'var(--bg-panel)', borderRadius: 99, overflow: 'hidden', border: '1px solid var(--border-strong)' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg,var(--info-strong),var(--accent-strong))', borderRadius: 99, transition: 'width 0.4s ease' }} />
            </div>
          </div>

          {/* Steps */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {STEPS.map((step, i) => {
              const complete = !!steps[step.key];
              const isCurrent = !complete && step.actionKeys.includes(next);
              return (
                <div key={step.key} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 16, padding: '16px 20px',
                  background: 'var(--bg-panel)', borderRadius: 12,
                  border: `1px solid ${complete ? 'color-mix(in srgb, var(--success) 25%, transparent)' : isCurrent ? 'color-mix(in srgb, var(--info-strong) 25%, transparent)' : 'var(--border-strong)'}`,
                  opacity: complete ? 0.75 : 1,
                }}>
                  {/* Check / icon */}
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
                    background: complete ? 'color-mix(in srgb, var(--success) 13%, transparent)' : isCurrent ? 'color-mix(in srgb, var(--info-strong) 13%, transparent)' : 'var(--bg-app-2)',
                    border: `2px solid ${complete ? 'var(--success)' : isCurrent ? 'var(--info-strong)' : 'var(--border-strong)'}`,
                    color: complete ? 'var(--success)' : 'var(--text-muted)',
                  }}>
                    {complete ? '✓' : step.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 600, color: complete ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                      {step.title}
                    </p>
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--text-subtle)' }}>{step.desc}</p>
                    {step.key === 'credentialsConnected' && !complete && <ConsentDots detail={status?.detail} />}
                    {step.key === 'firstProposals' && isCurrent && status?.detail?.proposals === 0 && (
                      <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-faint)' }}>
                        Nothing yet — the first run is queued. Come back in a little while, or explore the sample data meanwhile.
                      </p>
                    )}
                    {/* Inline action for current step */}
                    {isCurrent && ACTIONS[next] && (
                      <div style={{ marginTop: 10 }}>
                        {ACTIONS[next].action === 'resend' ? (
                          <>
                            <button onClick={handleResend} style={{
                              padding: '7px 16px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600,
                              background: 'linear-gradient(135deg,var(--info-strong),var(--accent-strong))', color: '#fff', cursor: 'pointer',
                            }}>
                              {ACTIONS[next].label}
                            </button>
                            {resendMsg && <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--success)' }}>{resendMsg}</span>}
                          </>
                        ) : ACTIONS[next].action === 'sync_profiles' ? (
                          <>
                            <button onClick={handleSyncProfiles} disabled={syncing} style={{
                              padding: '7px 16px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600,
                              background: 'linear-gradient(135deg,var(--info-strong),var(--accent-strong))', color: '#fff', cursor: syncing ? 'not-allowed' : 'pointer',
                              opacity: syncing ? 0.7 : 1,
                            }}>
                              {syncing ? 'Syncing…' : ACTIONS[next].label}
                            </button>
                            {syncMsg && <span style={{ marginLeft: 10, fontSize: 12, color: syncMsg.startsWith('Synced') ? 'var(--success)' : 'var(--rose)' }}>{syncMsg}</span>}
                          </>
                        ) : (
                          <a href={ACTIONS[next].href} style={{
                            display: 'inline-block', padding: '7px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                            background: 'linear-gradient(135deg,var(--info-strong),var(--accent-strong))', color: '#fff', textDecoration: 'none',
                          }}>
                            {ACTIONS[next].label}
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                  {complete && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--success-deep)', background: 'color-mix(in srgb, var(--success) 13%, transparent)', padding: '3px 8px', borderRadius: 99, whiteSpace: 'nowrap', marginTop: 4 }}>
                      Done
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <p style={{ textAlign: 'center', marginTop: 24, fontSize: 13, color: 'var(--text-faint)' }}>
            <Link to={status?.demo ? '/?tab=overview' : '/'} style={{ color: 'var(--text-subtle)', textDecoration: 'none' }}>
              {status?.demo ? 'Skip setup — explore with sample data →' : 'Skip setup and go to dashboard →'}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
