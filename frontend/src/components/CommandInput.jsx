import React, { useState } from 'react';

const EXAMPLES = [
  'Show all active campaigns',
  'Which campaigns have the highest budget?',
  'List paused Sponsored Products campaigns',
  'How many use auto targeting?',
  'Which search terms should I add as negative keywords?',
  'Show me top performing search terms to scale up',
];

export default function CommandInput({ onSubmit, isLoading }) {
  const [command, setCommand] = useState('');

  const submit = (cmd) => { if (cmd?.trim()) { onSubmit(cmd.trim()); setCommand(''); } };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Example chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {EXAMPLES.map(ex => (
          <button key={ex} onClick={() => setCommand(ex)}
            style={{ fontSize:11, padding:'4px 10px', borderRadius:999, cursor:'pointer', transition:'all .15s',
                     background:'var(--bg-panel-2)', border:'1px solid var(--border-strong)', color:'var(--text-muted)' }}
            onMouseEnter={e => { e.currentTarget.style.color='var(--text-primary)'; e.currentTarget.style.borderColor='var(--info-strong)'; }}
            onMouseLeave={e => { e.currentTarget.style.color='var(--text-muted)'; e.currentTarget.style.borderColor='var(--text-faint)'; }}>
            {ex}
          </button>
        ))}
      </div>

      {/* Input row */}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={command}
          onChange={e => setCommand(e.target.value)}
          onKeyDown={e => (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) && submit(command)}
          placeholder="e.g., Show campaigns with ACoS > 25%"
          style={{ flex:1, background:'var(--bg-panel-2)', border:'1px solid var(--border-strong)', color:'var(--text-primary)',
                   borderRadius:8, padding:'10px 14px', fontSize:13, outline:'none' }}
          onFocus={e => e.target.style.borderColor='var(--info-strong)'}
          onBlur={e => e.target.style.borderColor='var(--text-faint)'}
        />
        <button
          onClick={() => submit(command)}
          disabled={isLoading || !command.trim()}
          style={{ padding:'10px 20px', borderRadius:8, border:'none', cursor: isLoading||!command.trim() ? 'not-allowed':'pointer',
                   background: 'linear-gradient(135deg,var(--info-strong),var(--accent-strong))', color:'#fff', fontWeight:600, fontSize:13,
                   opacity: isLoading||!command.trim() ? 0.45 : 1, display:'flex', alignItems:'center', gap:6, whiteSpace:'nowrap',
                   transition:'opacity .15s' }}
        >
          {isLoading ? (
            <>
              <svg style={{ width:16,height:16,animation:'spin 1s linear infinite' }} fill="none" viewBox="0 0 24 24">
                <circle style={{ opacity:.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path style={{ opacity:.75 }} fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              Analysing…
            </>
          ) : (
            <>
              <svg style={{ width:15,height:15 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z"/>
              </svg>
              Ask AI
            </>
          )}
        </button>
      </div>
    </div>
  );
}
