import { useEffect, useRef, useState } from 'react';
import { optimizeMainImage } from '../services/api.js';

const FIELD_DEFS = [
  { name: 'productName',    label: 'Product Name',     placeholder: 'e.g. Stainless Steel Pour-Over Coffee Maker', required: true },
  { name: 'category',       label: 'Category',         placeholder: 'e.g. Kitchen / Coffee & Tea' },
  { name: 'material',       label: 'Material(s)',      placeholder: 'e.g. 304 stainless steel, borosilicate glass' },
  { name: 'endUse',         label: 'End Use / Function', placeholder: 'e.g. Brews 1–4 cups of pour-over coffee' },
  { name: 'targetAudience', label: 'Target Audience',  placeholder: 'e.g. Home coffee enthusiasts, premium gifting' },
  { name: 'color',          label: 'Color(s)',         placeholder: 'e.g. Brushed silver with clear glass' },
  { name: 'sizeContext',    label: 'Size Context',     placeholder: 'e.g. Handheld, ~24 cm tall, fits standard cups' },
  { name: 'styleNotes',     label: 'Style Notes',      placeholder: 'Optional — premium, minimalist, rustic, etc.' },
  { name: 'avoid',          label: 'Things to Avoid',  placeholder: 'Optional — no people, no kids, no foreign text', isTextarea: true },
];

const PROGRESS_PHASES = [
  { id: 'prompt',   label: 'Claude is writing the image brief',         range: [0,  35], color: '#8B5CF6', glow: 'rgba(139,92,246,0.35)' },
  { id: 'generate', label: 'Gemini is generating the main image',       range: [35, 92], color: '#3B82F6', glow: 'rgba(59,130,246,0.35)' },
  { id: 'check',    label: 'Checking against Amazon image policy',      range: [92, 99], color: '#10B981', glow: 'rgba(16,185,129,0.35)' },
];

function easedProgress(elapsedMs, targetMs = 45000) {
  const t = Math.min(1, elapsedMs / targetMs);
  return Math.min(99, (1 - Math.pow(1 - t, 3)) * 99);
}

