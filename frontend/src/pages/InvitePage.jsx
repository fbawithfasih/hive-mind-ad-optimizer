import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { getInvitationApi, acceptInvitationApi } from '../services/api.js';

const S = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,var(--bg-app-2) 0%,var(--bg-panel) 100%)' },
  card: { width: '100%', maxWidth: 420, padding: '48px 36px', background: 'var(--bg-panel)', borderRadius: 16, border: '1px solid var(--border-strong)', boxShadow: '0 25px 60px var(--bg-overlay-lo)', textAlign: 'center' },
  icon: { fontSize: 48, marginBottom: 16 },
  h1: { margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' },
  p: { margin: '0 0 24px', fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 },
  btn: { display: 'inline-block', padding: '11px 24px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,var(--info-strong),var(--accent-strong))', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', textDecoration: 'none' },
  err: { background: 'color-mix(in srgb, var(--rose) 9%, transparent)', border: '1px solid #F43F5E44', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--danger)', marginBottom: 16 },
  meta: { fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 },
};

/**
 * Invitation landing page.
 *
 * The token alone does not grant membership — the API requires the signed-in
 * user's email to match the invited address. This page just surfaces that
 * requirement clearly instead of letting the accept call fail cryptically.
 */
export default function InvitePage() {
  const [params]  = useSearchParams();
  const navigate  = useNavigate();
  const token     = params.get('token');

  const [status, setStatus] = useState(token ? 'loading' : 'no-token');
  const [invite, setInvite] = useState(null);
  const [error, setError]   = useState('');

  useEffect(() => {
    if (!token) return;
    getInvitationApi(token)
      .then(data => { setInvite(data.invitation); setStatus('ready'); })
      .catch(err => {
        // 401 means no session — send them to log in and come back.
        if (err.response?.status === 401) {
          navigate(`/login?next=${encodeURIComponent(`/invite?token=${token}`)}`, { replace: true });
          return;
        }
        setError(err.response?.data?.error ?? 'This invitation could not be loaded.');
        setStatus('error');
      });
  }, [token]);

  async function handleAccept() {
    setStatus('accepting');
    setError('');
    try {
      await acceptInvitationApi(token);
      setStatus('accepted');
      // Full reload so the app picks up the new org membership.
      setTimeout(() => { window.location.href = '/'; }, 1200);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to accept the invitation.');
      setStatus('ready');
    }
  }

  return (
    <div style={S.page}>
      <div style={S.card}>
        {status === 'no-token' && (
          <>
            <div style={S.icon}>🔗</div>
            <h1 style={S.h1}>Invitation link incomplete</h1>
            <p style={S.p}>This link is missing its token. Ask whoever invited you to send a new one.</p>
            <Link to="/" style={S.btn}>Go to dashboard</Link>
          </>
        )}

        {status === 'loading' && (
          <>
            <div style={S.icon}>⏳</div>
            <h1 style={S.h1}>Loading invitation…</h1>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={S.icon}>⚠️</div>
            <h1 style={S.h1}>Invitation unavailable</h1>
            <div style={S.err}>{error}</div>
            <Link to="/" style={S.btn}>Go to dashboard</Link>
          </>
        )}

        {(status === 'ready' || status === 'accepting') && invite && (
          <>
            <div style={S.icon}>✉️</div>
            <h1 style={S.h1}>Join {invite.orgName ?? 'this organization'}</h1>
            <p style={S.p}>
              You've been invited as a <strong>{invite.role.toLowerCase()}</strong>.
              Accepting gives this organization's team access to shared campaign and listing data.
            </p>

            {error && <div style={S.err}>{error}</div>}

            {invite.matchesCurrentUser ? (
              <>
                <div style={S.meta}>Invited address: {invite.email}</div>
                <button onClick={handleAccept} disabled={status === 'accepting'} style={S.btn}>
                  {status === 'accepting' ? 'Accepting…' : 'Accept invitation'}
                </button>
              </>
            ) : (
              <>
                <div style={S.err}>
                  This invitation was sent to <strong>{invite.email}</strong>, which isn't the
                  account you're signed in as. Sign in as that address to accept it.
                </div>
                <Link to="/" style={S.btn}>Go to dashboard</Link>
              </>
            )}
          </>
        )}

        {status === 'accepted' && (
          <>
            <div style={S.icon}>✅</div>
            <h1 style={S.h1}>You're in</h1>
            <p style={S.p}>Taking you to the dashboard…</p>
          </>
        )}
      </div>
    </div>
  );
}
