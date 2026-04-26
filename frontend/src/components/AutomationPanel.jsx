import React, { useState, useEffect, useCallback } from 'react';
import {
  listRulesApi, createRuleApi, updateRuleApi,
  deleteRuleApi, runRuleApi, runAllRulesApi, getRuleHistoryApi,
} from '../services/api.js';

const METRICS = [
  { value: 'acos',        label: 'ACoS (%)',     hint: 'e.g. 30 = 30%' },
  { value: 'roas',        label: 'ROAS',         hint: 'e.g. 3 = 3×' },
  { value: 'ctr',         label: 'CTR (%)',       hint: 'e.g. 0.5 = 0.5%' },
  { value: 'spend',       label: 'Daily Spend',   hint: 'in your currency' },
  { value: 'clicks',      label: 'Clicks',        hint: 'total clicks' },
  { value: 'impressions', label: 'Impressions',   hint: 'total impressions' },
];

const CONDITIONS = [
  { value: 'gt',  label: '>'  },
  { value: 'gte', label: '>=' },
  { value: 'lt',  label: '<'  },
  { value: 'lte', label: '<=' },
];

const ACTIONS = [
  { value: 'increase_budget', label: 'Increase Budget',  needsAdj: true },
  { value: 'decrease_budget', label: 'Decrease Budget',  needsAdj: true },
  { value: 'pause',           label: 'Pause Campaign',   needsAdj: false },
  { value: 'enable',          label: 'Enable Campaign',  needsAdj: false },
];

const STATUS_COLOR = {
  success: '#10B981',
  partial: '#F59E0B',
  failed:  '#EF4444',
  skipped: '#64748B',
};

const S = {
  card:   { background: '#1E293B', border: '1px solid #334155', borderRadius: 12, padding: 20, marginBottom: 12 },
  label:  { fontSize: 11, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 },
  input:  { background: '#0F172A', border: '1px solid #334155', borderRadius: 8, padding: '8px 12px', color: '#F1F5F9', fontSize: 13, width: '100%' },
  btn:    (color = '#3B82F6') => ({ background: color, border: 'none', borderRadius: 8, padding: '8px 16px', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }),
  ghost:  { background: 'transparent', border: '1px solid #334155', borderRadius: 8, padding: '8px 16px', color: '#94A3B8', fontSize: 13, cursor: 'pointer' },
  badge:  (color) => ({ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: color + '22', color, border: `1px solid ${color}44` }),
};

