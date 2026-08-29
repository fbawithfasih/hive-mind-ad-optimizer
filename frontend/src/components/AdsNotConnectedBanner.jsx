import { useEffect, useState } from 'react';

export default function AdsNotConnectedBanner() {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    function onEvent(e) {
      setMessage(e.detail?.error || 'Amazon Ads is not connected for this organization.');
      setVisible(true);
    }
    window.addEventListener('ads-not-connected', onEvent);
    return () => window.removeEventListener('ads-not-connected', onEvent);
  }, []);

  if (!visible) return null;

  return (
    <div style={{
      background: 'linear-gradient(90deg, rgba(245,158,11,0.12), rgba(245,158,11,0.04))',
      borderBottom: '1px solid rgba(245,158,11,0.35)',
      padding: '12px 24px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      color: 'var(--warning-2)',
      fontSize: 13,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
        <span style={{ fontSize: 18 }}>⚠️</span>
        <div>
          <div style={{ fontWeight: 700, color: '#FDE68A' }}>Amazon Ads not connected</div>
          <div style={{ color: 'var(--warning-2)', opacity: 0.85, marginTop: 2 }}>
            {message} Reports and campaign data require the Ads OAuth step.
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <a
          href="/api/sp-oauth/ads-start"
          style={{
            background: 'linear-gradient(90deg, #F59E0B, #D97706)',
            // Deliberately literal, not a token: the amber gradient behind this
            // text is fixed, so the text must stay dark in both themes. Any
            // theme-flipping token here (--bg-app-2, --text-invert) turns white
            // in light mode and drops contrast on amber to ~2:1.
            color: '#0F172A',
            fontWeight: 700,
            fontSize: 12,
            padding: '8px 14px',
            borderRadius: 8,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          Connect Amazon Ads
        </a>
        <button
          onClick={() => setVisible(false)}
          style={{
            background: 'transparent',
            border: '1px solid rgba(252,211,77,0.3)',
            color: 'var(--warning-2)',
            borderRadius: 8,
            padding: '6px 10px',
            fontSize: 12,
            cursor: 'pointer',
          }}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
