import React, { useState } from 'react';
import { loginApi } from '../services/api.js';

export default function LoginPage({ onLogin }) {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState(null);
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const user = await loginApi(email, password);
      onLogin(user);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)',
    }}>
      <div style={{
        width: '100%', maxWidth: 400, padding: '40px 36px',
        background: '#1E293B', borderRadius: 16, border: '1px solid #334155',
        boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
      }}>

        {/* Logo / Brand */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 52, height: 52, borderRadius: 14, marginBottom: 16,
            background: 'linear-gradient(135deg,#3B82F6,#8B5CF6)',
          }}>
            <svg width="26" height="26" fill="none" stroke="#fff" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
            </svg>
          </div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#F1F5F9' }}>Hive Mind Nestor</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748B' }}>Ads Optimizer · Sign in to continue</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94A3B8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Email
            </label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" required autoFocus
              style={{
                width: '100%', boxSizing: 'border-box',
                background: '#0F172A', border: '1px solid #334155', borderRadius: 8,
                color: '#F1F5F9', padding: '11px 14px', fontSize: 14, outline: 'none',
              }}
              onFocus={e => e.target.style.borderColor = '#3B82F6'}
              onBlur={e => e.target.style.borderColor = '#334155'}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94A3B8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Password
            </label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" required
              style={{
                width: '100%', boxSizing: 'border-box',
                background: '#0F172A', border: '1px solid #334155', borderRadius: 8,
                color: '#F1F5F9', padding: '11px 14px', fontSize: 14, outline: 'none',
              }}
              onFocus={e => e.target.style.borderColor = '#3B82F6'}
              onBlur={e => e.target.style.borderColor = '#334155'}
            />
          </div>

          {error && (
            <div style={{
              background: '#F43F5E18', border: '1px solid #F43F5E44',
              borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#F87171',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit" disabled={loading}
            style={{
              marginTop: 4, padding: '12px', borderRadius: 8, border: 'none',
              background: loading ? '#334155' : 'linear-gradient(135deg,#3B82F6,#8B5CF6)',
              color: '#fff', fontWeight: 700, fontSize: 14,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1, transition: 'opacity 0.15s',
            }}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 24, fontSize: 12, color: '#334155' }}>
          Hive Mind Nestor · Amazon Ads Partner
        </p>
      </div>
    </div>
  );
}