function RuleForm({ profileId, onSave, onCancel }) {
  const [form, setForm] = useState({
    name: '', profileId: profileId ?? '', metric: 'acos', condition: 'gt',
    threshold: '', action: 'decrease_budget', adjustment: 10, lookbackDays: 14,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const needsAdj = ACTIONS.find(a => a.value === form.action)?.needsAdj ?? false;

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const rule = await createRuleApi({ ...form, threshold: Number(form.threshold) });
      onSave(rule);
    } catch (err) {
      setError(err.response?.data?.error ?? err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <p style={S.label}>Rule Name</p>
        <input style={S.input} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Pause high-ACoS campaigns" required />
      </div>
      <div>
        <p style={S.label}>Profile ID</p>
        <input style={S.input} value={form.profileId} onChange={e => set('profileId', e.target.value)} placeholder="Amazon Ads profile ID" required />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <div>
          <p style={S.label}>Metric</p>
          <select style={S.input} value={form.metric} onChange={e => set('metric', e.target.value)}>
            {METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <div>
          <p style={S.label}>Condition</p>
          <select style={S.input} value={form.condition} onChange={e => set('condition', e.target.value)}>
            {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <p style={S.label}>Threshold ({METRICS.find(m => m.value === form.metric)?.hint})</p>
          <input style={S.input} type="number" step="any" value={form.threshold}
            onChange={e => set('threshold', e.target.value)} placeholder="0" required />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: needsAdj ? '1fr 1fr 1fr' : '1fr 1fr', gap: 10 }}>
        <div>
          <p style={S.label}>Action</p>
          <select style={S.input} value={form.action} onChange={e => set('action', e.target.value)}>
            {ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </div>
        {needsAdj && (
          <div>
            <p style={S.label}>Adjustment (%)</p>
            <input style={S.input} type="number" min="1" max="100" value={form.adjustment}
              onChange={e => set('adjustment', e.target.value)} />
          </div>
        )}
        <div>
          <p style={S.label}>Lookback Days</p>
          <input style={S.input} type="number" min="1" max="60" value={form.lookbackDays}
            onChange={e => set('lookbackDays', e.target.value)} />
        </div>
      </div>

      {error && <p style={{ color: '#EF4444', fontSize: 13 }}>{error}</p>}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" style={S.ghost} onClick={onCancel}>Cancel</button>
        <button type="submit" style={S.btn()} disabled={saving}>
          {saving ? 'Creating…' : 'Create Rule'}
        </button>
      </div>
    </form>
  );
}

function RuleCard({ rule, onToggle, onDelete, onRun, onViewHistory }) {
  const [running, setRunning] = useState(false);
  const [result,  setResult]  = useState(null);

  const metricLabel = METRICS.find(m => m.value === rule.metric)?.label ?? rule.metric;
  const condLabel   = CONDITIONS.find(c => c.value === rule.condition)?.label ?? rule.condition;
  const actionLabel = ACTIONS.find(a => a.value === rule.action)?.label ?? rule.action;
  const lastExec    = rule.executions?.[0];

  async function handleRun() {
    setRunning(true); setResult(null);
    try {
      const r = await runRuleApi(rule.id);
      setResult(r);
      onRun();
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: '#F1F5F9' }}>{rule.name}</span>
            <span style={S.badge(rule.isActive ? '#10B981' : '#64748B')}>
              {rule.isActive ? 'Active' : 'Paused'}
            </span>
          </div>
          <p style={{ fontSize: 12, color: '#94A3B8', marginBottom: 8 }}>
            If <b style={{ color: '#F1F5F9' }}>{metricLabel}</b>{' '}
            <b style={{ color: '#3B82F6' }}>{condLabel} {rule.threshold}</b>
            {' '}&rarr; <b style={{ color: '#8B5CF6' }}>{actionLabel}</b>
            {['increase_budget','decrease_budget'].includes(rule.action) && ` by ${rule.adjustment}%`}
            {' '}· lookback {rule.lookbackDays}d
          </p>
          {lastExec && (
            <p style={{ fontSize: 11, color: '#64748B' }}>
              Last run:{' '}
              <span style={{ color: STATUS_COLOR[lastExec.status] ?? '#94A3B8' }}>{lastExec.status}</span>
              {' '}· {lastExec.affectedCount} campaigns
              {' '}· {new Date(lastExec.executedAt).toLocaleDateString()}
            </p>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
          <button style={S.btn(running ? '#475569' : '#10B981')} disabled={running} onClick={handleRun}>
            {running ? '…' : 'Run'}
          </button>
          <button style={S.ghost} onClick={() => onViewHistory(rule)}>History</button>
          <button style={S.ghost} onClick={() => onToggle(rule)}>
            {rule.isActive ? 'Pause' : 'Enable'}
          </button>
          <button style={{ ...S.ghost, color: '#EF4444', borderColor: '#EF444444' }} onClick={() => onDelete(rule)}>
            Delete
          </button>
        </div>
      </div>

      {result && (
        <div style={{ marginTop: 12, padding: 12, background: '#0F172A', borderRadius: 8, border: `1px solid ${STATUS_COLOR[result.status] ?? '#334155'}33` }}>
          <p style={{ fontSize: 12, color: STATUS_COLOR[result.status] ?? '#94A3B8', fontWeight: 600 }}>
            {result.status === 'skipped' ? 'Skipped' : `${result.affectedCount} campaign(s) affected`}
          </p>
          {result.error && <p style={{ fontSize: 11, color: '#EF4444', marginTop: 4 }}>{result.error}</p>}
          {result.changes?.slice(0, 5).map((c, i) => (
            <p key={i} style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
              {c.campaignName}: {c.field} {c.oldValue} → {c.newValue}
            </p>
          ))}
          {result.changes?.length > 5 && (
            <p style={{ fontSize: 11, color: '#64748B' }}>+{result.changes.length - 5} more…</p>
          )}
        </div>
      )}
    </div>
  );
}

function HistoryModal({ rule, onClose }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getRuleHistoryApi(rule.id).then(setHistory).finally(() => setLoading(false));
  }, [rule.id]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#00000088', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: '#1E293B', border: '1px solid #334155', borderRadius: 12, padding: 24, width: '100%', maxWidth: 640, maxHeight: '80vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <p style={{ fontWeight: 600, color: '#F1F5F9' }}>Execution History — {rule.name}</p>
          <button style={S.ghost} onClick={onClose}>Close</button>
        </div>
        {loading && <p style={{ color: '#94A3B8', fontSize: 13 }}>Loading…</p>}
        {!loading && history.length === 0 && <p style={{ color: '#64748B', fontSize: 13 }}>No executions yet.</p>}
        {history.map(h => (
          <div key={h.id} style={{ padding: '10px 0', borderBottom: '1px solid #334155' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={S.badge(STATUS_COLOR[h.status] ?? '#94A3B8')}>{h.status}</span>
              <span style={{ fontSize: 12, color: '#94A3B8' }}>{new Date(h.executedAt).toLocaleString()}</span>
              <span style={{ fontSize: 12, color: '#64748B' }}>{h.affectedCount} campaigns</span>
            </div>
            {h.error && <p style={{ fontSize: 11, color: '#EF4444', marginTop: 4 }}>{h.error}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AutomationPanel({ profileId }) {
  const [rules,       setRules]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [showForm,    setShowForm]    = useState(false);
  const [historyRule, setHistoryRule] = useState(null);
  const [runningAll,  setRunningAll]  = useState(false);
  const [runAllResult, setRunAllResult] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    listRulesApi().then(setRules).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleToggle(rule) {
    await updateRuleApi(rule.id, { isActive: !rule.isActive });
    load();
  }

  async function handleDelete(rule) {
    if (!confirm(`Delete rule "${rule.name}"?`)) return;
    await deleteRuleApi(rule.id);
    load();
  }

  async function handleRunAll() {
    setRunningAll(true); setRunAllResult(null);
    try {
      const r = await runAllRulesApi();
      setRunAllResult(r.results);
      load();
    } finally {
      setRunningAll(false);
    }
  }

  return (
    <div style={{ padding: 20 }}>
      {historyRule && <HistoryModal rule={historyRule} onClose={() => setHistoryRule(null)} />}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <p style={{ fontWeight: 700, fontSize: 16, color: '#F1F5F9' }}>Campaign Automation</p>
          <p style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>
            Rules run against your latest campaign performance report.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={S.btn('#475569')} onClick={handleRunAll} disabled={runningAll || rules.filter(r => r.isActive).length === 0}>
            {runningAll ? 'Running…' : `Run All (${rules.filter(r => r.isActive).length})`}
          </button>
          <button style={S.btn()} onClick={() => setShowForm(true)}>+ New Rule</button>
        </div>
      </div>

      {/* Run-all result */}
      {runAllResult && (
        <div style={{ ...S.card, marginBottom: 16 }}>
          <p style={{ fontWeight: 600, fontSize: 13, color: '#F1F5F9', marginBottom: 8 }}>Run All Results</p>
          {runAllResult.map(r => (
            <div key={r.ruleId} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
              <span style={S.badge(STATUS_COLOR[r.status] ?? '#94A3B8')}>{r.status}</span>
              <span style={{ fontSize: 12, color: '#F1F5F9' }}>{r.ruleName}</span>
              <span style={{ fontSize: 12, color: '#64748B' }}>{r.affectedCount} affected</span>
              {r.error && <span style={{ fontSize: 11, color: '#EF4444' }}>{r.error}</span>}
            </div>
          ))}
        </div>
      )}

      {/* New rule form */}
      {showForm && (
        <div style={{ ...S.card, borderColor: '#3B82F644' }}>
          <p style={{ fontWeight: 600, fontSize: 14, color: '#F1F5F9', marginBottom: 16 }}>New Rule</p>
          <RuleForm
            profileId={profileId}
            onSave={rule => { setRules(r => [rule, ...r]); setShowForm(false); }}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {/* Rules list */}
      {loading && <p style={{ color: '#94A3B8', fontSize: 13, textAlign: 'center', padding: 40 }}>Loading rules…</p>}

      {!loading && rules.length === 0 && !showForm && (
        <div style={{ textAlign: 'center', padding: 48, color: '#64748B' }}>
          <p style={{ fontSize: 14, marginBottom: 8 }}>No automation rules yet.</p>
          <p style={{ fontSize: 12 }}>Create a rule to automatically adjust bids and budgets based on performance.</p>
        </div>
      )}

      {rules.map(rule => (
        <RuleCard
          key={rule.id}
          rule={rule}
          onToggle={handleToggle}
          onDelete={handleDelete}
          onRun={load}
          onViewHistory={setHistoryRule}
        />
      ))}
    </div>
  );
}
