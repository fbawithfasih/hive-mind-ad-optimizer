import { useState } from 'react';

const BTN = {
  base: {
    padding: '6px 14px', borderRadius: 7, border: 'none',
    fontWeight: 700, fontSize: 12, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 5,
    transition: 'opacity 0.15s',
  },
  green:  { background: 'linear-gradient(135deg,#10B981,#059669)', color: '#fff', boxShadow: '0 2px 8px rgba(16,185,129,0.35)' },
  amber:  { background: 'linear-gradient(135deg,#F59E0B,#D97706)', color: '#fff', boxShadow: '0 2px 8px rgba(245,158,11,0.35)' },
  blue:   { background: 'linear-gradient(135deg,#3B82F6,#2563EB)', color: '#fff', boxShadow: '0 2px 8px rgba(59,130,246,0.35)' },
  ghost:  { background: 'rgba(255,255,255,0.06)', color: '#94A3B8', border: '1px solid rgba(255,255,255,0.08)' },
  danger: { background: 'rgba(244,63,94,0.12)',   color: '#F43F5E', border: '1px solid rgba(244,63,94,0.25)' },
};

function Btn({ variant = 'ghost', disabled, onClick, children, style }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ ...BTN.base, ...BTN[variant], opacity: disabled ? 0.45 : 1, cursor: disabled ? 'not-allowed' : 'pointer', ...style }}
    >
      {children}
    </button>
  );
}

export default function BulkActionBar({ count, campaigns, selectedIds, onAction, onClearSelection, isExecuting, lastResult }) {
  const [budgetOpen,  setBudgetOpen]  = useState(false);
  const [budgetMode,  setBudgetMode]  = useState('fixed'); // 'fixed' | 'pct'
  const [budgetValue, setBudgetValue] = useState('');

  if (count === 0) return null;

  function handleBudgetApply() {
    const val = parseFloat(budgetValue);
    if (!budgetValue || isNaN(val)) return;

    if (budgetMode === 'fixed') {
      onAction('set-budget', val);
    } else {
      const currentBudgets = {};
      for (const c of campaigns) {
        if (selectedIds.has(c.id ?? c.campaignId)) {
          currentBudgets[c.id ?? c.campaignId] = c.budget ?? 10;
        }
      }
      onAction('adjust-budget', val, currentBudgets);
    }
    setBudgetValue('');
    setBudgetOpen(false);
  }

  return (
    <div style={{
      margin: '0 0 12px',
      padding: '10px 16px',
      borderRadius: 12,
      background: 'rgba(10,14,30,0.95)',
      border: '1px solid rgba(59,130,246,0.35)',
      backdropFilter: 'blur(12px)',
      boxShadow: '0 4px 24px rgba(59,130,246,0.15)',
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
    }}>
      {/* Selection count */}
      <span style={{ fontSize: 12, fontWeight: 700, color: '#93C5FD', whiteSpace: 'nowrap' }}>
        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ display:'inline',verticalAlign:'-2px',marginRight:5 }}>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        {count} campaign{count !== 1 ? 's' : ''} selected
      </span>

      <span style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', display:'inline-block' }} />

      {/* Status actions */}
      <Btn variant="green" disabled={isExecuting} onClick={() => onAction('enable')}>
        <svg width="11" height="11" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        Enable
      </Btn>
      <Btn variant="amber" disabled={isExecuting} onClick={() => onAction('pause')}>
        <svg width="11" height="11" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
        Pause
      </Btn>

      <span style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', display:'inline-block' }} />

      {/* Budget action */}
      <div style={{ position: 'relative' }}>
        <Btn variant="blue" disabled={isExecuting} onClick={() => setBudgetOpen(o => !o)}>
          <svg width="11" height="11" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          Set Budget
          <svg width="10" height="10" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ opacity:.7 }}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7"/></svg>
        </Btn>

        {budgetOpen && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 100,
            background: '#0F172A', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 10, padding: 14, minWidth: 230,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }}>
            {/* Mode toggle */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {[['fixed','Fixed $'],['pct','Adjust %']].map(([m,label]) => (
                <button key={m} onClick={() => { setBudgetMode(m); setBudgetValue(''); }}
                  style={{
                    flex: 1, padding: '5px 0', borderRadius: 6, border: 'none', fontSize: 11,
                    fontWeight: 700, cursor: 'pointer',
                    background: budgetMode === m ? 'rgba(59,130,246,0.25)' : 'rgba(255,255,255,0.05)',
                    color: budgetMode === m ? '#93C5FD' : '#64748B',
                  }}>
                  {label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: '#64748B', fontWeight: 700 }}>
                {budgetMode === 'fixed' ? '$' : '±'}
              </span>
              <input
                type="number"
                autoFocus
                placeholder={budgetMode === 'fixed' ? '50.00' : '10'}
                value={budgetValue}
                onChange={e => setBudgetValue(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleBudgetApply()}
                style={{
                  flex: 1, padding: '6px 10px', borderRadius: 6,
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                  color: '#F1F5F9', fontSize: 13, outline: 'none',
                }}
              />
              <span style={{ fontSize: 11, color: '#475569' }}>
                {budgetMode === 'pct' ? '%' : '/day'}
              </span>
            </div>

            {budgetMode === 'pct' && budgetValue && (
              <p style={{ margin: '6px 0 0', fontSize: 10, color: '#64748B' }}>
                {parseFloat(budgetValue) > 0 ? '▲' : '▼'} Increases/decreases each campaign's budget by {Math.abs(parseFloat(budgetValue) || 0)}%
              </p>
            )}

            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <button onClick={handleBudgetApply} disabled={!budgetValue || isNaN(parseFloat(budgetValue))}
                style={{ ...BTN.base, ...BTN.blue, flex: 1, justifyContent: 'center', opacity: !budgetValue ? 0.45 : 1 }}>
                Apply to {count} campaign{count !== 1 ? 's' : ''}
              </button>
              <button onClick={() => setBudgetOpen(false)}
                style={{ ...BTN.base, ...BTN.ghost }}>
                ✕
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Inline result feedback */}
      {lastResult && (
        <span style={{
          fontSize: 11, fontWeight: 600,
          color: lastResult.failed?.length ? '#F59E0B' : '#10B981',
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          {lastResult.failed?.length
            ? `✓ ${lastResult.succeeded} updated · ${lastResult.failed.length} failed`
            : `✓ ${lastResult.succeeded} updated`}
        </span>
      )}

      {isExecuting && (
        <span style={{ fontSize: 11, color: '#64748B', display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg style={{ width: 12, height: 12, animation: 'spin 1s linear infinite' }} fill="none" viewBox="0 0 24 24">
            <circle style={{ opacity: .25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path style={{ opacity: .75 }} fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          Updating…
        </span>
      )}

      {/* Clear */}
      <Btn variant="ghost" onClick={onClearSelection}>
        Clear selection
      </Btn>
    </div>
  );
}
