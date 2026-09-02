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
  getAgentRunsApi, recordAgentVerdictApi,
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

export default function AgentPanel() {
  const isMobile = useIsMobile();

  const [graduation, setGraduation] = useState(null);
  const [decisions, setDecisions]   = useState([]);
  const [objectives, setObjectives] = useState([]);
  const [runs, setRuns]             = useState([]);
  const [filter, setFilter]         = useState('unreviewed');
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [busyId, setBusyId]         = useState(null);

  const load = useCallback(async (verdict) => {
    setLoading(true);
    setError(null);
    try {
      const [g, d, o, r] = await Promise.all([
        getAgentGraduationApi(),
        getAgentDecisionsApi({ verdict, limit: 100 }),
        getAgentObjectivesApi(),
        getAgentRunsApi({ limit: 5 }),
      ]);
      setGraduation(g.graduation);
      setDecisions(d.decisions ?? []);
      setObjectives(o.objectives ?? []);
      setRuns(r.runs ?? []);
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

  const lastRun = runs[0];

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
        <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', color: 'var(--text-faint)' }}>
          ENROLLED PROFILES
        </p>
        {objectives.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
            No profile is enrolled. The agent does nothing until one is — connecting Amazon does not
            enrol a profile by itself.
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
              </div>
            ))}
          </div>
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
