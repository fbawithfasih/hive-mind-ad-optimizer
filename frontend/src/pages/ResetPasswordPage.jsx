import { useState } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { resetPasswordApi } from '../services/api.js';

const S = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,var(--bg-app-2) 0%,var(--bg-panel) 100%)' },
  card: { width: '100%', maxWidth: 400, padding: '40px 36px', background: 'var(--bg-panel)', borderRadius: 16, border: '1px solid var(--border-strong)', boxShadow: '0 25px 60px var(--bg-overlay-lo)' },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' },
  input: { width: '100%', boxSizing: 'border-box', background: 'var(--bg-app-2)', border: '1px solid var(--border-strong)', borderRadius: 8, color: 'var(--text-primary)', padding: '11px 14px', fontSize: 14, outline: 'none' },
  btn: { width: '100%', marginTop: 4, padding: '12px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#3B82F6,#8B5CF6)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' },
  btnOff: { background: 'var(--border-strong)', opacity: 0.7, cursor: 'not-allowed' },
  err: { background: '#F43F5E18', border: '1px solid #F43F5E44', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#F87171' },
  ok: { background: '#10B98118', border: '1px solid #10B98144', borderRadius: 8, padding: '12px 14px', fontSize: 13, color: '#34D399', lineHeight: 1.5, textAlign: 'center' },
};

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate  = useNavigate();
  const token     = params.get('token');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [done, setDone]         = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (password !== confirm) { setError('Passwords do not match'); return; }
    setLoading(true); setError(null);
    try {
      await resetPasswordApi(token, password);
      setDone(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  }

  if (!token) return (
    <div style={S.page}><div style={S.card}>
      <h1 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>Invalid link</h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>This reset link is missing or malformed.</p>
      <Link to="/forgot-password" style={{ color: '#3B82F6', fontSize: 13 }}>Request a new reset link</Link>
    </div></div>
  );

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>Set new password</h1>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-subtle)' }}>Choose a strong password for your account.</p>
        </div>

        {done ? (
          <div style={S.ok}>
            Password updated! Redirecting to login…
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={S.label}>New password <span style={{ color: 'var(--text-faint)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(min 8 chars)</span></label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" required autoFocus style={S.input}
                onFocus={e => (e.target.style.borderColor = '#3B82F6')}
                onBlur={e  => (e.target.style.borderColor = 'var(--border-strong)')} />
            </div>
            <div>
              <label style={S.label}>Confirm password</label>
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                placeholder="••••••••" required style={S.input}
                onFocus={e => (e.target.style.borderColor = '#3B82F6')}
                onBlur={e  => (e.target.style.borderColor = 'var(--border-strong)')} />
            </div>
            {error && <div style={S.err}>{error}</div>}
            <button type="submit" disabled={loading}
              style={{ ...S.btn, ...(loading ? S.btnOff : {}) }}>
              {loading ? 'Updating…' : 'Update Password'}
            </button>
          </form>
        )}

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'var(--text-subtle)' }}>
          <Link to="/login" style={{ color: '#3B82F6', textDecoration: 'none' }}>← Back to login</Link>
        </p>
      </div>
    </div>
  );
}
