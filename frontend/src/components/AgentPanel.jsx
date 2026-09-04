/**
 * The agent's review surface.
 *
 * Shadow mode produces decisions nobody can act on unless they can be read and
 * judged. This panel is what turns those rows into the agreement-rate evidence
 * that graduates an action type — without it the shadow-then-graduate plan has
 * no way to finish.
 *
 * Three things, in the order a reviewer needs them:
 *   1. Where each action type stands against the gate, and what is missing.
 *   2. The queue: what the agent proposed, the numbers behind it, agree/disagree.
 *   3. What each enrolled profile is optimising for.
 *
 * Every decision shows the inputs it was made from, deliberately. A reviewer
 * has to be able to check the agent's arithmetic without going back to Amazon,
 * or the verdicts are just impressions and the gate measures nothing.
 */

import React, { useCallback, useEffect, useState } from 'react';

import {
  getAgentDecisionsApi, getAgentGraduationApi, getAgentObjectivesApi,
  getAgentRunsApi, getStoredProfilesApi, recordAgentVerdictApi, saveAgentObjectiveApi,
} from '../services/api.js';
import { useIsMobile } from '../hooks/useIsMobile.js';

const ACTION_LABEL = {
  ADD_NEGATIVE: 'Add negative',
  ADD_EXACT:    'Add exact keyword',
};

const REASON_LABEL = {
  NO_CONVERSION:      'Clicks, no sales',
  WASTED_SPEND:       'Spend past target CPA',
  CONVERTS_AT_TARGET: 'Converts at target',
};

const money   = (n) => (n === null || n === undefined ? '—' : `$${Number(n).toFixed(2)}`);
const pct     = (n) => (n === null || n === undefined ? '—' : `${Number(n).toFixed(1)}%`);
const whole   = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString());

function Card({ children, style }) {
  return (
    <div style={{
      background: 'var(--bg-panel)', border: '1px solid var(--border-strong)',
      borderRadius: 12, padding: 16, ...style,
    }}>{children}</div>
  );
}

