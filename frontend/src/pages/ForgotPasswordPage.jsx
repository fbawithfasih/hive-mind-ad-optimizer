import { useState } from 'react';
import { Link } from 'react-router-dom';
import { forgotPasswordApi } from '../services/api.js';

const S = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,var(--bg-app-2) 0%,var(--bg-panel) 100%)' },
  card: { width: '100%', maxWidth: 400, padding: '40px 36px', background: 'var(--bg-panel)', borderRadius: 16, border: '1px solid var(--border-strong)', boxShadow: '0 25px 60px var(--bg-overlay-lo)' },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' },
  input: { width: '100%', boxSizing: 'border-box', background: 'var(--bg-app-2)', border: '1px solid var(--border-strong)', borderRadius: 8, color: 'var(--text-primary)', padding: '11px 14px', fontSize: 14, outline: 'none' },
  btn: { width: '100%', marginTop: 4, padding: '12px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,var(--info-strong),var(--accent-strong))', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' },
  btnOff: { background: 'var(--border-strong)', opacity: 0.7, cursor: 'not-allowed' },
  ok: { background: 'color-mix(in srgb, var(--success) 9%, transparent)', border: '1px solid #10B98144', borderRadius: 8, padding: '12px 14px', fontSize: 13, color: 'var(--success-2)', lineHeight: 1.5 },
};

export default function ForgotPasswordPage() {
  const [email, setEmail]     = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent]       = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await forgotPasswordApi(email);
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>Forgot password?</h1>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-subtle)', lineHeight: 1.5 }}>
            Enter your email and we'll send a reset link if the account exists.
          </p>
        </div>

        {sent ? (
          <div style={S.ok}>
            If <strong>{email}</strong> is registered, a reset link is on its way. Check your inbox (and spam folder).
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={S.label}>Email address</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com" required autoFocus
                style={S.input}
                onFocus={e => (e.target.style.borderColor = 'var(--info-strong)')}
                onBlur={e  => (e.target.style.borderColor = 'var(--text-faint)')}
              />
            </div>
            <button type="submit" disabled={loading}
              style={{ ...S.btn, ...(loading ? S.btnOff : {}) }}>
              {loading ? 'Sending…' : 'Send Reset Link'}
            </button>
          </form>
        )}

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'var(--text-subtle)' }}>
          <Link to="/login" style={{ color: 'var(--info-strong)', textDecoration: 'none' }}>← Back to login</Link>
        </p>
      </div>
    </div>
  );
}
