import { useState, useEffect } from 'react';
import { getOrgMembersApi, addOrgMemberApi, updateOrgMemberRoleApi, removeOrgMemberApi } from '../services/api.js';

const ROLES = ['ADMIN', 'MEMBER', 'VIEWER'];

const ROLE_COLOR = {
  ADMIN:  '#8B5CF6',
  MEMBER: '#3B82F6',
  VIEWER: '#64748B',
};

const S = {
  card:   { background: '#1E293B', border: '1px solid #334155', borderRadius: 12 },
  header: { padding: '16px 20px', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 },
  label:  { fontSize: 14, fontWeight: 600, color: '#F1F5F9' },
  sub:    { fontSize: 12, color: '#64748B', marginTop: 2 },
  btn:    (active, color = 'linear-gradient(135deg,#3B82F6,#8B5CF6)') => ({
    padding: '7px 14px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600,
    cursor: active ? 'pointer' : 'not-allowed',
    background: active ? color : '#263348',
    color: active ? '#fff' : '#475569',
  }),
  ghost:  (color = '#94A3B8') => ({ padding: '4px 10px', borderRadius: 6, border: `1px solid ${color}40`, background: 'transparent', fontSize: 11, fontWeight: 600, color, cursor: 'pointer' }),
  badge:  (role) => ({ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: ROLE_COLOR[role] + '20', color: ROLE_COLOR[role], border: `1px solid ${ROLE_COLOR[role]}40` }),
  row:    { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderBottom: '1px solid #334155' },
  empty:  { padding: '32px 20px', textAlign: 'center', color: '#475569', fontSize: 13 },
  input:  { background: '#263348', border: '1px solid #334155', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#F1F5F9', outline: 'none' },
  select: { background: '#263348', border: '1px solid #334155', borderRadius: 6, padding: '7px 10px', fontSize: 12, color: '#F1F5F9', outline: 'none' },
};

function Spinner() {
  return (
    <svg style={{ width: 14, height: 14, animation: 'spin 1s linear infinite', display: 'inline' }} fill="none" viewBox="0 0 24 24">
      <circle style={{ opacity: .25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path style={{ opacity: .75 }} fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
    </svg>
  );
}

export default function TeamPanel({ orgId, currentUserId, isAdmin }) {
  const [members, setMembers]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [msg, setMsg]             = useState('');

  // Add member form
  const [addEmail, setAddEmail]   = useState('');
  const [addRole, setAddRole]     = useState('MEMBER');
  const [adding, setAdding]       = useState(false);
  const [addError, setAddError]   = useState('');

  // Per-row state
  const [changingRole, setChangingRole] = useState(null);
  const [removing, setRemoving]         = useState(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await getOrgMembersApi(orgId);
      setMembers(data.members ?? []);
    } catch (e) {
      setError(e.response?.data?.error ?? 'Failed to load team.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (orgId) load();
  }, [orgId]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!addEmail.trim()) return;
    setAdding(true);
    setAddError('');
    setMsg('');
    try {
      const res = await addOrgMemberApi(orgId, addEmail.trim(), addRole);
      setMembers(prev => [...prev, res.member]);
      setAddEmail('');
      setAddRole('MEMBER');
      setMsg(`${res.member.user.email} added as ${res.member.role}.`);
    } catch (e) {
      setAddError(e.response?.data?.error ?? 'Failed to add member.');
    } finally {
      setAdding(false);
    }
  }

  async function handleRoleChange(userId, role) {
    setChangingRole(userId);
    setMsg('');
    setError('');
    try {
      await updateOrgMemberRoleApi(orgId, userId, role);
      setMembers(prev => prev.map(m => m.user.id === userId ? { ...m, role } : m));
      setMsg('Role updated.');
    } catch (e) {
      setError(e.response?.data?.error ?? 'Failed to update role.');
    } finally {
      setChangingRole(null);
    }
  }

  async function handleRemove(userId, email) {
    if (!confirm(`Remove ${email} from this organization?`)) return;
    setRemoving(userId);
    setMsg('');
    setError('');
    try {
      await removeOrgMemberApi(orgId, userId);
      setMembers(prev => prev.filter(m => m.user.id !== userId));
      setMsg(`${email} removed.`);
    } catch (e) {
      setError(e.response?.data?.error ?? 'Failed to remove member.');
    } finally {
      setRemoving(null);
    }
  }

  function memberName(m) {
    const fn = m.user.firstName || '';
    const ln = m.user.lastName  || '';
    return (fn + ' ' + ln).trim() || m.user.email;
  }

  return (
    <div style={S.card}>
      <div style={S.header}>
        <div>
          <p style={S.label}>Team Members</p>
          <p style={S.sub}>{members.length} member{members.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {(error || msg) && (
        <div style={{ padding: '10px 20px', fontSize: 12, color: error ? '#F43F5E' : '#10B981', borderBottom: '1px solid #334155' }}>
          {error || msg}
        </div>
      )}

      {/* Add member form — ADMIN only */}
      {isAdmin && (
        <form onSubmit={handleAdd} style={{ padding: '14px 20px', borderBottom: '1px solid #334155', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <input
            type="email"
            placeholder="member@example.com"
            value={addEmail}
            onChange={e => { setAddEmail(e.target.value); setAddError(''); }}
            required
            style={{ ...S.input, flex: '1 1 180px', minWidth: 0 }}
          />
          <select value={addRole} onChange={e => setAddRole(e.target.value)} style={S.select}>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <button type="submit" disabled={adding || !addEmail.trim()} style={S.btn(!adding && !!addEmail.trim())}>
            {adding ? <><Spinner /> Adding…</> : 'Add member'}
          </button>
          {addError && <p style={{ width: '100%', margin: 0, fontSize: 11, color: '#F43F5E' }}>{addError}</p>}
        </form>
      )}

      {loading ? (
        <div style={S.empty}><Spinner /> Loading…</div>
      ) : members.length === 0 ? (
        <div style={S.empty}>No members yet.</div>
      ) : (
        <div>
          {members.map(m => {
            const isSelf = m.user.id === currentUserId;
            const isChanging = changingRole === m.user.id;
            const isRemoving = removing === m.user.id;
            return (
              <div key={m.id} style={{ ...S.row, background: isSelf ? '#3B82F608' : 'transparent' }}>
                {/* Avatar */}
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: ROLE_COLOR[m.role] + '30', border: `2px solid ${ROLE_COLOR[m.role]}50`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: ROLE_COLOR[m.role], flexShrink: 0 }}>
                  {memberName(m).charAt(0).toUpperCase()}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#F1F5F9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {memberName(m)}
                    </span>
                    <span style={S.badge(m.role)}>{m.role}</span>
                    {isSelf && <span style={{ fontSize: 10, color: '#64748B' }}>(you)</span>}
                  </div>
                  <span style={{ fontSize: 11, color: '#64748B' }}>
                    {m.user.email}
                    {m.joinedAt && ` · joined ${new Date(m.joinedAt).toLocaleDateString()}`}
                  </span>
                </div>

                {/* Role change — ADMIN, not self */}
                {isAdmin && !isSelf && (
                  <select
                    value={m.role}
                    disabled={isChanging}
                    onChange={e => handleRoleChange(m.user.id, e.target.value)}
                    style={{ ...S.select, opacity: isChanging ? 0.5 : 1 }}
                  >
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                )}

                {/* Remove — ADMIN can remove others; anyone can remove self */}
                {(isAdmin || isSelf) && (
                  <button
                    onClick={() => handleRemove(m.user.id, m.user.email)}
                    disabled={isRemoving}
                    style={S.ghost('#F43F5E')}
                  >
                    {isRemoving ? 'Removing…' : isSelf ? 'Leave' : 'Remove'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
