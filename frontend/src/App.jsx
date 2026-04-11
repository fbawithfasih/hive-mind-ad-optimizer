import { useState, useEffect } from 'react';
import './index.css';
import Dashboard from './pages/Dashboard';
import LoginPage from './pages/LoginPage';
import { getMeApi } from './services/api.js';

export default function App() {
  const [user, setUser]       = useState(null);   // null = not checked yet
  const [checked, setChecked] = useState(false);  // true once /me resolves

  // On mount: check if there's an active session
  useEffect(() => {
    getMeApi()
      .then(u => setUser(u))
      .catch(() => setUser(false))
      .finally(() => setChecked(true));
  }, []);

  if (!checked) {
    // Tiny loading state while session check runs
    return (
      <div style={{ minHeight: '100vh', background: '#0F172A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#475569', fontSize: 14 }}>Loading…</div>
      </div>
    );
  }

  if (!user) return <LoginPage onLogin={setUser} />;

  return <Dashboard user={user} onLogout={() => setUser(false)} />;
}
