import { useSearchParams, Link } from 'react-router-dom';

/**
 * SP-API OAuth error page.
 *
 * The backend OAuth callbacks (src/api/routes/sp-oauth.js) redirect here
 * instead of rendering HTML, passing a short, length-capped `reason` CODE.
 * Raw error detail is logged server-side only and never reaches the client,
 * so nothing on this page is attacker-controlled markup. `reason` is rendered
 * purely as React text content (auto-escaped) — no XSS surface.
 */

// Known reason codes → user-facing copy. Anything unrecognised falls back.
const REASONS = {
  no_authorization_code: {
    title: 'Connection not completed',
    message:
      "Amazon didn't return an authorization code. The connection may have been " +
      "cancelled, or the app's redirect URI isn't registered correctly in Seller Central.",
  },
  email_unverified: {
    title: 'Verify your email first',
    message:
      'Connecting an Amazon account attaches real seller credentials to your ' +
      'organization, so we need to confirm your email address first. Check your ' +
      'inbox for the verification link, then try connecting again.',
  },
  invalid_state: {
    title: 'Connection session expired',
    message:
      'Your connection session could not be verified or has expired. This is a ' +
      'security check to protect your account — please start the connection again.',
  },
  token_exchange_failed: {
    title: "Couldn't finish connecting",
    message:
      "We received Amazon's authorization but couldn't exchange it for access " +
      'tokens. This is usually temporary — please try again in a moment.',
  },
  ads_no_authorization_code: {
    title: 'Advertising API not connected',
    message:
      "Amazon didn't return an authorization code for the Advertising API. " +
      'Please try connecting your account again.',
  },
  ads_token_exchange_failed: {
    title: "Couldn't finish connecting Ads",
    message:
      "We couldn't exchange Amazon's authorization for Advertising API tokens. " +
      'This is usually temporary — please try again in a moment.',
  },
  access_denied: {
    title: 'Authorization declined',
    message:
      'The authorization request was declined on Amazon. To connect your account, ' +
      'please approve the requested permissions when prompted.',
  },
};

const FALLBACK = {
  title: 'Amazon connection failed',
  message:
    'Something went wrong while connecting your Amazon account. Please try again. ' +
    'If the problem keeps happening, contact support.',
};

const S = {
  page: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'linear-gradient(135deg,var(--bg-app-2) 0%,var(--bg-panel) 100%)', padding: 20,
  },
  card: {
    width: '100%', maxWidth: 440, padding: '40px 36px', background: 'var(--bg-panel)',
    borderRadius: 16, border: '1px solid var(--border-strong)', boxShadow: '0 25px 60px var(--bg-overlay-lo)',
    textAlign: 'center',
  },
  iconWrap: {
    width: 56, height: 56, borderRadius: '50%', background: 'color-mix(in srgb, var(--rose) 9%, transparent)',
    border: '1px solid #F43F5E44', display: 'flex', alignItems: 'center',
    justifyContent: 'center', margin: '0 auto 20px',
  },
  title: { margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' },
  message: { margin: '10px 0 0', fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 },
  btn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    width: '100%', boxSizing: 'border-box', marginTop: 24, padding: '12px',
    borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#FF9900,#FF6600)',
    color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', textDecoration: 'none',
  },
  link: { display: 'inline-block', marginTop: 16, fontSize: 13, color: 'var(--info-strong)', textDecoration: 'none' },
  ref: { marginTop: 22, fontSize: 11, color: 'var(--text-faint)', fontFamily: 'monospace' },
};

export default function SpApiOAuthError() {
  const [params] = useSearchParams();
  const reason = params.get('reason') || 'unknown';
  const info = REASONS[reason] || FALLBACK;

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.iconWrap}>
          <svg style={{ width: 26, height: 26, color: 'var(--rose)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>

        <h1 style={S.title}>{info.title}</h1>
        <p style={S.message}>{info.message}</p>

        {/* Returns to the connection flow (backend OAuth start endpoint). */}
        <a href="/api/sp-oauth/start" style={S.btn}>
          <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Try again
        </a>

        <div>
          <Link to="/" style={S.link}>← Back to dashboard</Link>
        </div>

        <div style={S.ref}>Reference: {reason}</div>
      </div>
    </div>
  );
}