function Pill({ tone = 'neutral', children }) {
  const tones = {
    neutral: { bg: 'var(--overlay-4)',            fg: 'var(--text-subtle)',  bd: 'var(--overlay-7)' },
    good:    { bg: 'rgba(16,185,129,0.10)',       fg: 'var(--success-2)',    bd: 'rgba(16,185,129,0.28)' },
    warn:    { bg: 'rgba(251,146,60,0.10)',       fg: 'var(--acc-amber)',    bd: 'rgba(251,146,60,0.28)' },
    bad:     { bg: 'rgba(244,63,94,0.08)',        fg: 'var(--danger)',       bd: 'rgba(244,63,94,0.30)' },
  }[tone];
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', padding: '2px 8px',
      borderRadius: 99, background: tones.bg, color: tones.fg, border: `1px solid ${tones.bd}`,
      whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

/** Where an action type stands against the gate, and what it still needs. */
function GraduationCard({ actionType, status }) {
  const rate = status.rate === null ? null : status.rate * 100;
  return (
    <Card style={{ flex: 1, minWidth: 240 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{ACTION_LABEL[actionType] ?? actionType}</span>
        {status.eligible
          ? <Pill tone="good">ELIGIBLE FOR LIVE</Pill>
          : <Pill tone="neutral">SHADOW</Pill>}
      </div>

      <div style={{ display: 'flex', gap: 18, marginBottom: 10 }}>
        <div>
          <p style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{rate === null ? '—' : `${rate.toFixed(1)}%`}</p>
          <p style={{ margin: 0, fontSize: 10, color: 'var(--text-faint)' }}>AGREEMENT</p>
        </div>
        <div>
          <p style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{status.reviewed}</p>
          <p style={{ margin: 0, fontSize: 10, color: 'var(--text-faint)' }}>REVIEWED</p>
        </div>
      </div>

      {/* "Not yet" is far less useful than a number. */}
      {status.shortfall?.length > 0 && (
        <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>
          Needs {status.shortfall.join(', and ')}.
        </p>
      )}
      {status.eligible && (
        <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>
          Cleared the bar. Switching to live is still a deliberate step below.
        </p>
      )}
    </Card>
  );
}

/** One proposal, with the numbers it was made from. */
function DecisionRow({ decision, onVerdict, busy, isMobile }) {
  const i = decision.inputs ?? {};
  const verdict = decision.humanVerdict;

  return (
    <div style={{
      border: '1px solid var(--overlay-5)', borderRadius: 10, padding: 12,
      background: verdict ? 'var(--overlay-2)' : 'var(--overlay-3)',
      opacity: verdict ? 0.72 : 1,
    }}>
      <div style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8,
      }}>
        <Pill tone={decision.actionType === 'ADD_NEGATIVE' ? 'bad' : 'good'}>
          {ACTION_LABEL[decision.actionType] ?? decision.actionType}
        </Pill>
        <span style={{ fontWeight: 700, fontSize: 14, wordBreak: 'break-word' }}>{decision.searchTerm}</span>
        {decision.bid ? <Pill tone="neutral">bid {money(decision.bid)}</Pill> : null}
        {decision.status !== 'PROPOSED' && <Pill tone="neutral">{decision.status}</Pill>}
      </div>

      <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-muted)' }}>
        {REASON_LABEL[decision.reason] ?? decision.reason}
        {decision.detail ? ` — ${decision.detail}` : ''}
      </p>

      {/* The agent's arithmetic, so a verdict is a judgement and not an impression. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(6, auto)',
        gap: 10, fontSize: 11, marginBottom: decision.llmRationale ? 8 : 10,
      }}>
        {[['Clicks', whole(i.clicks)], ['Spend', money(i.cost)], ['Sales', money(i.sales)],
          ['Orders', whole(i.purchases)], ['ACoS', pct(i.acos)], ['CPC', money(i.cpc)]].map(([k, v]) => (
          <div key={k}>
            <p style={{ margin: 0, color: 'var(--text-faint)', fontSize: 9, letterSpacing: '0.06em' }}>{k.toUpperCase()}</p>
            <p style={{ margin: 0, fontWeight: 700 }}>{v}</p>
          </div>
        ))}
      </div>

      {decision.llmRationale && (
        <p style={{
          margin: '0 0 10px', fontSize: 12, color: 'var(--text-subtle)', fontStyle: 'italic',
          borderLeft: '2px solid var(--overlay-7)', paddingLeft: 8,
        }}>{decision.llmRationale}</p>
      )}

      {verdict ? (
        <Pill tone={verdict === 'AGREE' ? 'good' : 'warn'}>
          {verdict === 'AGREE' ? 'You agreed' : 'You disagreed'}
        </Pill>
      ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => onVerdict(decision.id, 'AGREE')}
            disabled={busy}
            style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer',
              border: '1px solid rgba(16,185,129,0.30)', background: 'rgba(16,185,129,0.10)', color: 'var(--success-2)',
            }}
          >Agree</button>
          <button
            onClick={() => onVerdict(decision.id, 'DISAGREE')}
            disabled={busy}
            style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer',
              border: '1px solid rgba(244,63,94,0.30)', background: 'rgba(244,63,94,0.08)', color: 'var(--danger)',
            }}
          >Disagree</button>
        </div>
      )}
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '7px 10px', borderRadius: 8, fontSize: 12,
  background: 'var(--overlay-3)', color: 'var(--text)',
  border: '1px solid var(--overlay-7)', boxSizing: 'border-box',
};

function Field({ label, hint, children }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{
        display: 'block', fontSize: 9, letterSpacing: '0.06em', marginBottom: 4,
        color: 'var(--text-faint)', fontWeight: 700,
      }}>{label.toUpperCase()}</span>
      {children}
      {hint && <span style={{ display: 'block', marginTop: 3, fontSize: 10, color: 'var(--text-faint)' }}>{hint}</span>}
    </label>
  );
}

/** Which graduation entry backs each mode field. */
const MODE_ACTION = { negativeMode: 'ADD_NEGATIVE', promotionMode: 'ADD_EXACT' };

/**
 * Enrol a profile, or change the terms of one already enrolled.
 *
 * The front door the panel was missing. The daily sweep only picks up profiles
 * with an enabled ProfileObjective (services/agent/agent-scheduler.js), so with
 * no way to create one the entire surface sits at zero forever — which is
 * exactly what it did.
 *
 * Modes are edited here, LIVE included, because the graduation gate is advisory
 * by design: it reports whether an action type has cleared the bar and a person
 * decides (services/agent/graduation.js). So the form puts that verdict next to
 * the choice instead of enforcing it, and says what LIVE means before it is
 * picked rather than after.
 */
function ObjectiveForm({ existing, available, graduation, onSave, onCancel, busy, isMobile }) {
  const isNew = !existing;

  const [form, setForm] = useState(() => ({
    profileId:             existing?.profileId ?? available[0]?.profileId ?? '',
    targetAcos:            String(existing?.targetAcos ?? 30),
    minClicks:             existing?.minClicks == null ? '' : String(existing.minClicks),
    minPurchasesToPromote: String(existing?.minPurchasesToPromote ?? 2),
    wasteMultiplier:       String(existing?.wasteMultiplier ?? 2),
    brandTerms:            (existing?.brandTerms ?? []).join(', '),
    negativeMode:          existing?.negativeMode ?? 'SHADOW',
    promotionMode:         existing?.promotionMode ?? 'SHADOW',
    // Enrolling a profile and leaving it switched off is almost never the
    // intent, but it stays visible and reversible.
    enabled:               existing?.enabled ?? true,
  }));

  const set = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  /* Modes set to LIVE whose action type has not cleared the gate. */
  const ungraduated = Object.entries(MODE_ACTION)
    .filter(([field, action]) => form[field] === 'LIVE' && !graduation?.[action]?.eligible)
    .map(([, action]) => ACTION_LABEL[action] ?? action);

  function submit(e) {
    e.preventDefault();
    if (!form.profileId) return;
    onSave(form.profileId, {
      targetAcos:            Number(form.targetAcos),
      /* Blank is not zero. An empty box means null, which is what tells the
         policy to calibrate the click threshold from the account's own
         conversion rate instead of taking a fixed guess. */
      minClicks:             form.minClicks.trim() === '' ? null : Number(form.minClicks),
      minPurchasesToPromote: Number(form.minPurchasesToPromote),
      wasteMultiplier:       Number(form.wasteMultiplier),
      brandTerms:            form.brandTerms.split(',').map((t) => t.trim()).filter(Boolean),
      negativeMode:          form.negativeMode,
      promotionMode:         form.promotionMode,
      enabled:               form.enabled,
    });
  }

  if (isNew && available.length === 0) {
    return (
      <div style={{ borderTop: '1px solid var(--overlay-4)', paddingTop: 12, marginTop: 12 }}>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
          Every synced profile is already enrolled. Sync a profile on the Profiles page to enrol another.
        </p>
        <button type="button" onClick={onCancel} style={{
          marginTop: 10, padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
          cursor: 'pointer', border: '1px solid var(--overlay-7)', background: 'var(--overlay-3)',
          color: 'var(--text-subtle)',
        }}>Close</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{
      borderTop: '1px solid var(--overlay-4)', paddingTop: 12, marginTop: 12,
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div style={{
        display: 'grid', gap: 12,
        gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
      }}>
        <Field label="Profile">
          {isNew ? (
            <select value={form.profileId} onChange={set('profileId')} style={inputStyle}>
              {available.map((p) => (
                <option key={p.profileId} value={p.profileId}>
                  {[p.profileName || p.accountName, p.countryCode, p.profileId]
                    .filter(Boolean).join(' — ')}
                </option>
              ))}
            </select>
          ) : (
            <input value={form.profileId} disabled style={{ ...inputStyle, opacity: 0.6 }} />
          )}
        </Field>

        <Field label="Target ACoS" hint="1–300 percent">
          <input type="number" min="1" max="300" step="0.5"
                 value={form.targetAcos} onChange={set('targetAcos')} style={inputStyle} />
        </Field>

        <Field label="Min clicks" hint="Blank calibrates from the account's conversion rate">
          <input type="number" min="1" max="500" placeholder="auto"
                 value={form.minClicks} onChange={set('minClicks')} style={inputStyle} />
        </Field>

        <Field label="Orders to promote" hint="1–50">
          <input type="number" min="1" max="50"
                 value={form.minPurchasesToPromote} onChange={set('minPurchasesToPromote')} style={inputStyle} />
        </Field>

        <Field label="Waste multiplier" hint="Spend past this many times target CPA is waste">
          <input type="number" min="0.1" max="20" step="0.1"
                 value={form.wasteMultiplier} onChange={set('wasteMultiplier')} style={inputStyle} />
        </Field>

        <Field label="Brand terms" hint="Comma separated; never negated">
          <input value={form.brandTerms} onChange={set('brandTerms')}
                 placeholder="my brand, mybrand" style={inputStyle} />
        </Field>

        <Field label="Negatives" hint="LIVE applies them to Amazon">
          <select value={form.negativeMode} onChange={set('negativeMode')} style={inputStyle}>
            <option value="SHADOW">SHADOW — propose only</option>
            <option value="LIVE">LIVE — apply automatically</option>
          </select>
        </Field>

        <Field label="Promotions" hint="LIVE starts real spend on new keywords">
          <select value={form.promotionMode} onChange={set('promotionMode')} style={inputStyle}>
            <option value="SHADOW">SHADOW — propose only</option>
            <option value="LIVE">LIVE — apply automatically</option>
          </select>
        </Field>

        <Field label="Enrolled">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, paddingTop: 6 }}>
            <input type="checkbox" checked={form.enabled} onChange={set('enabled')} />
            <span style={{ color: 'var(--text-subtle)' }}>
              {form.enabled ? 'The daily sweep includes this profile' : 'Off — the sweep skips it'}
            </span>
          </label>
        </Field>
      </div>

      {ungraduated.length > 0 && (
        <p style={{
          margin: 0, fontSize: 11, color: 'var(--acc-amber)',
          background: 'rgba(251,146,60,0.08)', border: '1px solid rgba(251,146,60,0.28)',
          borderRadius: 8, padding: '8px 10px',
        }}>
          {ungraduated.join(' and ')} {ungraduated.length > 1 ? 'have' : 'has'} not cleared the
          agreement gate yet. Going live is allowed — the gate is advice, not a lock — but the agent
          will change a real account without anyone reviewing it first.
        </p>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={busy || !form.profileId} style={{
          padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700,
          cursor: busy ? 'wait' : 'pointer',
          border: '1px solid rgba(167,139,250,0.35)', background: 'rgba(167,139,250,0.14)',
          color: 'var(--accent-soft)',
        }}>{busy ? 'Saving…' : isNew ? 'Enrol profile' : 'Save changes'}</button>
        <button type="button" onClick={onCancel} disabled={busy} style={{
          padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
          border: '1px solid var(--overlay-7)', background: 'var(--overlay-3)', color: 'var(--text-subtle)',
        }}>Cancel</button>
      </div>
    </form>
  );
}

export default function AgentPanel({ isAdmin = false }) {
  const isMobile = useIsMobile();

  const [graduation, setGraduation] = useState(null);
  const [decisions, setDecisions]   = useState([]);
  const [objectives, setObjectives] = useState([]);
  const [runs, setRuns]             = useState([]);
  const [filter, setFilter]         = useState('unreviewed');
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [busyId, setBusyId]         = useState(null);
  const [profiles, setProfiles]     = useState([]);
  /** profileId being edited, '__new__' for the enrol form, or null for neither. */
  const [editing, setEditing]       = useState(null);
  const [savingObjective, setSavingObjective] = useState(false);

  const load = useCallback(async (verdict) => {
    setLoading(true);
    setError(null);
    try {
      const [g, d, o, r, p] = await Promise.all([
        getAgentGraduationApi(),
        getAgentDecisionsApi({ verdict, limit: 100 }),
        getAgentObjectivesApi(),
        getAgentRunsApi({ limit: 5 }),
        // Uncached: a profile synced a minute ago should be enrollable now, and
        // getProfiles() holds its list for 24 hours.
        getStoredProfilesApi().catch(() => []),
      ]);
      setGraduation(g.graduation);
      setDecisions(d.decisions ?? []);
      setObjectives(o.objectives ?? []);
      setRuns(r.runs ?? []);
      setProfiles(Array.isArray(p) ? p : p?.profiles ?? []);
    } catch (err) {
      // Surfaced rather than swallowed: an empty queue and a failed request look
      // identical otherwise, and one of them means the agent is not running.
      setError(err?.response?.data?.error ?? err.message ?? 'Could not load agent data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(filter); }, [load, filter]);

  async function handleVerdict(id, verdict) {
    setBusyId(id);
    try {
      await recordAgentVerdictApi(id, verdict);
      // Reflect it locally rather than refetching the list, so the queue does
      // not jump under the reviewer's cursor mid-pass.
      setDecisions((prev) => prev.map((d) => (d.id === id ? { ...d, humanVerdict: verdict } : d)));
      getAgentGraduationApi().then((g) => setGraduation(g.graduation)).catch(() => {});
    } catch (err) {
      setError(err?.response?.data?.error ?? 'Could not record that verdict');
    } finally {
      setBusyId(null);
    }
  }

  async function handleSaveObjective(profileId, patch) {
    setSavingObjective(true);
    setError(null);
    try {
      const { objective } = await saveAgentObjectiveApi(profileId, patch);
      // Upsert in place: the server is the authority on what was stored, and
      // re-reading the whole panel to move one row is a lot of work for nothing.
      setObjectives((prev) => {
        const i = prev.findIndex((o) => o.profileId === profileId);
        if (i === -1) return [...prev, objective];
        const next = [...prev];
        next[i] = objective;
        return next;
      });
      setEditing(null);
    } catch (err) {
      setError(err?.response?.data?.error ?? 'Could not save that objective');
    } finally {
      setSavingObjective(false);
    }
  }

  const lastRun = runs[0];
  const enrolledIds = new Set(objectives.map((o) => o.profileId));
  const available = profiles.filter((p) => !enrolledIds.has(p.profileId));

  return (
    <div style={{ padding: isMobile ? 14 : 24, maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ fontSize: isMobile ? 20 : 24, fontWeight: 800, margin: '0 0 4px' }}>Account Manager Agent</h1>
      <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--text-muted)' }}>
        The agent proposes search-term actions daily. In shadow mode nothing is applied — your
        agreement is what earns an action type the right to act on its own.
      </p>

      {error && (
        <Card style={{ marginBottom: 16, borderColor: 'rgba(244,63,94,0.35)', background: 'rgba(244,63,94,0.06)' }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>{error}</p>
        </Card>
      )}

      {/* ── The gate ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        {graduation
          ? Object.entries(graduation).map(([actionType, status]) => (
              <GraduationCard key={actionType} actionType={actionType} status={status} />
            ))
          : <Card style={{ flex: 1 }}><p style={{ margin: 0, fontSize: 13, color: 'var(--text-faint)' }}>
              {loading ? 'Loading…' : 'No graduation data yet.'}
            </p></Card>}
      </div>

      {/* ── Enrolled profiles ── */}
      <Card style={{ marginBottom: 20 }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 8, marginBottom: 10,
        }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', color: 'var(--text-faint)' }}>
            ENROLLED PROFILES
          </p>
          {isAdmin && editing === null && (
            <button
              onClick={() => setEditing('__new__')}
              style={{
                padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                border: '1px solid rgba(167,139,250,0.35)', background: 'rgba(167,139,250,0.14)',
                color: 'var(--accent-soft)',
              }}
            >Enrol a profile</button>
          )}
        </div>
        {objectives.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
            No profile is enrolled. The agent does nothing until one is — connecting Amazon does not
            enrol a profile by itself.
            {!isAdmin && ' Enrolling one is an admin action.'}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {objectives.map((o) => (
              <div key={o.id} style={{
                display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10,
                fontSize: 12, padding: '8px 0', borderTop: '1px solid var(--overlay-4)',
              }}>
                <span style={{ fontWeight: 700 }}>{o.profileId}</span>
                <Pill tone={o.enabled ? 'good' : 'neutral'}>{o.enabled ? 'ENABLED' : 'OFF'}</Pill>
                <Pill tone={o.negativeMode === 'LIVE' ? 'warn' : 'neutral'}>negatives {o.negativeMode}</Pill>
                <Pill tone={o.promotionMode === 'LIVE' ? 'warn' : 'neutral'}>promotions {o.promotionMode}</Pill>
                <span style={{ color: 'var(--text-muted)' }}>target ACoS {o.targetAcos}%</span>
                <span style={{ color: 'var(--text-muted)' }}>
                  min clicks {o.minClicks ?? 'auto'}
                </span>
                {o.brandTerms?.length > 0 && (
                  <span style={{ color: 'var(--text-faint)' }}>brand: {o.brandTerms.join(', ')}</span>
                )}
                {isAdmin && editing !== o.profileId && (
                  <button
                    onClick={() => setEditing(o.profileId)}
                    style={{
                      marginLeft: 'auto', padding: '3px 10px', borderRadius: 8, fontSize: 11,
                      fontWeight: 700, cursor: 'pointer', border: '1px solid var(--overlay-7)',
                      background: 'var(--overlay-3)', color: 'var(--text-subtle)',
                    }}
                  >Edit</button>
                )}
              </div>
            ))}
          </div>
        )}
        {isAdmin && editing !== null && (
          <ObjectiveForm
            key={editing}
            existing={editing === '__new__' ? null : objectives.find((o) => o.profileId === editing)}
            available={available}
            graduation={graduation}
            onSave={handleSaveObjective}
            onCancel={() => setEditing(null)}
            busy={savingObjective}
            isMobile={isMobile}
          />
        )}

        {lastRun && (
          <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--text-faint)' }}>
            Last run {new Date(lastRun.startedAt).toLocaleString()} — {lastRun.status}
            {lastRun.abortReason ? ` (${lastRun.abortReason})` : ''}, {lastRun.candidates} proposed,
            {' '}{lastRun.applied} applied.
          </p>
        )}
      </Card>

      {/* ── The queue ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <p style={{ margin: 0, fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', color: 'var(--text-faint)' }}>
          DECISIONS
        </p>
        {[['unreviewed', 'To review'], ['AGREE', 'Agreed'], ['DISAGREE', 'Disagreed'], ['', 'All']].map(([value, label]) => (
          <button
            key={label}
            onClick={() => setFilter(value)}
            style={{
              padding: '4px 12px', borderRadius: 99, fontSize: 11, fontWeight: 700, cursor: 'pointer',
              border: `1px solid ${filter === value ? 'var(--accent)' : 'var(--overlay-7)'}`,
              background: filter === value ? 'rgba(167,139,250,0.14)' : 'var(--overlay-3)',
              color: filter === value ? 'var(--accent-soft)' : 'var(--text-subtle)',
            }}
          >{label}</button>
        ))}
      </div>

      {loading ? (
        <Card><p style={{ margin: 0, fontSize: 13, color: 'var(--text-faint)' }}>Loading decisions…</p></Card>
      ) : decisions.length === 0 ? (
        <Card>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
            {filter === 'unreviewed'
              ? 'Nothing waiting. Either every decision has been reviewed, or the agent has not run yet.'
              : 'No decisions match this filter.'}
          </p>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {decisions.map((d) => (
            <DecisionRow
              key={d.id} decision={d} isMobile={isMobile}
              busy={busyId === d.id} onVerdict={handleVerdict}
            />
          ))}
        </div>
      )}
    </div>
  );
}
