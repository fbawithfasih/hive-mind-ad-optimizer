import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { verifyEmailApi, resendVerificationApi } from '../services/api.js';

const S = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#0F172A 0%,#1E293B 100%)' },
  card: { width: '100%', maxWidth: 420, padding: '48px 36px', background: '#1E293B', borderRadius: 16, border: '1px solid #334155', boxShadow: '0 25px 60px rgba(0,0,0,0.5)', textAlign: 'center' },
  icon: { fontSize: 48, marginBottom: 16 },
  h1: { margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: '#F1F5F9' },
  p: { margin: '0 0 24px', fontSize: 14, color: '#94A3B8', lineHeight: 1.6 },
  btn: { display: 'inline-block', padding: '11px 24px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#3B82F6,#8B5CF6)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', textDecoration: 'none' },
  linkBtn: { background: 'none', border: 'none', color: '#3B82F6', fontSize: 13, cursor: 'pointer', padding: 0 },
  err: { background: '#F43F5E18', border: '1px solid #F43F5E44', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#F87171', marginBottom: 16 },
  ok: { background: '#10B98118', border: '1px solid #10B98144', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#34D399', marginBottom: 16 },
};

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token');

  const [status, setStatus]   = useState(token ? 'verifying' : 'no-token');
  const [message, setMessage] = useState('');
  const [resent, setResent]   = useState(false);

  useEffect(() => {
    if (!token) return;
    verifyEmailApi(token)
      .then(() => setStatus('success'))
      .catch(err => {
        setMessage(err.response?.data?.error ?? 'Verification failed.');
        setStatus('error');
      });
  }, [token]);

  async function handleResend() {
    try {
      await resendVerificationApi();
      setResent(true);
    } catch (err) {
      setMessage(err.response?.data?.error ?? 'Could not resend email.');
    }
  }

  if (status === 'verifying') return (
    <div style={S.page}><div style={S.card}>
      <div style={S.icon}>⏳</div>
      <h1 style={S.h1}>Verifying your email…</h1>
      <p style={S.p}>Hold on while we confirm your address.</p>
    </div></div>
  );

  if (status === 'success') return (
    <div style={S.page}><div style={S.card}>
      <div style={S.icon}>✅</div>
      <h1 style={S.h1}>Email verified!</h1>
      <p style={S.p}>Your account is active. You can now use all features.</p>
      <Link to="/" style={S.btn}>Go to Dashboard</Link>
    </div></div>
  );

  if (status === 'error') return (
    <div style={S.page}><div style={S.card}>
      <div style={S.icon}>❌</div>
      <h1 style={S.h1}>Verification failed</h1>
      {message && <div style={S.err}>{message}</div>}
      <p style={S.p}>The link may have expired. Request a new one below.</p>
      {resent
        ? <div style={S.ok}>A new verification email has been sent.</div>
        : <button style={S.linkBtn} onClick={handleResend}>Resend verification email</button>
      }
      <div style={{ marginTop: 16 }}>
        <Link to="/login" style={{ fontSize: 13, color: '#64748B' }}>Back to login</Link>
      </div>
    </div></div>
  );

  // no-token state — landed on /verify-email with no token
  return (
    <div style={S.page}><div style={S.card}>
      <div style={S.icon}>✉️</div>
      <h1 style={S.h1}>Check your inbox</h1>
      <p style={S.p}>We sent a verification link to your email. Click it to activate your account.</p>
      {resent
        ? <div style={S.ok}>A new verification email has been sent.</div>
        : <button style={S.linkBtn} onClick={handleResend}>Didn't get it? Resend</button>
      }
      <div style={{ marginTop: 20 }}>
        <Link to="/login" style={{ fontSize: 13, color: '#64748B' }}>Back to login</Link>
      </div>
    </div></div>
  );
}
