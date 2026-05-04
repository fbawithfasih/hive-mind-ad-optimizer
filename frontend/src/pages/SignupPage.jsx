import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { signupApi } from '../services/api.js';

const PLAN_LABELS = {
  STARTER: 'Starter', BASIC: 'Starter',
  GROWTH: 'Growth',   PRO: 'Growth',
  SCALE: 'Scale',     ENTERPRISE: 'Scale',
};

const S = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#0F172A 0%,#1E293B 100%)' },
  card: { width: '100%', maxWidth: 420, padding: '40px 36px', background: '#1E293B', borderRadius: 16, border: '1px solid #334155', boxShadow: '0 25px 60px rgba(0,0,0,0.5)' },
  logo: { textAlign: 'center', marginBottom: 28 },
  logoIcon: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 52, height: 52, borderRadius: 14, marginBottom: 12, background: 'linear-gradient(135deg,#3B82F6,#8B5CF6)' },
  h1: { margin: 0, fontSize: 20, fontWeight: 700, color: '#F1F5F9' },
  sub: { margin: '4px 0 0', fontSize: 13, color: '#64748B' },
  planBadge: { display: 'flex', alignItems: 'center', gap: 8, background: '#1E3A5F', border: '1px solid #2563EB55', borderRadius: 8, padding: '10px 14px', marginBottom: 4, fontSize: 13 },
  planBadgeIcon: { fontSize: 16 },
  planBadgeText: { color: '#93C5FD', flex: 1 },
  planBadgeName: { color: '#F1F5F9', fontWeight: 700 },
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
  const [searchParams] = useSearchParams();

  const claimToken = searchParams.get('claim') ?? null;
  const planParam  = (searchParams.get('plan') ?? '').toUpperCase();
  const planLabel  = PLAN_LABELS[planParam] ?? null;

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
      const data = await signupApi(form.email, form.password, form.firstName, form.lastName, claimToken);
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

        {planLabel && claimToken && (
          <div style={S.planBadge}>
            <span style={S.planBadgeIcon}>✓</span>
            <span style={S.planBadgeText}>
              You've selected the <span style={S.planBadgeName}>{planLabel} plan</span> — your subscription will activate automatically.
            </span>
          </div>
        )}

        {/* Google SSO */}
        <button
          type="button"
          onClick={() => { window.location.href = '/api/auth/google'; }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            width: '100%', padding: '12px 16px', borderRadius: 8, marginBottom: 16,
            border: '1px solid #334155', background: '#0F172A',
            fontSize: 14, fontWeight: 500, color: '#F1F5F9', cursor: 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#1E293B'}
          onMouseLeave={e => e.currentTarget.style.background = '#0F172A'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continue with Google
        </button>

        {/* Apple SSO */}
        <button
          type="button"
          onClick={() => { window.location.href = '/api/auth/apple'; }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            width: '100%', padding: '12px 16px', borderRadius: 8, marginBottom: 16,
            border: '1px solid #334155', background: '#0F172A',
            fontSize: 14, fontWeight: 500, color: '#F1F5F9', cursor: 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#1E293B'}
          onMouseLeave={e => e.currentTarget.style.background = '#0F172A'}
        >
          <svg width="16" height="18" viewBox="0 0 814 1000" fill="#F1F5F9">
            <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105.6-57.8-155.5-127.4C46 790.7 0 663.1 0 541.8c0-207.1 126.7-317.7 251.6-317.7 66 0 120.9 43.5 162.8 43.5 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"/>
          </svg>
          Continue with Apple
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1, height: 1, background: '#334155' }} />
          <span style={{ fontSize: 12, color: '#475569' }}>or sign up with email</span>
          <div style={{ flex: 1, height: 1, background: '#334155' }} />
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
