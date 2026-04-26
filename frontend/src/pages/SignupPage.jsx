import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signupApi } from '../services/api.js';

const S = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#0F172A 0%,#1E293B 100%)' },
  card: { width: '100%', maxWidth: 420, padding: '40px 36px', background: '#1E293B', borderRadius: 16, border: '1px solid #334155', boxShadow: '0 25px 60px rgba(0,0,0,0.5)' },
  logo: { textAlign: 'center', marginBottom: 28 },
  logoIcon: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 52, height: 52, borderRadius: 14, marginBottom: 12, background: 'linear-gradient(135deg,#3B82F6,#8B5CF6)' },
  h1: { margin: 0, fontSize: 20, fontWeight: 700, color: '#F1F5F9' },
  sub: { margin: '4px 0 0', fontSize: 13, color: '#64748B' },
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  row: { display: 'flex', gap: 10 },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#94A3B8', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' },
  input: { width: '100%', boxSizing: 'border-box', background: '#0F172A', border: '1px solid #334155', borderRadius: 8, color: '#F1F5F9', padding: '11px 14px', fontSize: 14, outline: 'none' },
  btn: { marginTop: 4, padding: '12px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#3B82F6,#8B5CF6)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' },
  btnOff: { background: '#334155', opacity: 0.7, cursor: 'not-allowed' },
  err: { background: '#F43F5E18', border: '1px solid #F43F5E44', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#F87171' },
  success: { background: '#10B98118', border: '1px solid #10B98144', borderRadius: 8, padding: '14px', fontSize: 13, color: '#34D399', textAlign: 'center', lineHeight: 1.5 },
  foot: { textAlign: 'center', marginTop: 20, fontSize: 13, color: '#64748B' },
};

export default function SignupPage({ onSignup }) {
  const navigate = useNavigate();
  const [form, setForm]   = useState({ email: '', password: '', firstName: '', lastName: '' });
  const [error, setError]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone]    = useState(false);

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const focus = e => (e.target.style.borderColor = '#3B82F6');
  const blur  = e => (e.target.style.borderColor = '#334155');

  async function handleSubmit(e) {
    e.preventDefault();
    if (form.password.length < 8) { setError('Password must be at least 8 characters'); return; }
    setLoading(true); setError(null);
    try {
      const data = await signupApi(form.email, form.password, form.firstName, form.lastName);
      setDone(true);
      if (onSignup) onSignup(data.user ?? data);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to create account');
    } finally {
      setLoading(false);
    }
  }

  if (done) return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.success}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>✉️</div>
          <strong style={{ color: '#F1F5F9', fontSize: 15 }}>Account created!</strong><br />
          We sent a verification link to <strong>{form.email}</strong>.<br />
          Check your inbox, then{' '}
          <Link to="/onboarding" style={{ color: '#3B82F6' }}>continue setup →</Link>
        </div>
      </div>
    </div>
  );

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.logo}>
          <div style={S.logoIcon}>
            <svg width="26" height="26" fill="none" stroke="#fff" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
            </svg>
          </div>
          <h1 style={S.h1}>Create your account</h1>
          <p style={S.sub}>AMAIOP · Amazon Ads Optimizer</p>
        </div>

        <form onSubmit={handleSubmit} style={S.form}>
          <div style={S.row}>
            <div style={{ flex: 1 }}>
              <label style={S.label}>First name</label>
              <input value={form.firstName} onChange={set('firstName')} placeholder="Jane"
                style={S.input} onFocus={focus} onBlur={blur} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={S.label}>Last name</label>
              <input value={form.lastName} onChange={set('lastName')} placeholder="Smith"
                style={S.input} onFocus={focus} onBlur={blur} />
            </div>
          </div>

          <div>
            <label style={S.label}>Email</label>
            <input type="email" value={form.email} onChange={set('email')} placeholder="you@example.com"
              required autoFocus style={S.input} onFocus={focus} onBlur={blur} />
          </div>

          <div>
            <label style={S.label}>Password <span style={{ color: '#475569', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(min 8 chars)</span></label>
            <input type="password" value={form.password} onChange={set('password')} placeholder="••••••••"
              required style={S.input} onFocus={focus} onBlur={blur} />
          </div>

          {error && <div style={S.err}>{error}</div>}

          <button type="submit" disabled={loading}
            style={{ ...S.btn, ...(loading ? S.btnOff : {}) }}>
            {loading ? 'Creating account…' : 'Create Account'}
          </button>
        </form>

        <p style={S.foot}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: '#3B82F6', textDecoration: 'none', fontWeight: 600 }}>Sign in</Link>
        </p>
      </div>
    </div>
  );
}
