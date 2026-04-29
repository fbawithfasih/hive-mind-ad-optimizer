import React, { useState, useEffect, useCallback } from 'react';
import {
  listAlertsApi, createAlertApi, updateAlertApi, deleteAlertApi,
  getAlertFiresApi, markFiresReadApi,
} from '../services/api.js';

// ── Styles ────────────────────────────────────────────────────────────────────

const glass = {
  background: 'rgba(10,14,30,0.85)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: 20,
  backdropFilter: 'blur(16px)',
  position: 'relative',
  overflow: 'hidden',
};

const inputSt = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  color: '#F1F5F9',
  borderRadius: 10,
  padding: '8px 13px',
  fontSize: 13,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

// ── Primitives ────────────────────────────────────────────────────────────────

function GradientBar({ top }) {
  return <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: top }} />;
}

function Spinner({ size = 14 }) {
  return (
    <svg style={{ width: size, height: size, animation: 'spin 1s linear infinite' }} fill="none" viewBox="0 0 24 24">
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <circle style={{ opacity: .2 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path style={{ opacity: .75 }} fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
    </svg>
  );
}

const METRICS = [
  { value: 'acos',        label: 'ACoS (%)',      hint: 'Advertising cost of sales' },
  { value: 'spend',       label: 'Spend ($)',      hint: 'Total ad spend' },
  { value: 'roas',        label: 'ROAS',           hint: 'Return on ad spend' },
  { value: 'ctr',         label: 'CTR',            hint: 'Click-through rate' },
  { value: 'clicks',      label: 'Clicks',         hint: 'Total clicks' },
  { value: 'impressions', label: 'Impressions',    hint: 'Total impressions' },
];

const CONDITIONS = [
  { value: 'gt',  label: 'is greater than'  },
  { value: 'gte', label: 'is ≥'             },
  { value: 'lt',  label: 'is less than'     },
  { value: 'lte', label: 'is ≤'             },
];

const METRIC_UNITS = { acos: '%', spend: '$', roas: '×', ctr: '', clicks: '', impressions: '' };
const METRIC_COLORS = {
  acos: '#F43F5E', spend: '#F59E0B', roas: '#10B981',
  ctr: '#3B82F6', clicks: '#8B5CF6', impressions: '#6366F1',
};

function metricLabel(m) { return METRICS.find(x => x.value === m)?.label ?? m; }
function condLabel(c)   { return CONDITIONS.find(x => x.value === c)?.label ?? c; }

function formatValue(metric, value) {
  const unit = METRIC_UNITS[metric] ?? '';
  const num  = typeof value === 'number' ? value.toFixed(metric === 'acos' || metric === 'roas' ? 1 : 0) : value;
  return metric === 'spend' ? `$${num}` : `${num}${unit}`;
}

// ── Alert form ────────────────────────────────────────────────────────────────

const EMPTY_FORM = { name: '', metric: 'acos', condition: 'gt', threshold: '' };

function AlertForm({ initial, onSave, onCancel, isSaving }) {
  const [form, setForm] = useState(initial ?? EMPTY_FORM);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const valid = form.name.trim() && form.threshold !== '' && !isNaN(Number(form.threshold));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#475569', display: 'block', marginBottom: 5 }}>Alert name</label>
        <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. High ACoS warning"
          style={inputSt}
          onFocus={e => e.target.style.borderColor = '#F43F5E'}
          onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px', gap: 10 }}>
        <div>
          <label style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#475569', display: 'block', marginBottom: 5 }}>Metric</label>
          <select value={form.metric} onChange={e => set('metric', e.target.value)}
            style={{ ...inputSt, cursor: 'pointer' }}>
            {METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#475569', display: 'block', marginBottom: 5 }}>Condition</label>
          <select value={form.condition} onChange={e => set('condition', e.target.value)}
            style={{ ...inputSt, cursor: 'pointer' }}>
            {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#475569', display: 'block', marginBottom: 5 }}>Threshold</label>
          <input type="number" value={form.threshold} onChange={e => set('threshold', e.target.value)}
            placeholder="0" min="0"
            style={{ ...inputSt }}
            onFocus={e => e.target.style.borderColor = '#F43F5E'}
            onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'} />
        </div>
      </div>

      <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: '#818CF8' }}>
        Fire when: <strong style={{ color: '#A5B4FC' }}>{metricLabel(form.metric)}</strong>{' '}
        <span style={{ color: '#6366F1' }}>{condLabel(form.condition)}</span>{' '}
        <strong style={{ color: '#A5B4FC' }}>{form.threshold || '…'}{METRIC_UNITS[form.metric]}</strong>
        {' '}across any campaign
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {onCancel && (
          <button onClick={onCancel}
            style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: '#475569', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
        )}
        <button onClick={() => valid && onSave(form)} disabled={!valid || isSaving}
          style={{ padding: '7px 20px', borderRadius: 8, border: 'none', background: valid && !isSaving ? 'linear-gradient(135deg,#F43F5E,#EF4444)' : 'rgba(255,255,255,0.05)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: valid && !isSaving ? 'pointer' : 'not-allowed', opacity: valid && !isSaving ? 1 : 0.5, display: 'flex', alignItems: 'center', gap: 6 }}>
          {isSaving ? <><Spinner size={12} /> Saving…</> : (initial ? 'Save changes' : '+ Create alert')}
        </button>
      </div>
    </div>
  );
}

// ── Alert card ────────────────────────────────────────────────────────────────

function AlertCard({ alert, onToggle, onDelete, onEdit }) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isEditing,   setIsEditing]   = useState(false);
  const [isSaving,    setIsSaving]    = useState(false);
  const color = METRIC_COLORS[alert.metric] ?? '#6366F1';

  async function handleSaveEdit(form) {
    setIsSaving(true);
    try { await onEdit(alert.id, form); setIsEditing(false); }
    finally { setIsSaving(false); }
  }

  return (
    <div style={{ ...glass, padding: 0, borderColor: alert.isActive ? `${color}20` : 'rgba(255,255,255,0.04)' }}>
      <GradientBar top={alert.isActive ? `linear-gradient(90deg,${color},${color}88)` : 'rgba(255,255,255,0.04)'} />
      <div style={{ padding: '14px 16px', position: 'relative' }}>
        {isEditing ? (
          <AlertForm
            initial={{ name: alert.name, metric: alert.metric, condition: alert.condition, threshold: String(alert.threshold) }}
            onSave={handleSaveEdit}
            onCancel={() => setIsEditing(false)}
            isSaving={isSaving}
          />
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: alert.isActive ? '#F1F5F9' : '#475569' }}>{alert.name}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: `${color}18`, color, border: `1px solid ${color}35` }}>
                    {metricLabel(alert.metric)}
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: alert.isActive ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.04)', color: alert.isActive ? '#10B981' : '#334155', border: `1px solid ${alert.isActive ? 'rgba(16,185,129,0.25)' : 'rgba(255,255,255,0.06)'}` }}>
                    {alert.isActive ? 'Active' : 'Paused'}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: 12, color: '#475569' }}>
                  Fires when <strong style={{ color: '#94A3B8' }}>{metricLabel(alert.metric)}</strong>{' '}
                  {condLabel(alert.condition)}{' '}
                  <strong style={{ color }}>{formatValue(alert.metric, alert.threshold)}</strong>
                </p>
              </div>

              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button onClick={() => onToggle(alert.id, !alert.isActive)}
                  style={{ fontSize: 11, padding: '4px 10px', borderRadius: 7, border: `1px solid ${alert.isActive ? 'rgba(245,158,11,0.3)' : 'rgba(16,185,129,0.3)'}`, background: alert.isActive ? 'rgba(245,158,11,0.08)' : 'rgba(16,185,129,0.08)', color: alert.isActive ? '#F59E0B' : '#10B981', cursor: 'pointer', fontWeight: 600 }}>
                  {alert.isActive ? 'Pause' : 'Enable'}
                </button>
                <button onClick={() => setIsEditing(true)}
                  style={{ fontSize: 11, padding: '4px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#475569', cursor: 'pointer' }}>
                  Edit
                </button>
                {showConfirm ? (
                  <>
                    <button onClick={() => onDelete(alert.id)}
                      style={{ fontSize: 11, padding: '4px 10px', borderRadius: 7, border: '1px solid rgba(244,63,94,0.35)', background: 'rgba(244,63,94,0.12)', color: '#F87171', cursor: 'pointer', fontWeight: 700 }}>
                      Confirm
                    </button>
                    <button onClick={() => setShowConfirm(false)}
                      style={{ fontSize: 11, padding: '4px 8px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: '#334155', cursor: 'pointer' }}>
                      ✕
                    </button>
                  </>
                ) : (
                  <button onClick={() => setShowConfirm(true)}
                    style={{ fontSize: 11, padding: '4px 10px', borderRadius: 7, border: '1px solid rgba(244,63,94,0.2)', background: 'transparent', color: '#F43F5E', cursor: 'pointer' }}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Fire history ──────────────────────────────────────────────────────────────

function FireHistory({ fires, onMarkAllRead, isMarking }) {
  if (!fires.length) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0', color: '#1E293B', fontSize: 13 }}>
        No alerts have fired yet — they'll appear here when campaign metrics trigger a rule
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {fires.map(fire => {
        const color = METRIC_COLORS[fire.alert?.metric] ?? '#6366F1';
        const date  = new Date(fire.triggeredAt);
        return (
          <div key={fire.id} style={{ display: 'grid', gridTemplateColumns: '8px 1fr auto', gap: 12, alignItems: 'center', padding: '11px 18px', borderBottom: '1px solid rgba(255,255,255,0.04)', background: fire.isRead ? 'transparent' : 'rgba(244,63,94,0.03)' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: fire.isRead ? '#1E293B' : color, boxShadow: fire.isRead ? 'none' : `0 0 8px ${color}` }} />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: fire.isRead ? '#475569' : '#F1F5F9' }}>{fire.alert?.name ?? '—'}</span>
                <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 99, background: `${color}14`, color, border: `1px solid ${color}30` }}>{metricLabel(fire.alert?.metric)}</span>
              </div>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: '#334155' }}>
                <strong style={{ color: '#64748B' }}>{fire.campaignName}</strong>
                {' · '}
                {metricLabel(fire.alert?.metric)} was{' '}
                <strong style={{ color }}>{formatValue(fire.alert?.metric, fire.metricValue)}</strong>
                {fire.alert && <span style={{ color: '#334155' }}> (threshold: {formatValue(fire.alert.metric, fire.alert.threshold)})</span>}
              </p>
            </div>
            <div style={{ fontSize: 10, color: '#1E293B', textAlign: 'right', whiteSpace: 'nowrap' }}>
              <div>{date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
              <div>{date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function AlertsPanel() {
  const [tab,       setTab]       = useState('rules');
  const [alerts,    setAlerts]    = useState([]);
  const [fires,     setFires]     = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving,  setIsSaving]  = useState(false);
  const [isMarking, setIsMarking] = useState(false);
  const [error,     setError]     = useState(null);
  const [showForm,  setShowForm]  = useState(false);

  const unread = fires.filter(f => !f.isRead).length;

  const loadAlerts = useCallback(async () => {
    setIsLoading(true); setError(null);
    try {
      const [rules, history] = await Promise.all([listAlertsApi(), getAlertFiresApi()]);
      setAlerts(rules);
      setFires(history);
    } catch (err) {
      setError(err.response?.data?.error ?? err.message ?? 'Failed to load alerts');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadAlerts(); }, [loadAlerts]);

  async function handleCreate(form) {
    setIsSaving(true); setError(null);
    try {
      const rule = await createAlertApi({ ...form, threshold: Number(form.threshold) });
      setAlerts(prev => [rule, ...prev]);
      setShowForm(false);
    } catch (err) {
      setError(err.response?.data?.error ?? err.message ?? 'Failed to create alert');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleEdit(id, form) {
    const updated = await updateAlertApi(id, { ...form, threshold: Number(form.threshold) });
    setAlerts(prev => prev.map(a => a.id === id ? updated : a));
  }

  async function handleToggle(id, isActive) {
    const updated = await updateAlertApi(id, { isActive });
    setAlerts(prev => prev.map(a => a.id === id ? updated : a));
  }

  async function handleDelete(id) {
    await deleteAlertApi(id);
    setAlerts(prev => prev.filter(a => a.id !== id));
  }

  async function handleMarkAllRead() {
    setIsMarking(true);
    try {
      await markFiresReadApi();
      setFires(prev => prev.map(f => ({ ...f, isRead: true })));
    } finally {
      setIsMarking(false);
    }
  }

  const activeCount  = alerts.filter(a =>  a.isActive).length;
  const pausedCount  = alerts.filter(a => !a.isActive).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Header ── */}
      <div style={{ ...glass, padding: '22px 24px', borderColor: 'rgba(244,63,94,0.2)', boxShadow: '0 4px 40px rgba(244,63,94,0.08)' }}>
        <GradientBar top="linear-gradient(90deg,#F43F5E,#F59E0B,#8B5CF6)" />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
          <div>
            <p style={{ margin: 0, fontWeight: 900, fontSize: 17, color: '#F1F5F9', letterSpacing: '-0.4px' }}>Campaign Alerts</p>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: '#334155' }}>
              Define metric thresholds — get notified when any campaign crosses them after loading performance data
            </p>
          </div>
          <div style={{ display: 'flex', gap: 20 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#10B981', lineHeight: 1 }}>{activeCount}</div>
              <div style={{ fontSize: 10, color: '#334155', marginTop: 2 }}>Active</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#F59E0B', lineHeight: 1 }}>{pausedCount}</div>
              <div style={{ fontSize: 10, color: '#334155', marginTop: 2 }}>Paused</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: unread > 0 ? '#F43F5E' : '#334155', lineHeight: 1 }}>{unread}</div>
              <div style={{ fontSize: 10, color: '#334155', marginTop: 2 }}>Unread</div>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.25)', color: '#F87171', borderRadius: 12, padding: '12px 16px', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 4, border: '1px solid rgba(255,255,255,0.06)', width: 'fit-content' }}>
        {[
          { id: 'rules',   label: `Alert Rules (${alerts.length})` },
          { id: 'history', label: `Fire History${unread > 0 ? ` · ${unread} new` : ''}` },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '7px 18px', borderRadius: 9, border: 'none', cursor: 'pointer',
            background: tab === t.id ? 'linear-gradient(135deg,#F43F5E,#EF4444)' : 'transparent',
            color: tab === t.id ? '#fff' : '#475569',
            fontWeight: 700, fontSize: 12,
            boxShadow: tab === t.id ? '0 2px 12px rgba(244,63,94,0.4)' : 'none',
            transition: 'all 0.15s',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '24px 0', color: '#334155', fontSize: 13 }}>
          <Spinner size={16} /> Loading…
        </div>
      )}

      {/* ── Rules tab ── */}
      {!isLoading && tab === 'rules' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Create form */}
          {showForm ? (
            <div style={{ ...glass, padding: '18px 20px', borderColor: 'rgba(244,63,94,0.2)' }}>
              <GradientBar top="linear-gradient(90deg,#F43F5E,#F59E0B)" />
              <div style={{ position: 'relative' }}>
                <p style={{ margin: '0 0 14px', fontSize: 12, fontWeight: 700, color: '#F87171' }}>New Alert Rule</p>
                <AlertForm onSave={handleCreate} onCancel={() => setShowForm(false)} isSaving={isSaving} />
              </div>
            </div>
          ) : (
            <button onClick={() => setShowForm(true)}
              style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 20px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#F43F5E,#EF4444)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', boxShadow: '0 4px 18px rgba(244,63,94,0.4)' }}>
              <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4"/>
              </svg>
              New Alert
            </button>
          )}

          {alerts.length === 0 && !showForm && (
            <div style={{ ...glass, padding: '40px 0', textAlign: 'center', color: '#1E293B', fontSize: 13 }}>
              No alerts yet — create one above to start monitoring campaign metrics
            </div>
          )}

          {alerts.map(alert => (
            <AlertCard key={alert.id} alert={alert} onToggle={handleToggle} onDelete={handleDelete} onEdit={handleEdit} />
          ))}
        </div>
      )}

      {/* ── History tab ── */}
      {!isLoading && tab === 'history' && (
        <div style={{ ...glass, padding: 0, borderColor: 'rgba(244,63,94,0.1)' }}>
          <GradientBar top="linear-gradient(90deg,#F43F5E,#8B5CF6)" />

          <div style={{ padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#334155' }}>
              Recent Fires {fires.length > 0 && `(${fires.length})`}
            </span>
            {unread > 0 && (
              <button onClick={handleMarkAllRead} disabled={isMarking}
                style={{ fontSize: 11, padding: '4px 12px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#475569', cursor: isMarking ? 'default' : 'pointer', opacity: isMarking ? 0.6 : 1 }}>
                {isMarking ? <Spinner size={11} /> : `Mark all read (${unread})`}
              </button>
            )}
          </div>

          <FireHistory fires={fires} onMarkAllRead={handleMarkAllRead} isMarking={isMarking} />
        </div>
      )}
    </div>
  );
}
