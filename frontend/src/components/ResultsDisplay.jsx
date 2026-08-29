import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function ResultsDisplay({ result }) {
  const [copied, setCopied] = useState(false);

  if (!result) return null;

  const copy = () =>
    navigator.clipboard.writeText(result.summary).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });

  return (
    <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #8B5CF640', animation: 'fadeIn .3s ease-out both' }}>
      <style>{`
        @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes spin    { to{transform:rotate(360deg)} }

        /* ── table ── */
        .ai-body table        { width:100%; border-collapse:collapse; margin:14px 0; border-radius:8px; overflow:hidden; }
        .ai-body thead tr     { background:#1a2a3f; }
        .ai-body th           { padding:9px 14px; text-align:left; font-size:11px; font-weight:700;
                                text-transform:uppercase; letter-spacing:.07em; color:var(--text-muted);
                                border-bottom:2px solid var(--border-strong); white-space:nowrap; }
        .ai-body td           { padding:10px 14px; font-size:13px; color:var(--text-strong); border-bottom:1px solid var(--text-faint); white-space:nowrap; }
        .ai-body tbody tr:last-child td { border-bottom:none; }
        .ai-body tbody tr:hover td      { background:var(--bg-panel-2); }
        .ai-body tbody tr:nth-child(even) td { background:var(--bg-panel-3); }
        .ai-body tbody tr:nth-child(even):hover td { background:var(--bg-panel-2); }

        /* ── text ── */
        .ai-body p            { margin:0 0 10px; line-height:1.7; }
        .ai-body p:last-child { margin:0; }
        .ai-body ul, .ai-body ol { padding-left:20px; margin:0 0 12px; }
        .ai-body li           { margin:5px 0; color:var(--text-muted); line-height:1.6; }
        .ai-body strong       { color:var(--warning); font-weight:700; }
        .ai-body em           { color:var(--text-muted); font-style:italic; }
        .ai-body code         { background:var(--bg-panel-3); color:#38BDF8; padding:2px 7px; border-radius:4px; font-size:11.5px; font-family:monospace; }
        .ai-body h1,.ai-body h2,.ai-body h3 { color:var(--text-primary); margin:16px 0 8px; line-height:1.3; }
        .ai-body h1 { font-size:18px; } .ai-body h2 { font-size:15px; } .ai-body h3 { font-size:13px; }
        .ai-body blockquote   { border-left:3px solid var(--accent-strong); margin:0 0 12px; padding:4px 14px; background:#8B5CF610; border-radius:0 6px 6px 0; color:var(--text-muted); }
        .ai-body hr           { border:none; border-top:1px solid var(--border-strong); margin:14px 0; }
      `}</style>

      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px',
        background: 'linear-gradient(90deg,#8B5CF614,#3B82F614)',
        borderBottom: '1px solid var(--border-strong)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 24, height: 24, borderRadius: 6, background: 'linear-gradient(135deg,var(--accent-strong),var(--info-strong))', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg style={{ width: 13, height: 13, color: '#fff' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
            </svg>
          </div>
          <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>AI Analysis</span>
          <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>· {result.model === 'claude' ? 'Claude Sonnet' : 'Gemini 2.5 Flash'}</span>
        </div>
        <button onClick={copy} style={{
          display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 10px',
          borderRadius: 6, cursor: 'pointer', background: 'transparent',
          border: `1px solid ${copied ? 'var(--success)' : 'var(--border-strong)'}`,
          color: copied ? 'var(--success)' : 'var(--text-muted)', transition: 'all .15s',
        }}>
          {copied
            ? <><svg style={{ width: 12, height: 12 }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>Copied</>
            : <><svg style={{ width: 12, height: 12 }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>Copy</>}
        </button>
      </div>

      {/* ── Body ── */}
      <div className="ai-body" style={{ padding: '16px 18px', background: 'var(--bg-panel)', fontSize: 13, color: 'var(--text-strong)', lineHeight: 1.65 }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.summary}</ReactMarkdown>
      </div>
    </div>
  );
}
