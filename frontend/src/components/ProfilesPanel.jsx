import { useState, useEffect } from 'react';
import { getStoredProfilesApi, syncProfilesApi, setDefaultProfileApi } from '../services/api.js';

const S = {
  card:    { background: 'var(--bg-panel)', border: '1px solid var(--border-strong)', borderRadius: 12 },
  header:  { padding: '16px 20px', borderBottom: '1px solid var(--border-strong)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  label:   { fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' },
  sub:     { fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 },
  btn:     (active) => ({
    padding: '7px 14px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600,
    cursor: active ? 'pointer' : 'not-allowed',
    background: active ? 'linear-gradient(135deg,#3B82F6,#8B5CF6)' : 'var(--bg-panel-2)',
    color: active ? '#fff' : 'var(--text-faint)',
  }),
  ghost:   { padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border-strong)', background: 'transparent', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', cursor: 'pointer' },
  badge:   (color) => ({ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: color + '20', color, border: `1px solid ${color}40` }),
  row:     { display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', borderBottom: '1px solid var(--bg-panel)' },
  empty:   { padding: '32px 20px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 },
};

function Spinner() {
  return (
    <svg style={{ width: 14, height: 14, animation: 'spin 1s linear infinite', display: 'inline' }} fill="none" viewBox="0 0 24 24">
      <circle style={{ opacity: .25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path style={{ opacity: .75 }} fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
    </svg>
  );
}

export default function ProfilesPanel({ isAdmin }) {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [syncing, setSyncing]   = useState(false);
  const [settingDefault, setSettingDefault] = useState(null);
  const [error, setError]       = useState('');
  const [msg, setMsg]           = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await getStoredProfilesApi();
      setProfiles(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.response?.data?.error ?? 'Failed to load profiles.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleSync() {
    setSyncing(true);
    setMsg('');
    setError('');
    try {
      const res = await syncProfilesApi();
      setMsg(`Synced ${res.synced} profile${res.synced !== 1 ? 's' : ''} from Amazon.`);
      await load();
    } catch (e) {
      setError(e.response?.data?.error ?? 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  }

  async function handleSetDefault(profileId) {
    setSettingDefault(profileId);
    setMsg('');
    setError('');
    try {
      await setDefaultProfileApi(profileId);
      setMsg('Default profile updated.');
      await load();
    } catch (e) {
      setError(e.response?.data?.error ?? 'Failed to update default.');
    } finally {
      setSettingDefault(null);
    }
  }

  return (
    <div style={S.card}>
      <div style={S.header}>
        <div>
          <p style={S.label}>Amazon Profiles</p>
          <p style={S.sub}>{profiles.length} profile{profiles.length !== 1 ? 's' : ''} stored</p>
        </div>
        {isAdmin && (
          <button onClick={handleSync} disabled={syncing} style={S.btn(!syncing)}>
            {syncing ? <><Spinner /> Syncing…</> : 'Sync from Amazon'}
          </button>
        )}
      </div>

      {(error || msg) && (
        <div style={{ padding: '10px 20px', fontSize: 12, color: error ? '#F43F5E' : '#10B981', borderBottom: '1px solid var(--border-strong)' }}>
          {error || msg}
        </div>
      )}

      {loading ? (
        <div style={S.empty}><Spinner /> Loading…</div>
      ) : profiles.length === 0 ? (
        <div style={S.empty}>
          No profiles synced yet.{isAdmin ? ' Click "Sync from Amazon" to import your advertising profiles.' : ' Ask an admin to sync profiles.'}
        </div>
      ) : (
        <div>
          {profiles.map(p => (
            <div key={p.id} style={{ ...S.row, background: p.isDefault ? '#3B82F608' : 'transparent' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.profileName}
                  </span>
                  {p.isDefault && <span style={S.badge('#10B981')}>Default</span>}
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                  {p.countryCode} · ID {p.profileId}
                  {p.lastSyncedAt && ` · synced ${new Date(p.lastSyncedAt).toLocaleDateString()}`}
                </span>
              </div>
              {isAdmin && !p.isDefault && (
                <button
                  onClick={() => handleSetDefault(p.profileId)}
                  disabled={settingDefault === p.profileId}
                  style={S.ghost}
                >
                  {settingDefault === p.profileId ? 'Setting…' : 'Set default'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