function ProgressBoard({ pct, elapsedSec }) {
  const currentPhase = PROGRESS_PHASES.find(p => pct >= p.range[0] && pct < p.range[1]) ?? PROGRESS_PHASES[PROGRESS_PHASES.length - 1];
  const remaining = Math.max(0, 100 - pct);
  return (
    <div style={{
      position: 'relative', borderRadius: 14, padding: '20px 22px', marginBottom: 18,
      background: 'linear-gradient(135deg, rgba(59,130,246,0.10), rgba(139,92,246,0.10))',
      border: '1px solid rgba(139,92,246,0.25)',
      boxShadow: `0 4px 32px ${currentPhase.glow}`,
      overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg,#8B5CF6,#3B82F6,#10B981)', backgroundSize: '200% 100%', animation: 'iopt-shimmer 3s linear infinite' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12, gap: 12 }}>
        <div>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: '#A78BFA', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Optimizing</p>
          <p style={{ margin: '4px 0 0', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{currentPhase.label}…</p>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-subtle)' }}>elapsed {Math.floor(elapsedSec / 60)}m {Math.round(elapsedSec % 60)}s</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ margin: 0, fontSize: 28, fontWeight: 900, color: currentPhase.color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{Math.round(remaining)}%</p>
          <p style={{ margin: '2px 0 0', fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>remaining</p>
        </div>
      </div>
      <div style={{ height: 8, borderRadius: 99, background: 'rgba(15,23,42,0.6)', border: '1px solid var(--overlay-4)', overflow: 'hidden', position: 'relative' }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: 'linear-gradient(90deg,#8B5CF6,#3B82F6,#10B981)',
          backgroundSize: '200% 100%',
          animation: 'iopt-shimmer 2s linear infinite',
          transition: 'width 240ms cubic-bezier(.4,0,.2,1)',
          boxShadow: `0 0 12px ${currentPhase.glow}`,
        }} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
        {PROGRESS_PHASES.map(p => {
          const done   = pct >= p.range[1];
          const active = pct >= p.range[0] && pct < p.range[1];
          const bg     = done ? `${p.color}25` : active ? `${p.color}30` : 'rgba(15,23,42,0.5)';
          const fg     = done || active ? p.color : 'var(--border-med)';
          const border = done || active ? `${p.color}55` : 'var(--overlay-5)';
          return (
            <span key={p.id} style={{
              fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 99,
              background: bg, color: fg, border: `1px solid ${border}`,
              display: 'inline-flex', alignItems: 'center', gap: 5,
              boxShadow: active ? `0 0 12px ${p.glow}` : 'none',
            }}>
              {done   ? <span>✓</span> : null}
              {active ? <span style={{ width: 6, height: 6, borderRadius: 99, background: p.color, animation: 'iopt-pulse 1.2s ease-in-out infinite' }} /> : null}
              {!done && !active ? <span style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--bg-panel)', border: '1px solid var(--border-strong)' }} /> : null}
              {p.label}
            </span>
          );
        })}
      </div>
      <style>{`
        @keyframes iopt-shimmer { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
        @keyframes iopt-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(1.5); } }
      `}</style>
    </div>
  );
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => {
      const dataUrl = reader.result;
      const comma = String(dataUrl).indexOf(',');
      resolve({ base64: String(dataUrl).slice(comma + 1), mimeType: file.type || 'image/jpeg' });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const inputSt = {
  width: '100%', background: 'var(--bg-app-2)', border: '1px solid var(--border-strong)',
  borderRadius: 8, color: 'var(--text-primary)', padding: '9px 12px', fontSize: 13,
  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
};

export default function ImageOptimizerPanel() {
  const [details, setDetails]               = useState({});
  const [file, setFile]                     = useState(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState(null);
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState(null);
  const [result, setResult]                 = useState(null);
  const [progress, setProgress]             = useState(0);
  const [elapsed, setElapsed]               = useState(0);
  const [provider, setProvider]             = useState('openai');
  const startedAtRef = useRef(0);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!loading) return;
    startedAtRef.current = Date.now();
    setProgress(0); setElapsed(0);
    const interval = setInterval(() => {
      const ms = Date.now() - startedAtRef.current;
      setElapsed(ms / 1000);
      setProgress(easedProgress(ms));
    }, 240);
    return () => clearInterval(interval);
  }, [loading]);

  useEffect(() => {
    if (!file) { setFilePreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setFilePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function handleFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      setError('Please upload an image file (JPG / PNG / WebP).');
      return;
    }
    if (f.size > 9 * 1024 * 1024) {
      setError('Image too large — keep it under 9 MB.');
      return;
    }
    setError(null);
    setFile(f);
  }

  async function handleOptimize() {
    if (!details.productName?.trim()) {
      setError('Product Name is required.');
      return;
    }
    setLoading(true); setError(null); setResult(null);
    try {
      let referenceImageBase64, referenceMimeType;
      if (file) {
        const enc = await fileToBase64(file);
        referenceImageBase64 = enc.base64;
        referenceMimeType    = enc.mimeType;
      }
      const res = await optimizeMainImage({ details, referenceImageBase64, referenceMimeType, provider });
      setProgress(100);
      setResult(res);
    } catch (err) {
      setError(err.response?.data?.error ?? err.message ?? 'Failed to optimize image.');
    } finally {
      setLoading(false);
    }
  }

  function handleDownload() {
    if (!result?.image) return;
    const a = document.createElement('a');
    a.href = `data:${result.image.mimeType};base64,${result.image.imageBase64}`;
    a.download = `${(details.productName || 'main-image').toLowerCase().replace(/\s+/g, '-')}-amazon-main.png`;
    a.click();
  }

  return (
    <div style={{ background: 'var(--bg-panel)', borderRadius: 12, border: '1px solid var(--border-strong)', padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg,#8B5CF6,#3B82F6)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(139,92,246,0.4)' }}>
          <svg width="16" height="16" fill="none" stroke="white" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
          </svg>
        </div>
        <p style={{ margin: 0, fontWeight: 800, fontSize: 15, color: 'var(--text-primary)' }}>Main Image Optimizer</p>
      </div>
      <p style={{ margin: '0 0 18px 42px', fontSize: 12, color: 'var(--text-subtle)' }}>
        Upload your product photo, fill the brief, and get an Amazon-compliant main image — pure white background, single product, no props or text.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 18 }}>
        {/* LEFT — Inputs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Upload */}
          <div
            onClick={() => fileInputRef.current?.click()}
            style={{
              cursor: 'pointer', border: '2px dashed rgba(139,92,246,0.35)',
              borderRadius: 12, padding: filePreviewUrl ? 8 : 28, textAlign: 'center',
              background: 'rgba(139,92,246,0.04)', transition: 'all .15s',
            }}
          >
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
            {filePreviewUrl ? (
              <div style={{ position: 'relative' }}>
                <img src={filePreviewUrl} alt="reference" style={{ maxWidth: '100%', maxHeight: 240, borderRadius: 8, display: 'block', margin: '0 auto' }} />
                <p style={{ margin: '8px 0 0', fontSize: 11, color: '#A78BFA' }}>{file.name} · click to replace</p>
              </div>
            ) : (
              <>
                <svg width="32" height="32" fill="none" stroke="#A78BFA" viewBox="0 0 24 24" style={{ margin: '0 auto 8px', display: 'block' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Upload product image</p>
                <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-subtle)' }}>JPG / PNG / WebP · up to 9 MB</p>
              </>
            )}
          </div>

          {/* Brief fields */}
          {FIELD_DEFS.map(f => (
            <div key={f.name}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>
                {f.label}{f.required && <span style={{ color: '#F43F5E' }}> *</span>}
              </label>
              {f.isTextarea ? (
                <textarea rows={2} placeholder={f.placeholder} style={inputSt}
                  value={details[f.name] ?? ''} onChange={e => setDetails(d => ({ ...d, [f.name]: e.target.value }))} />
              ) : (
                <input type="text" placeholder={f.placeholder} style={inputSt}
                  value={details[f.name] ?? ''} onChange={e => setDetails(d => ({ ...d, [f.name]: e.target.value }))} />
              )}
            </div>
          ))}

          {/* Provider toggle */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
              Image Generation Engine
            </label>
            <div style={{ display: 'flex', gap: 4, background: 'rgba(15,23,42,0.6)', borderRadius: 10, padding: 3, border: '1px solid var(--overlay-5)' }}>
              {[
                { id: 'openai', label: 'OpenAI gpt-image-1', sub: 'Best fidelity', color: '#10B981', glow: 'rgba(16,185,129,0.4)' },
                { id: 'gemini', label: 'Gemini 2.5 Flash',   sub: 'Faster, cheaper', color: '#8B5CF6', glow: 'rgba(139,92,246,0.4)' },
              ].map(({ id, label, sub, color, glow }) => (
                <button key={id} onClick={() => setProvider(id)} style={{
                  flex: 1, padding: '8px 10px', borderRadius: 7, border: 'none', cursor: 'pointer',
                  background: provider === id ? color : 'transparent',
                  color: provider === id ? '#fff' : 'var(--text-muted)',
                  boxShadow: provider === id ? `0 2px 12px ${glow}` : 'none',
                  transition: 'all .15s', textAlign: 'left',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 800 }}>{label}</div>
                  <div style={{ fontSize: 10, opacity: 0.85 }}>{sub}</div>
                </button>
              ))}
            </div>
          </div>

          <button onClick={handleOptimize} disabled={loading}
            style={{
              padding: '12px 22px', borderRadius: 10, border: 'none',
              background: loading ? 'var(--border-strong)' : 'linear-gradient(135deg,#8B5CF6,#3B82F6)',
              color: '#fff', fontWeight: 800, fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1, boxShadow: loading ? 'none' : '0 4px 16px rgba(139,92,246,0.4)',
            }}>
            {loading ? 'Optimizing…' : '✦ Optimize Main Image'}
          </button>
        </div>

        {/* RIGHT — Output */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && (
            <div style={{ background: '#F43F5E18', border: '1px solid #F43F5E44', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#F87171' }}>{error}</div>
          )}

          {loading && <ProgressBoard pct={progress} elapsedSec={elapsed} />}

          {!loading && !result && (
            <div style={{
              border: '1px dashed var(--overlay-7)', borderRadius: 12, padding: '40px 20px',
              textAlign: 'center', color: 'var(--border-med)', fontSize: 13,
            }}>
              Optimized image will appear here.
            </div>
          )}

          {result && !loading && (
            <>
              <div style={{ background: '#fff', borderRadius: 12, padding: 8, border: '1px solid rgba(139,92,246,0.25)', boxShadow: '0 4px 32px rgba(139,92,246,0.15)' }}>
                <img src={`data:${result.image.mimeType};base64,${result.image.imageBase64}`}
                     alt="Optimized main image"
                     style={{ width: '100%', display: 'block', borderRadius: 8 }} />
              </div>
              <button onClick={handleDownload}
                style={{
                  padding: '10px 16px', borderRadius: 9, border: '1px solid var(--overlay-8)',
                  background: 'rgba(139,92,246,0.1)', color: '#A78BFA', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}>
                ⬇ Download
              </button>

              {result.promptSpec?.complianceNotes?.length > 0 && (
                <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 10, padding: '12px 14px' }}>
                  <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 800, color: '#10B981', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Compliance Checklist</p>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    {result.promptSpec.complianceNotes.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
              )}

              <details style={{ background: 'var(--overlay-1)', border: '1px solid var(--overlay-4)', borderRadius: 10, padding: '10px 14px' }}>
                <summary style={{ cursor: 'pointer', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  AI prompt used
                </summary>
                <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                  {result.promptSpec?.prompt}
                </p>
                {result.promptSpec?.negativePrompt && (
                  <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-subtle)' }}>
                    <strong style={{ color: '#F87171' }}>Negative:</strong> {result.promptSpec.negativePrompt}
                  </p>
                )}
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
