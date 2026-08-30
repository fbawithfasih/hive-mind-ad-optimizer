import React, { useState, useEffect } from 'react';
import { getAmazonStatus, disconnectAmazonApi } from '../services/api.js';

const MARKETPLACE_NAMES = {
  ATVPDKIKX0DER: 'United States',
  A2EUQ1WTGCTBG2: 'Canada',
  A1AM78C64UM0Y8: 'Mexico',
  A1RKKUPIHCS9HS: 'Spain',
  A1F83G8C2ARO7P: 'United Kingdom',
  A13V1IB3VIYZZH: 'France',
  A1PA6795UKMFR9: 'Germany',
  APJ6JRA9NG5V4:  'Italy',
  A1805IZSGTT6HS: 'Netherlands',
};

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function AmazonConnectPanel({ onConnected }) {
  const [status, setStatus]           = useState(null);
  const [loading, setLoading]         = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError]             = useState('');

  useEffect(() => {
    getAmazonStatus()
      .then(setStatus)
      .catch((err) => {
        if (err?.response?.status === 401) {
          window.location.href = '/login';
          return;
        }
        setError('Failed to load connection status.');
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleDisconnect() {
    if (!window.confirm('Disconnect your Amazon account? All API calls will fall back to the default credentials until you reconnect.')) return;
    setDisconnecting(true);
    setError('');
    try {
      await disconnectAmazonApi(status.credentialId);
      setStatus({ connected: false, credentialId: null, marketplaceId: null, connectedAt: null });
    } catch {
      setError('Failed to disconnect. Please try again.');
    } finally {
      setDisconnecting(false);
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-subtle)', padding: 32 }}>
        <svg style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} fill="none" viewBox="0 0 24 24">
          <circle style={{ opacity: .25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path style={{ opacity: .75 }} fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
        </svg>
        Checking connection status…
      </div>
    );
  }

  return (
    <div className="rounded-xl p-6 flex flex-col gap-6" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-strong)' }}>

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="rounded-lg p-2.5" style={{ background: '#FF9900' + '22' }}>
          // theme-lint-ok — Amazon brand orange on their logo mark; must not flip
          <svg style={{ width: 20, height: 20, color: '#FF9900' }} viewBox="0 0 24 24" fill="currentColor">
            <path d="M13.23 10.56V10c-1.94.02-3.98.21-3.98 1.53 0 .75.54 1.21 1.38 1.21.63 0 1.17-.21 1.59-.59.5-.42.01-.99 1.01-1.59zm1.43 3.49c-.18.14-.44.15-.64.04-1.68-1.36-1.97-2.06-2.9-3.38-1.75 1.77-2.99 2.3-5.26 2.3-2.69 0-4.79-1.66-4.79-4.97 0-2.59 1.4-4.35 3.41-5.21 1.74-.76 4.16-.89 6.01-1.1V1.5c0-.74.06-1.61-.37-2.24C9.7-.32 8.72-.5 7.86-.5c-1.63 0-3.05.86-3.41 2.63-.07.38-.34.74-.73.76L1.55 2.7C1.13 2.61.65 2.3.77 1.73 1.52-2.09 4.92-3.25 8.0-3.25c1.55 0 3.57.41 4.79 1.58 1.55 1.45 1.4 3.38 1.4 5.49v4.97c0 1.49.62 2.15 1.2 2.96.21.29.25.63-.01.84l-1.72 1.46h-.0z"/>
          </svg>
        </div>
        <div>
          <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>Amazon Seller Account</p>
          <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>Connect via Amazon SP-API OAuth</p>
        </div>
        <div className="ml-auto">
          {status?.connected ? (
            <span className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full"
                  style={{ background: 'color-mix(in srgb, var(--success) 13%, transparent)', border: '1px solid #10B98140', color: 'var(--success-deep)' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--success)', display: 'inline-block' }}/>
              Connected
            </span>
          ) : (
            <span className="text-xs font-semibold px-3 py-1 rounded-full"
                  style={{ background: 'color-mix(in srgb, var(--rose) 13%, transparent)', border: '1px solid #F43F5E40', color: 'var(--danger-soft)' }}>
              Not connected
            </span>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ background: 'color-mix(in srgb, var(--rose) 9%, transparent)', border: '1px solid #F43F5E44', color: 'var(--danger-soft)' }}>
          {error}
        </div>
      )}

      {status?.connected ? (
        <>
          {/* Connection details */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg p-4" style={{ background: 'var(--bg-app-2)', border: '1px solid var(--bg-panel)' }}>
              <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--text-subtle)' }}>Marketplace</p>
              <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                {MARKETPLACE_NAMES[status.marketplaceId] ?? status.marketplaceId ?? '—'}
              </p>
            </div>
            <div className="rounded-lg p-4" style={{ background: 'var(--bg-app-2)', border: '1px solid var(--bg-panel)' }}>
              <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--text-subtle)' }}>Connected on</p>
              <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{formatDate(status.connectedAt)}</p>
            </div>
            <div className="rounded-lg p-4" style={{ background: 'var(--bg-app-2)', border: '1px solid var(--bg-panel)' }}>
              <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--text-subtle)' }}>Last used</p>
              <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{formatDate(status.lastUsed)}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            {/* Re-authorise */}
            <a href="/api/sp-oauth/start"
               className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg"
               style={{ background: 'var(--bg-panel-2)', border: '1px solid var(--border-strong)', color: 'var(--text-muted)', textDecoration: 'none' }}>
              <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
              </svg>
              Re-authorise
            </a>

            {/* Disconnect */}
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg"
              style={{
                background: 'transparent', border: '1px solid #F43F5E44',
                color: disconnecting ? 'var(--text-muted)' : 'var(--danger-soft)',
                cursor: disconnecting ? 'not-allowed' : 'pointer',
              }}>
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.6 }}>
            <p>Connect your Amazon Seller account to enable:</p>
            <ul style={{ marginTop: 8, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <li>SP-API access for listing management and catalog data</li>
              <li>Advertising API access for campaigns, reports, and search terms</li>
              <li>Per-org credentials — each organisation uses its own Amazon account</li>
            </ul>
          </div>

          <div>
            <a href="/api/sp-oauth/start"
               style={{
                 display: 'inline-flex', alignItems: 'center', gap: 8,
                 padding: '10px 20px', borderRadius: 8, fontWeight: 700, fontSize: 14,
                 background: 'linear-gradient(135deg,#FF9900,#FF6600)',
                 color: '#fff', textDecoration: 'none', border: 'none', cursor: 'pointer',
               }}>
              <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/>
              </svg>
              Connect Amazon Account
            </a>
            <p className="text-xs mt-3" style={{ color: 'var(--text-faint)' }}>
              You will be redirected to Amazon Seller Central to authorise access. No passwords are stored — only the OAuth refresh token.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
