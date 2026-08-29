import { useState, useEffect } from 'react';
import {
  getOrgApi, updateOrgApi, getOrgMembersApi, updateOrgMemberRoleApi, removeOrgMemberApi,
  inviteOrgMemberApi, getOrgInvitationsApi, revokeOrgInvitationApi,
} from '../services/api.js';

const ROLES = ['ADMIN', 'MEMBER', 'VIEWER'];

const ROLE_COLOR = {
  ADMIN:  'var(--accent-strong)',
  MEMBER: 'var(--info-strong)',
  VIEWER: 'var(--text-subtle)',
};

const S = {
  card:   { background: 'var(--bg-panel)', border: '1px solid var(--border-strong)', borderRadius: 12 },
  header: { padding: '16px 20px', borderBottom: '1px solid var(--border-strong)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 },
  label:  { fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' },
  sub:    { fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 },
  btn:    (active, color = 'linear-gradient(135deg,var(--info-strong),var(--accent-strong))') => ({
    padding: '7px 14px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600,
    cursor: active ? 'pointer' : 'not-allowed',
    background: active ? color : 'var(--bg-panel-2)',
    color: active ? '#fff' : 'var(--text-faint)',
  }),
  ghost:  (color = 'var(--text-muted)') => ({ padding: '4px 10px', borderRadius: 6, border: `1px solid ${color}40`, background: 'transparent', fontSize: 11, fontWeight: 600, color, cursor: 'pointer' }),
  badge:  (role) => ({ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: `color-mix(in srgb, ${ROLE_COLOR[role]} 13%, transparent)`, color: ROLE_COLOR[role], border: `1px solid color-mix(in srgb, ${ROLE_COLOR[role]} 25%, transparent)` }),
  row:    { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderBottom: '1px solid var(--border-strong)' },
  empty:  { padding: '32px 20px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 },
  input:  { background: 'var(--bg-panel-2)', border: '1px solid var(--border-strong)', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: 'var(--text-primary)', outline: 'none' },
  select: { background: 'var(--bg-panel-2)', border: '1px solid var(--border-strong)', borderRadius: 6, padding: '7px 10px', fontSize: 12, color: 'var(--text-primary)', outline: 'none' },
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

  // Invite form
  const [addEmail, setAddEmail]   = useState('');
  const [addRole, setAddRole]     = useState('MEMBER');
  const [adding, setAdding]       = useState(false);
  const [addError, setAddError]   = useState('');

  // Pending invitations (admins only — the API rejects everyone else)
  const [invites, setInvites]       = useState([]);
  const [revoking, setRevoking]     = useState(null);

  // Per-row state
  const [changingRole, setChangingRole] = useState(null);
  const [removing, setRemoving]         = useState(null);

  // Org brand name — drives Brand Analytics ASIN matching and report labelling
  const [brandName, setBrandName]       = useState('');
  const [savedBrand, setSavedBrand]     = useState('');
  const [savingBrand, setSavingBrand]   = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [data, orgData, inviteData] = await Promise.all([
        getOrgMembersApi(orgId),
        // Best-effort: the team list still renders if org settings fail to load.
        getOrgApi(orgId).catch(() => null),
        // Admin-only endpoint — 403 for everyone else, which is not an error here.
        isAdmin ? getOrgInvitationsApi(orgId).catch(() => null) : null,
      ]);
      setMembers(data.members ?? []);
      setInvites(inviteData?.invitations ?? []);
      const brand = orgData?.org?.brandName ?? '';
      setBrandName(brand);
      setSavedBrand(brand);
    } catch (e) {
      setError(e.response?.data?.error ?? 'Failed to load team.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveBrand(e) {
    e.preventDefault();
    setSavingBrand(true);
    setMsg('');
    setError('');
    try {
      const res = await updateOrgApi(orgId, { brandName });
      const saved = res.org?.brandName ?? '';
      setBrandName(saved);
      setSavedBrand(saved);
      setMsg(saved ? `Brand name set to "${saved}".` : 'Brand name cleared.');
    } catch (e) {
      setError(e.response?.data?.error ?? 'Failed to save brand name.');
    } finally {
      setSavingBrand(false);
    }
  }

  useEffect(() => {
    if (orgId) load();
  }, [orgId, isAdmin]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!addEmail.trim()) return;
    setAdding(true);
    setAddError('');
    setMsg('');
    try {
      const res = await inviteOrgMemberApi(orgId, addEmail.trim(), addRole);
      setInvites(prev => [res.invitation, ...prev]);
      setAddEmail('');
      setAddRole('MEMBER');
      setMsg(`Invitation sent to ${res.invitation.email}. They join once they accept it.`);
    } catch (e) {
      setAddError(e.response?.data?.error ?? 'Failed to send invitation.');
    } finally {
      setAdding(false);
    }
  }

  async function handleRevoke(invitationId, email) {
    setRevoking(invitationId);
    setMsg('');
    setError('');
    try {
      await revokeOrgInvitationApi(orgId, invitationId);
      setInvites(prev => prev.filter(i => i.id !== invitationId));
      setMsg(`Invitation to ${email} revoked.`);
    } catch (e) {
      setError(e.response?.data?.error ?? 'Failed to revoke invitation.');
    } finally {
      setRevoking(null);
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
        <div style={{ padding: '10px 20px', fontSize: 12, color: error ? 'var(--rose)' : 'var(--success)', borderBottom: '1px solid var(--border-strong)' }}>
          {error || msg}
        </div>
      )}

      {/* Brand name — ADMIN only. Brand Analytics matches this against product
          titles to identify the org's own ASINs, and reports are labelled with it. */}
      {isAdmin && (
        <form onSubmit={handleSaveBrand} style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-strong)' }}>
          <label htmlFor="org-brand-name" style={{ ...S.sub, display: 'block', marginBottom: 6 }}>
            Brand name — as it appears in your Amazon product titles
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              id="org-brand-name"
              type="text"
              placeholder="e.g. Queenza"
              value={brandName}
              onChange={e => setBrandName(e.target.value)}
              style={{ ...S.input, flex: '1 1 180px', minWidth: 0 }}
            />
            <button
              type="submit"
              disabled={savingBrand || brandName.trim() === savedBrand.trim()}
              style={S.btn(!savingBrand && brandName.trim() !== savedBrand.trim())}
            >
              {savingBrand ? <><Spinner /> Saving…</> : 'Save'}
            </button>
          </div>
          {!savedBrand && (
            <p style={{ ...S.sub, marginTop: 6 }}>
              Not set — Brand Analytics falls back to your catalog report, and keyword
              brand enrichment stays off.
            </p>
          )}
        </form>
      )}

      {/* Add member form — ADMIN only */}
      {isAdmin && (
        <form onSubmit={handleAdd} style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-strong)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <input
            type="email"
            placeholder="teammate@example.com"
            value={addEmail}
            onChange={e => { setAddEmail(e.target.value); setAddError(''); }}
            required
            style={{ ...S.input, flex: '1 1 180px', minWidth: 0 }}
          />
          <select value={addRole} onChange={e => setAddRole(e.target.value)} style={S.select}>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <button type="submit" disabled={adding || !addEmail.trim()} style={S.btn(!adding && !!addEmail.trim())}>
            {adding ? <><Spinner /> Sending…</> : 'Send invite'}
          </button>
          {addError && <p style={{ width: '100%', margin: 0, fontSize: 11, color: 'var(--rose)' }}>{addError}</p>}
        </form>
      )}

      {/* Pending invitations — ADMIN only. They are not members yet. */}
      {isAdmin && invites.length > 0 && (
        <div style={{ borderBottom: '1px solid var(--border-strong)' }}>
          <p style={{ ...S.sub, padding: '10px 20px 4px', margin: 0 }}>
            Pending invitations ({invites.length}) — not members until accepted
          </p>
          {invites.map(inv => (
            <div key={inv.id} style={{ ...S.row, opacity: .85 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {inv.email}
                </div>
                <div style={S.sub}>
                  Invited as {inv.role} · expires {new Date(inv.expiresAt).toLocaleDateString()}
                </div>
              </div>
              <button
                onClick={() => handleRevoke(inv.id, inv.email)}
                disabled={revoking === inv.id}
                style={S.btn(revoking !== inv.id)}
              >
                {revoking === inv.id ? <><Spinner /> Revoking…</> : 'Revoke'}
              </button>
            </div>
          ))}
        </div>
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
              <div key={m.id} style={{ ...S.row, background: isSelf ? 'color-mix(in srgb, var(--info-strong) 3%, transparent)' : 'transparent' }}>
                {/* Avatar */}
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: `color-mix(in srgb, ${ROLE_COLOR[m.role]} 19%, transparent)`, border: `2px solid color-mix(in srgb, ${ROLE_COLOR[m.role]} 31%, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: ROLE_COLOR[m.role], flexShrink: 0 }}>
                  {memberName(m).charAt(0).toUpperCase()}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {memberName(m)}
                    </span>
                    <span style={S.badge(m.role)}>{m.role}</span>
                    {isSelf && <span style={{ fontSize: 10, color: 'var(--text-subtle)' }}>(you)</span>}
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
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
                    style={S.ghost('var(--rose)')}
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
