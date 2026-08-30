import React, { useState, useMemo, useRef } from 'react';
import { lookupProduct, optimizeListingApi, getSearchTermsForProduct, publishListing } from '../services/api.js';
import { parseCsvKeywords, parseXlsxKeywords } from '../utils/file-parsers.js';
import { getTodayISO, getDaysAgoISO } from '../utils/date-helpers.js';

const CHAR_LIMIT = { title: 200, bullet: 250, description: 800, genericKeyword: 250 };

// Generic Keyword counts UTF-8 BYTES on Amazon's side, not characters.
const byteLen = (s) => new TextEncoder().encode(String(s ?? '')).length;

// ── Shared styles ─────────────────────────────────────────────────────────────

const glass = {
  background: 'var(--bg-overlay-hi)',
  border: '1px solid var(--overlay-5)',
  borderRadius: 20,
  backdropFilter: 'blur(16px)',
  position: 'relative',
  overflow: 'hidden',
};

const inputSt = {
  background: 'var(--overlay-3)',
  border: '1px solid var(--overlay-7)',
  color: 'var(--text-primary)',
  borderRadius: 10,
  padding: '9px 13px',
  fontSize: 13,
  outline: 'none',
  transition: 'border-color 0.15s',
};

const taSt = (readOnly) => ({
  width: '100%',
  background: readOnly ? 'var(--overlay-1)' : 'var(--overlay-3)',
  border: `1px solid ${readOnly ? 'var(--overlay-4)' : 'var(--overlay-7)'}`,
  borderRadius: 10, color: readOnly ? 'var(--text-muted)' : 'var(--text-primary)',
  padding: '10px 12px', fontSize: 12, resize: 'vertical',
  outline: 'none', lineHeight: 1.6, fontFamily: 'inherit',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s',
});

// ── Primitives ────────────────────────────────────────────────────────────────

function GradientBar({ top }) {
  return <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: top }} />;
}

function GlowBlob({ color }) {
  return <div style={{ position: 'absolute', top: -40, right: -40, width: 140, height: 140, background: `radial-gradient(circle, ${color} 0%, transparent 70%)`, pointerEvents: 'none' }} />;
}

function SparkBars({ values = [], color }) {
  const max = Math.max(...values, 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 24, marginTop: 8 }}>
      {values.map((v, i) => (
        <div key={i} style={{
          flex: 1, borderRadius: '2px 2px 0 0', background: color,
          height: `${Math.max((v / max) * 100, 8)}%`,
          opacity: 0.25 + (i / values.length) * 0.75,
        }} />
      ))}
    </div>
  );
}

function StatCard({ label, value, sub, gradient, glow, accentColor, icon, spark }) {
  return (
    <div style={{ ...glass, padding: '18px 20px', borderColor: `color-mix(in srgb, ${accentColor} 13%, transparent)`, boxShadow: `0 4px 32px color-mix(in srgb, ${glow} 8%, transparent)`, display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
      <GradientBar top={gradient} />
      <GlowBlob color={glow} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', position: 'relative' }}>
        <div>
          <p style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 8px' }}>{label}</p>
          <p style={{ fontSize: 28, fontWeight: 900, color: 'var(--text-primary)', margin: 0, lineHeight: 1, letterSpacing: '-0.5px' }}>{value}</p>
          {sub && <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '5px 0 0', fontWeight: 500 }}>{sub}</p>}
        </div>
        <div style={{ width: 42, height: 42, borderRadius: 13, background: gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 4px 14px ${glow}` }}>
          <div style={{ color: '#fff' }}>{icon}</div>
        </div>
      </div>
      {spark && <SparkBars values={spark} color={accentColor} />}
    </div>
  );
}

function CharCount({ value, limit }) {
  const len = (value ?? '').length;
  const pct = len / limit;
  const color = pct > 1 ? 'var(--rose)' : pct > 0.9 ? 'var(--warning)' : 'var(--border-strong)';
  return <span style={{ fontSize: 10, color, marginLeft: 6 }}>{len}/{limit}</span>;
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text ?? ''); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      style={{
        fontSize: 10, padding: '3px 10px', borderRadius: 6,
        border: `1px solid ${copied ? 'var(--success)' : 'var(--overlay-8)'}`,
        background: copied ? 'rgba(16,185,129,0.1)' : 'var(--overlay-3)',
        cursor: 'pointer', color: copied ? 'var(--success)' : 'var(--text-subtle)', transition: 'all .15s',
      }}>
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}

function FieldRow({ label, chars, limit, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 5 }}>
        <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-faint)' }}>{label}</span>
        {chars != null && <CharCount value={chars} limit={limit} />}
      </div>
      {children}
    </div>
  );
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

function Pill({ text, color }) {
  return (
    <span style={{
      fontSize: 11, padding: '3px 10px', borderRadius: 999, fontWeight: 500,
      background: `color-mix(in srgb, ${color} 8%, transparent)`, color, border: `1px solid color-mix(in srgb, ${color} 21%, transparent)`,
    }}>
      {text}
    </span>
  );
}

// ── Publish helpers ───────────────────────────────────────────────────────────

function mapIssuesToFields(issues = []) {
  const result = {};
  for (const issue of issues) {
    const attrs = issue.attributeNames ?? [];
    let key = 'General';
    if (attrs.some(a => a === 'item_name'))           key = 'Title';
    else if (attrs.some(a => a === 'bullet_point'))   key = 'Bullet Points';
    else if (attrs.some(a => a === 'product_description')) key = 'Description';
    (result[key] ??= []).push(issue.message ?? issue.code ?? 'Validation error');
  }
  return result;
}

function DiffField({ label, current, proposed, limit, isOver, measureBytes = false }) {
  const len = measureBytes ? byteLen(proposed) : (proposed ?? '').length;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
          {label} · Current
        </div>
        <div style={{ background: 'var(--overlay-1)', border: '1px solid var(--overlay-4)', borderRadius: 8, padding: '8px 10px', fontSize: 11, color: 'var(--text-subtle)', maxHeight: 80, overflow: 'auto', lineHeight: 1.5 }}>
          {current || <em style={{ opacity: 0.5 }}>empty</em>}
        </div>
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: isOver ? 'var(--danger)' : 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {label} · Proposed
          </span>
          {limit != null && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99, background: isOver ? 'rgba(244,63,94,0.15)' : 'var(--overlay-4)', color: isOver ? 'var(--danger)' : 'var(--text-faint)', border: `1px solid ${isOver ? 'rgba(244,63,94,0.3)' : 'transparent'}` }}>
              {len}/{limit}{isOver ? ' ✕' : ''}
            </span>
          )}
        </div>
        <div style={{ background: isOver ? 'rgba(244,63,94,0.06)' : 'rgba(139,92,246,0.05)', border: `1px solid ${isOver ? 'rgba(244,63,94,0.25)' : 'rgba(139,92,246,0.15)'}`, borderRadius: 8, padding: '8px 10px', fontSize: 11, color: isOver ? 'var(--danger)' : 'var(--accent-soft)', maxHeight: 80, overflow: 'auto', lineHeight: 1.5 }}>
          {proposed || <em style={{ opacity: 0.5 }}>empty</em>}
        </div>
      </div>
    </div>
  );
}

function PublishDiffPanel({ current, optimized, sku, overLimit, hasOverLimit, isPublishing, onConfirm, onCancel }) {
  const overCount = [overLimit.title, ...(overLimit.bullets ?? []), overLimit.description, overLimit.genericKeyword].filter(Boolean).length;
  return (
    <div style={{ ...glass, padding: '20px 24px', borderColor: hasOverLimit ? 'rgba(244,63,94,0.3)' : 'rgba(139,92,246,0.25)', boxShadow: '0 4px 40px var(--overlay-8)' }}>
      <GradientBar top={hasOverLimit ? 'linear-gradient(90deg,var(--danger-strong),var(--warning))' : 'linear-gradient(90deg,var(--accent-strong),var(--success))'} />
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>Pre-publish Review</p>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-faint)' }}>
              SKU: <strong style={{ color: 'var(--text-muted)' }}>{sku}</strong> · Confirm the changes below before pushing to Amazon
            </p>
          </div>
          {hasOverLimit && (
            <div style={{ background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.3)', borderRadius: 8, padding: '6px 12px', fontSize: 12, color: 'var(--danger)', fontWeight: 600 }}>
              ⚠ {overCount} field{overCount !== 1 ? 's' : ''} over limit
            </div>
          )}
        </div>

        <DiffField label="Title" current={current.title} proposed={optimized.title} limit={CHAR_LIMIT.title} isOver={overLimit.title} />
        {(optimized.bullets ?? []).map((b, i) => (
          <DiffField key={i} label={`Bullet ${i + 1}`} current={current.bullets?.[i] ?? ''} proposed={b} limit={CHAR_LIMIT.bullet} isOver={overLimit.bullets?.[i] ?? false} />
        ))}
        <DiffField label="Description" current={current.description} proposed={optimized.description} limit={CHAR_LIMIT.description} isOver={overLimit.description} />
        {(optimized.genericKeyword || current.genericKeyword) && (
          <DiffField label="Generic Keyword (bytes)" current={current.genericKeyword ?? ''} proposed={optimized.genericKeyword ?? ''} limit={CHAR_LIMIT.genericKeyword} isOver={overLimit.genericKeyword} measureBytes />
        )}

        {hasOverLimit && (
          <div style={{ background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.2)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: 'var(--danger)' }}>
            Fix the {overCount} over-limit field{overCount !== 1 ? 's' : ''} before publishing — Amazon will reject the listing if any field exceeds its character limit.
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel}
            style={{ padding: '9px 20px', borderRadius: 9, border: '1px solid var(--overlay-8)', background: 'transparent', color: 'var(--text-subtle)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={hasOverLimit || isPublishing}
            style={{ padding: '9px 24px', borderRadius: 9, border: 'none', background: (hasOverLimit || isPublishing) ? 'var(--overlay-4)' : 'linear-gradient(135deg,var(--success),#059669)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: (hasOverLimit || isPublishing) ? 'not-allowed' : 'pointer', opacity: (hasOverLimit || isPublishing) ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 7, boxShadow: (!hasOverLimit && !isPublishing) ? '0 4px 18px rgba(16,185,129,0.4)' : 'none' }}>
            {isPublishing ? <><Spinner /> Publishing…</> : '✓ Confirm & Publish'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function ListingOptimizerPanel({ profileId, searchTerms = [], aiModel = 'gemini', setAiModel }) {
  const today        = getTodayISO();
  const thirtyDaysAgo = getDaysAgoISO(30);

  const [asin, setAsin]               = useState('');
  const [sku, setSku]                 = useState('');
  const [isFetching, setIsFetching]   = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isLoadingTerms, setIsLoadingTerms] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [publishResult, setPublishResult] = useState(null);
  const [error, setError]             = useState(null);
  const [termsMessage, setTermsMessage] = useState(null);

  const [uploadedKeywords, setUploadedKeywords] = useState([]);
  const [uploadFileName, setUploadFileName]     = useState('');
  const [isParsingFile, setIsParsingFile]       = useState(false);
  const fileInputRef = useRef(null);

  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo]     = useState(today);

  const [title, setTitle]             = useState('');
  const [bullets, setBullets]         = useState(['', '', '', '', '']);
  const [description, setDescription] = useState('');
  const [genericKeyword, setGenericKeyword] = useState('');
  const [fetchedAsin, setFetchedAsin]         = useState('');
  const [fetchedSku, setFetchedSku]           = useState('');
  const [fetchedProductType, setFetchedProductType] = useState('');
  const [fetchedImage, setFetchedImage]           = useState(null);
  const [listingScore, setListingScore]           = useState(null);
  const [listingGrade, setListingGrade]           = useState(null);
  const [listingDimensions, setListingDimensions] = useState([]);
  const [hasFetched, setHasFetched]   = useState(false);

  const [productSearchTerms, setProductSearchTerms] = useState([]);
  const activeTerms = productSearchTerms.length > 0 ? productSearchTerms : searchTerms;

  const [optimized, setOptimized] = useState(null);

  const relevantTerms = useMemo(() =>
    activeTerms.filter(t => t.recommendation === 'SCALE_UP' || t.recommendation === 'ADD_EXACT'),
    [activeTerms]
  );

  const setBullet = (i, val) => setBullets(prev => prev.map((b, idx) => idx === i ? val : b));
  const canLoadTerms = (sku.trim() || fetchedAsin) && !isLoadingTerms;

  async function handleFetch() {
    if (!asin.trim() && !sku.trim()) return;
    setIsFetching(true); setError(null); setOptimized(null);
    setProductSearchTerms([]); setTermsMessage(null);
    setPublishResult(null); setConfirmPublish(false);
    setListingDimensions([]);
    try {
      const p = await lookupProduct(asin.trim() || undefined, sku.trim() || undefined, profileId || undefined);
      setTitle(p.title ?? '');
      setBullets(Array.from({ length: 5 }, (_, i) => p.bullets?.[i] ?? ''));
      setDescription(p.description ?? '');
      setGenericKeyword(p.genericKeyword ?? '');
      setFetchedAsin(p.asin ?? asin.trim());
      setFetchedSku(p.sku ?? '');
      setFetchedProductType(p.productType ?? '');
      setFetchedImage(p.mainImage ?? null);
      setListingScore(p.score ?? null);
      setListingGrade(p.grade ?? null);
      setListingDimensions(p.dimensions ?? []);
      setHasFetched(true);
    } catch (err) {
      setError(err.response?.data?.error ?? err.message ?? 'Failed to fetch product');
    } finally {
      setIsFetching(false);
    }
  }

  async function handlePublish() {
    const skuToUse = sku.trim() || fetchedSku;
    if (!skuToUse || !optimized) return;
    setIsPublishing(true); setPublishResult(null); setError(null);
    try {
      const result = await publishListing({
        sku: skuToUse, productType: fetchedProductType,
        title: optimized.title, bullets: optimized.bullets.filter(Boolean),
        description: optimized.description,
        genericKeyword: optimized.genericKeyword || undefined,
        profileId: profileId || undefined,
      });
      setPublishResult({ ok: true, issues: result.issues ?? [] });
    } catch (err) {
      setError('Publish failed: ' + (err.response?.data?.error ?? err.message));
    } finally {
      setIsPublishing(false);
    }
  }

  async function handleLoadProductTerms() {
    const skuVal  = sku.trim();
    const asinVal = fetchedAsin || asin.trim();
    if (!skuVal && !asinVal) return;
    setIsLoadingTerms(true); setError(null); setTermsMessage(null);
    try {
      const data = await getSearchTermsForProduct({
        profileId: profileId || undefined,
        sku: skuVal || undefined, asin: asinVal || undefined,
        startDate: dateFrom, endDate: dateTo,
      });
      const terms = Array.isArray(data.searchTerms) ? data.searchTerms : [];
      setProductSearchTerms(terms);
      if (data.message) {
        setTermsMessage({ type: 'warn', text: data.message });
      } else {
        const scaleUp  = terms.filter(t => t.recommendation === 'SCALE_UP').length;
        const addExact = terms.filter(t => t.recommendation === 'ADD_EXACT').length;
        setTermsMessage({ type: 'success', text: `Loaded ${terms.length} search terms · ${scaleUp} Scale Up · ${addExact} Add Exact` });
      }
    } catch (err) {
      setError('Failed to load search terms: ' + (err.response?.data?.error ?? err.message));
    } finally {
      setIsLoadingTerms(false);
    }
  }

  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsParsingFile(true); setError(null);
    try {
      let keywords = [];
      const name = file.name.toLowerCase();
      if (name.endsWith('.csv') || name.endsWith('.txt')) {
        keywords = parseCsvKeywords(await file.text());
      } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        keywords = await parseXlsxKeywords(file);
      } else {
        setError('Unsupported file type. Please upload a .csv, .txt, or .xlsx file.');
        return;
      }
      const unique = [...new Set(keywords.filter(k => k.length > 0))];
      if (!unique.length) { setError('No keywords found in the file.'); return; }
      setUploadedKeywords(unique);
      setUploadFileName(file.name);
    } catch (err) {
      setError('Failed to parse file: ' + err.message);
    } finally {
      setIsParsingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleOptimize() {
    setIsOptimizing(true); setError(null); setOptimized(null);
    try {
      const result = await optimizeListingApi({
        asin: fetchedAsin, title, bullets: bullets.filter(Boolean), description,
        genericKeyword,
        searchTerms: relevantTerms,
        uploadedKeywords: uploadedKeywords.length > 0 ? uploadedKeywords : undefined,
        model: aiModel, profileId: profileId || undefined,
      });
      setOptimized({ ...result, bullets: Array.from({ length: 5 }, (_, i) => result.bullets?.[i] ?? '') });
    } catch (err) {
      setError(err.response?.data?.error ?? err.message ?? 'Optimization failed');
    } finally {
      setIsOptimizing(false);
    }
  }

  // ── derived stats ──
  const totalKeywords = uploadedKeywords.length + relevantTerms.length;
  const scaleUpCount  = relevantTerms.filter(t => t.recommendation === 'SCALE_UP').length;
  const exactCount    = relevantTerms.filter(t => t.recommendation === 'ADD_EXACT').length;
  const keywordSpark  = useMemo(() =>
    relevantTerms.slice(0, 10).map((_, i) => 10 - i).concat(Array(Math.max(0, 10 - relevantTerms.length)).fill(1)),
    [relevantTerms]);

  const overLimit = useMemo(() => {
    if (!optimized) return { title: false, bullets: [], description: false, genericKeyword: false };
    return {
      title:          (optimized.title ?? '').length > CHAR_LIMIT.title,
      bullets:        (optimized.bullets ?? []).map(b => (b ?? '').length > CHAR_LIMIT.bullet),
      description:    (optimized.description ?? '').length > CHAR_LIMIT.description,
      genericKeyword: byteLen(optimized.genericKeyword ?? '') > CHAR_LIMIT.genericKeyword,
    };
  }, [optimized]);
  const hasOverLimit = overLimit.title || overLimit.bullets.some(Boolean) || overLimit.description || overLimit.genericKeyword;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ══ HERO HEADER ══ */}
      <div style={{ ...glass, padding: '22px 24px', borderColor: 'rgba(139,92,246,0.2)', boxShadow: '0 4px 40px rgba(139,92,246,0.1)' }}>
        <GradientBar top="linear-gradient(90deg,var(--accent-strong),var(--info-strong),var(--success))" />
        <GlowBlob color="rgba(139,92,246,0.25)" />

        <div style={{ position: 'relative' }}>
          {/* Title row */}
          <div style={{ marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            {fetchedImage && (
              <div style={{ flexShrink: 0, width: 72, height: 72, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--overlay-7)', background: 'var(--overlay-3)' }}>
                <img src={fetchedImage} alt="Product" style={{ width: '100%', height: '100%', objectFit: 'contain' }} onError={e => { e.target.style.display = 'none'; }} />
              </div>
            )}
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
                <p style={{ margin: 0, fontWeight: 900, fontSize: 17, color: 'var(--text-primary)', letterSpacing: '-0.4px' }}>
                  Listing Optimizer
                </p>
                {hasFetched && fetchedAsin && (
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-strong)', background: 'rgba(139,92,246,0.12)', padding: '2px 10px', borderRadius: 20, border: '1px solid rgba(139,92,246,0.25)' }}>
                    {fetchedAsin}
                  </span>
                )}
                {listingScore !== null && (
                  <span style={{
                    fontSize: 12, fontWeight: 800, padding: '2px 12px', borderRadius: 20,
                    background: listingScore >= 85 ? 'rgba(16,185,129,0.15)' : listingScore >= 70 ? 'rgba(245,158,11,0.15)' : 'rgba(244,63,94,0.15)',
                    color: listingScore >= 85 ? 'var(--success-2)' : listingScore >= 70 ? 'var(--warning-2)' : 'var(--danger)',
                    border: `1px solid ${listingScore >= 85 ? 'rgba(16,185,129,0.3)' : listingScore >= 70 ? 'rgba(245,158,11,0.3)' : 'rgba(244,63,94,0.3)'}`,
                  }}>
                    Grade {listingGrade} · {listingScore}/100
                  </span>
                )}
              </div>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>
                Fetch by ASIN or SKU — AI finds your campaigns, pulls search terms, and rewrites the listing
              </p>
            </div>
          </div>

          {/* ASIN / SKU inputs + Fetch */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <input value={asin} onChange={e => setAsin(e.target.value.toUpperCase())}
              placeholder="ASIN  (e.g. B0C…)" style={{ ...inputSt, width: 170 }}
              onFocus={e => e.target.style.borderColor = 'var(--accent-strong)'}
              onBlur={e => e.target.style.borderColor = 'var(--overlay-7)'}
              onKeyDown={e => e.key === 'Enter' && handleFetch()} />
            <span style={{ color: 'var(--text-faint)', fontSize: 12, fontWeight: 600 }}>or</span>
            <input value={sku} onChange={e => setSku(e.target.value)}
              placeholder="SKU" style={{ ...inputSt, width: 140 }}
              onFocus={e => e.target.style.borderColor = 'var(--accent-strong)'}
              onBlur={e => e.target.style.borderColor = 'var(--overlay-7)'}
              onKeyDown={e => e.key === 'Enter' && handleFetch()} />

            <button onClick={handleFetch} disabled={isFetching || (!asin.trim() && !sku.trim())}
              style={{
                display: 'flex', alignItems: 'center', gap: 7, padding: '9px 20px',
                borderRadius: 10, border: 'none',
                cursor: isFetching || (!asin.trim() && !sku.trim()) ? 'not-allowed' : 'pointer',
                background: isFetching ? 'var(--overlay-6)' : 'linear-gradient(135deg,var(--accent-strong),var(--info-strong))',
                color: '#fff', fontWeight: 700, fontSize: 13,
                boxShadow: (!isFetching && (asin.trim() || sku.trim())) ? '0 4px 20px rgba(139,92,246,0.45)' : 'none',
                opacity: (!asin.trim() && !sku.trim()) ? 0.4 : 1, whiteSpace: 'nowrap',
              }}>
              {isFetching ? <><Spinner /> Fetching…</> : (
                <><svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                </svg>Fetch Listing</>
              )}
            </button>

            {/* Upload keywords */}
            <input ref={fileInputRef} type="file" accept=".csv,.txt,.xlsx,.xls" style={{ display: 'none' }} onChange={handleFileUpload} />
            <button onClick={() => fileInputRef.current?.click()} disabled={isParsingFile}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px',
                borderRadius: 10, border: `1px dashed ${uploadedKeywords.length > 0 ? 'rgba(167,139,250,0.4)' : 'var(--overlay-8)'}`,
                background: uploadedKeywords.length > 0 ? 'rgba(167,139,250,0.08)' : 'transparent',
                cursor: isParsingFile ? 'not-allowed' : 'pointer',
                color: uploadedKeywords.length > 0 ? 'var(--accent)' : 'var(--text-faint)',
                fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap',
              }}>
              {isParsingFile ? <><Spinner /> Parsing…</> : (
                <><svg style={{ width: 13, height: 13 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
                </svg>
                {uploadedKeywords.length > 0 ? `${uploadedKeywords.length} keywords · "${uploadFileName}"` : 'Upload Keywords'}</>
              )}
            </button>
            {uploadedKeywords.length > 0 && (
              <button onClick={() => { setUploadedKeywords([]); setUploadFileName(''); }}
                style={{ fontSize: 11, padding: '4px 10px', borderRadius: 7, border: '1px solid var(--overlay-7)', background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer' }}>
                ✕ Clear
              </button>
            )}
          </div>

          {/* Load product-specific search terms */}
          {hasFetched && (sku.trim() || fetchedAsin) && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--overlay-4)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--text-faint)', fontWeight: 600 }}>Search terms:</span>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} max={dateTo}
                style={{ ...inputSt, fontSize: 11, padding: '6px 10px' }} />
              <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>→</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} min={dateFrom} max={today}
                style={{ ...inputSt, fontSize: 11, padding: '6px 10px' }} />
              <button onClick={handleLoadProductTerms} disabled={!canLoadTerms}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 9, border: 'none',
                  cursor: canLoadTerms ? 'pointer' : 'not-allowed',
                  background: isLoadingTerms ? 'var(--overlay-5)' : 'linear-gradient(135deg,var(--success),var(--info-strong))',
                  color: '#fff', fontWeight: 700, fontSize: 12,
                  boxShadow: canLoadTerms && !isLoadingTerms ? '0 3px 14px rgba(16,185,129,0.4)' : 'none',
                  opacity: canLoadTerms ? 1 : 0.4, whiteSpace: 'nowrap',
                }}>
                {isLoadingTerms ? <><Spinner size={13} /> Finding campaigns… (~60s)</> : (
                  <><svg style={{ width: 13, height: 13 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
                  </svg>Load Search Terms for this Product</>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ══ ERRORS & MESSAGES ══ */}
      {error && (
        <div style={{ background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.25)', color: 'var(--danger)', borderRadius: 12, padding: '12px 16px', fontSize: 13 }}>
          {error}
        </div>
      )}
      {termsMessage && (
        <div style={{
          background: termsMessage.type === 'success' ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)',
          border: `1px solid ${termsMessage.type === 'success' ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.25)'}`,
          color: termsMessage.type === 'success' ? 'var(--success-2)' : 'var(--warning-2)',
          borderRadius: 12, padding: '10px 16px', fontSize: 12,
        }}>
          {termsMessage.type === 'success' ? '✓' : '⚠'} {termsMessage.text}
        </div>
      )}
      {hasFetched && activeTerms.length === 0 && !isLoadingTerms && !termsMessage && (
        <div style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)', color: 'var(--warning-2)', borderRadius: 12, padding: '10px 16px', fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <svg style={{ width: 14, height: 14, flexShrink: 0 }} fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
          </svg>
          Click "Load Search Terms for this Product" above for best keyword results. You can still optimize without them.
        </div>
      )}

      {/* ══ LISTING QUALITY BREAKDOWN ══ */}
      {hasFetched && listingDimensions.length > 0 && (
        <div style={{ ...glass, padding: '18px 22px', borderColor: listingScore >= 85 ? 'rgba(16,185,129,0.2)' : listingScore >= 70 ? 'rgba(245,158,11,0.2)' : 'rgba(244,63,94,0.2)' }}>
          <GradientBar top={listingScore >= 85 ? 'linear-gradient(90deg,var(--success),var(--info-strong))' : listingScore >= 70 ? 'linear-gradient(90deg,var(--warning),var(--danger-strong))' : 'linear-gradient(90deg,var(--danger-strong),var(--accent-strong))'} />
          <div style={{ position: 'relative' }}>
            <p style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 14px' }}>
              Listing Quality Breakdown
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {listingDimensions.map(dim => {
                const dimColor = dim.score >= 85 ? 'var(--success)' : dim.score >= 60 ? 'var(--warning)' : 'var(--danger-strong)';
                const dimBg    = dim.score >= 85 ? 'rgba(16,185,129,0.08)' : dim.score >= 60 ? 'rgba(245,158,11,0.08)' : 'rgba(244,63,94,0.08)';
                return (
                  <div key={dim.name} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 36px', gap: 10, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>{dim.name}</span>
                    <div style={{ position: 'relative', height: 6, background: 'var(--overlay-4)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ width: `${dim.score}%`, height: '100%', background: `linear-gradient(90deg,color-mix(in srgb, ${dimColor} 60%, transparent),${dimColor})`, borderRadius: 99, transition: 'width 0.8s ease' }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 800, color: dimColor, textAlign: 'right' }}>{dim.score}</span>
                  </div>
                );
              })}
            </div>
            {listingDimensions.some(d => d.score < 60) && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 5 }}>
                <p style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>Issues to fix</p>
                {listingDimensions.filter(d => d.score < 60).map(d => (
                  <p key={d.name} style={{ fontSize: 11, color: 'var(--danger)', margin: 0 }}>
                    · <strong>{d.name}:</strong> {d.feedback}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ STAT CARDS ══ */}
      {hasFetched && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
          <StatCard
            label="Priority Keywords" value={uploadedKeywords.length || '—'}
            sub={uploadedKeywords.length > 0 ? `from "${uploadFileName}"` : 'Upload CSV / Excel'}
            gradient="linear-gradient(135deg,var(--accent),#7C3AED)" glow="rgba(167,139,250,0.5)" accentColor="var(--accent)"
            icon={<svg width="19" height="19" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>}
          />
          <StatCard
            label="Scale Up Terms" value={scaleUpCount || '—'}
            sub="High-performance keywords"
            gradient="linear-gradient(135deg,var(--success),#059669)" glow="rgba(16,185,129,0.5)" accentColor="var(--success)"
            spark={keywordSpark}
            icon={<svg width="19" height="19" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>}
          />
          <StatCard
            label="Add Exact Terms" value={exactCount || '—'}
            sub="Target conversion keywords"
            gradient="linear-gradient(135deg,var(--info-strong),#2563EB)" glow="rgba(59,130,246,0.5)" accentColor="var(--info-strong)"
            icon={<svg width="19" height="19" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>}
          />
          <StatCard
            label="Total Keywords" value={totalKeywords || '—'}
            sub={optimized ? '✓ Listing optimized' : 'Ready to optimize'}
            gradient="linear-gradient(135deg,var(--accent-strong),var(--indigo))" glow="rgba(139,92,246,0.5)" accentColor="var(--accent-strong)"
            icon={<svg width="19" height="19" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>}
          />
          {setAiModel ? (
            <div style={{
              padding: '18px 20px', borderRadius: 16,
              background: 'var(--bg-overlay-lo)', border: '1px solid rgba(245,158,11,0.25)',
              display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <svg width="19" height="19" fill="none" stroke="var(--warning)" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
                <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--warning)' }}>AI Model</span>
              </div>
              <div style={{ display: 'flex', gap: 4, background: 'var(--overlay-3)', borderRadius: 10, padding: 3, border: '1px solid var(--overlay-5)' }}>
                {[
                  { id: 'gemini', label: 'Gemini 2.5 Flash', color: 'var(--info-strong)', glow: 'rgba(59,130,246,0.4)' },
                  { id: 'claude', label: 'Claude Sonnet',    color: 'var(--accent-strong)', glow: 'rgba(139,92,246,0.4)' },
                ].map(({ id, label, color, glow }) => (
                  <button key={id} onClick={() => setAiModel(id)} style={{
                    flex: 1, fontSize: 11, fontWeight: 700, padding: '6px 10px', borderRadius: 7,
                    border: 'none', cursor: 'pointer', transition: 'all .15s',
                    background: aiModel === id ? color : 'transparent',
                    color: aiModel === id ? '#fff' : 'var(--text-muted)',
                    boxShadow: aiModel === id ? `0 2px 12px ${glow}` : 'none',
                  }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <StatCard
              label="AI Model" value={aiModel === 'claude' ? 'Claude' : 'Gemini'}
              sub={aiModel === 'claude' ? 'Sonnet 4.5' : '2.5 Flash'}
              gradient="linear-gradient(135deg,var(--warning),#D97706)" glow="rgba(245,158,11,0.5)" accentColor="var(--warning)"
              icon={<svg width="19" height="19" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>}
            />
          )}
        </div>
      )}

      {/* ══ KEYWORD PILLS ══ */}
      {uploadedKeywords.length > 0 && (
        <div style={{ ...glass, padding: '18px 22px', borderColor: 'rgba(167,139,250,0.2)' }}>
          <GradientBar top="linear-gradient(90deg,var(--accent),#7C3AED)" />
          <GlowBlob color="rgba(167,139,250,0.2)" />
          <div style={{ position: 'relative' }}>
            <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--accent)' }}>
              ★ Priority Keywords ({uploadedKeywords.length}) — AI uses these first
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {uploadedKeywords.slice(0, 60).map((kw, i) => <Pill key={i} text={kw} color="var(--accent)" />)}
              {uploadedKeywords.length > 60 && <span style={{ fontSize: 11, color: 'var(--text-faint)', padding: '3px 0' }}>+{uploadedKeywords.length - 60} more</span>}
            </div>
          </div>
        </div>
      )}

      {relevantTerms.length > 0 && (
        <div style={{ ...glass, padding: '18px 22px' }}>
          <GradientBar top="linear-gradient(90deg,var(--success),var(--info-strong))" />
          <GlowBlob color="rgba(16,185,129,0.15)" />
          <div style={{ position: 'relative' }}>
            <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-faint)' }}>
              Campaign Keywords ({relevantTerms.length})
              {productSearchTerms.length > 0 && <span style={{ color: 'var(--success)', marginLeft: 8, fontWeight: 600 }}>· product-specific</span>}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {relevantTerms.slice(0, 50).map((t, i) => (
                <Pill key={i} text={t.searchTerm} color={t.recommendation === 'SCALE_UP' ? 'var(--success)' : 'var(--info-strong)'} />
              ))}
              {relevantTerms.length > 50 && <span style={{ fontSize: 11, color: 'var(--text-faint)', padding: '3px 0' }}>+{relevantTerms.length - 50} more</span>}
            </div>
          </div>
        </div>
      )}

      {/* ══ SIDE-BY-SIDE EDITOR ══ */}
      {hasFetched && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

          {/* LEFT — Current (editable) */}
          <div style={{ ...glass, padding: 0, overflow: 'hidden' }}>
            <GradientBar top="linear-gradient(90deg,var(--info-strong),var(--indigo))" />
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--overlay-4)' }}>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-faint)' }}>Current Listing</p>
            </div>
            <div style={{ padding: '16px 18px' }}>
              <FieldRow label="Title" chars={title} limit={CHAR_LIMIT.title}>
                <textarea value={title} onChange={e => setTitle(e.target.value)} rows={3} style={taSt(false)}
                  onFocus={e => e.target.style.borderColor = 'var(--info-strong)'}
                  onBlur={e => e.target.style.borderColor = 'var(--overlay-7)'} />
              </FieldRow>
              {bullets.map((b, i) => (
                <FieldRow key={i} label={`Bullet ${i + 1}`} chars={b} limit={CHAR_LIMIT.bullet}>
                  <textarea value={b} onChange={e => setBullet(i, e.target.value)} rows={2} style={taSt(false)}
                    onFocus={e => e.target.style.borderColor = 'var(--info-strong)'}
                    onBlur={e => e.target.style.borderColor = 'var(--overlay-7)'} />
                </FieldRow>
              ))}
              <FieldRow label="Description" chars={description} limit={CHAR_LIMIT.description}>
                <textarea value={description} onChange={e => setDescription(e.target.value)} rows={6} style={taSt(false)}
                  onFocus={e => e.target.style.borderColor = 'var(--info-strong)'}
                  onBlur={e => e.target.style.borderColor = 'var(--overlay-7)'} />
              </FieldRow>
              <FieldRow label="Generic Keyword (backend search terms)" chars={byteLen(genericKeyword) + ' bytes'} limit={CHAR_LIMIT.genericKeyword + ' bytes'}>
                <textarea value={genericKeyword} onChange={e => setGenericKeyword(e.target.value)} rows={3}
                  placeholder="space-separated keywords for Amazon's hidden search-terms field"
                  style={taSt(byteLen(genericKeyword) > CHAR_LIMIT.genericKeyword)}
                  onFocus={e => e.target.style.borderColor = 'var(--info-strong)'}
                  onBlur={e => e.target.style.borderColor = byteLen(genericKeyword) > CHAR_LIMIT.genericKeyword ? 'var(--danger-strong)' : 'var(--overlay-7)'} />
              </FieldRow>
            </div>
          </div>

          {/* RIGHT — Optimized */}
          <div style={{ ...glass, padding: 0, overflow: 'hidden', borderColor: optimized ? 'rgba(139,92,246,0.25)' : 'var(--overlay-5)', boxShadow: optimized ? '0 4px 40px rgba(139,92,246,0.15)' : 'none' }}>
            {optimized && <GradientBar top="linear-gradient(90deg,var(--accent-strong),var(--info-strong),var(--success))" />}
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--overlay-4)', background: optimized ? 'rgba(139,92,246,0.06)' : 'transparent' }}>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: optimized ? 'var(--accent)' : 'var(--text-faint)' }}>
                {optimized ? '✦ AI-Optimized Listing' : 'Optimized Listing'}
              </p>
            </div>
            <div style={{ padding: '16px 18px' }}>
              {optimized ? (
                <>
                  <FieldRow label="Title">
                    <div style={{ position: 'relative' }}>
                      <textarea value={optimized.title ?? ''} readOnly rows={3} style={taSt(true)} />
                      <div style={{ position: 'absolute', top: 6, right: 8 }}><CopyButton text={optimized.title} /></div>
                    </div>
                  </FieldRow>
                  {(optimized.bullets ?? []).map((b, i) => (
                    <FieldRow key={i} label={`Bullet ${i + 1}`}>
                      <div style={{ position: 'relative' }}>
                        <textarea value={b} readOnly rows={2} style={taSt(true)} />
                        <div style={{ position: 'absolute', top: 6, right: 8 }}><CopyButton text={b} /></div>
                      </div>
                    </FieldRow>
                  ))}
                  <FieldRow label="Description">
                    <div style={{ position: 'relative' }}>
                      <textarea value={optimized.description ?? ''} readOnly rows={6} style={taSt(true)} />
                      <div style={{ position: 'absolute', top: 6, right: 8 }}><CopyButton text={optimized.description} /></div>
                    </div>
                  </FieldRow>
                  {optimized.genericKeyword !== undefined && (
                    <FieldRow label={`Generic Keyword · ${byteLen(optimized.genericKeyword)}/${CHAR_LIMIT.genericKeyword} bytes`}>
                      <div style={{ position: 'relative' }}>
                        <textarea value={optimized.genericKeyword ?? ''} readOnly rows={3} style={taSt(true)} />
                        <div style={{ position: 'absolute', top: 6, right: 8 }}><CopyButton text={optimized.genericKeyword ?? ''} /></div>
                      </div>
                    </FieldRow>
                  )}

                  {/* Copy All */}
                  <button onClick={() => navigator.clipboard.writeText(
                    `TITLE:\n${optimized.title}\n\nBULLETS:\n${(optimized.bullets ?? []).map((b, i) => `${i+1}. ${b}`).join('\n')}\n\nDESCRIPTION:\n${optimized.description}${optimized.genericKeyword ? `\n\nGENERIC KEYWORD:\n${optimized.genericKeyword}` : ''}`
                  )} style={{
                    width: '100%', marginBottom: 10, padding: '8px', borderRadius: 9,
                    border: '1px solid var(--overlay-7)', background: 'var(--overlay-2)',
                    color: 'var(--text-subtle)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                    onMouseEnter={e => { e.target.style.background = 'var(--overlay-5)'; e.target.style.color = 'var(--text-muted)'; }}
                    onMouseLeave={e => { e.target.style.background = 'var(--overlay-2)'; e.target.style.color = 'var(--text-subtle)'; }}>
                    Copy All
                  </button>

                  {/* Publish section */}
                  {(sku.trim() || fetchedSku) && (
                    <div style={{ borderTop: '1px solid var(--overlay-4)', paddingTop: 12 }}>
                      <div style={{ marginBottom: 8 }}>
                        <label style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: fetchedProductType ? 'var(--text-faint)' : 'var(--warning)' }}>
                          Product Type {!fetchedProductType && <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>— enter manually</span>}
                        </label>
                        <input value={fetchedProductType} onChange={e => setFetchedProductType(e.target.value.toUpperCase())}
                          placeholder="e.g. HOME_FURNISHINGS"
                          style={{ ...inputSt, width: '100%', marginTop: 5, fontSize: 12, boxSizing: 'border-box',
                            borderColor: fetchedProductType ? 'var(--overlay-7)' : 'rgba(245,158,11,0.4)' }}
                          onFocus={e => e.target.style.borderColor = 'var(--accent-strong)'}
                          onBlur={e => e.target.style.borderColor = fetchedProductType ? 'var(--overlay-7)' : 'rgba(245,158,11,0.4)'} />
                      </div>

                      {hasOverLimit && (
                        <div style={{ marginBottom: 8, background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.25)', borderRadius: 8, padding: '7px 10px', fontSize: 11, color: 'var(--danger)', display: 'flex', gap: 6, alignItems: 'center' }}>
                          ⚠ {[overLimit.title, ...(overLimit.bullets ?? []), overLimit.description].filter(Boolean).length} field(s) exceed character limits
                        </div>
                      )}

                      <button onClick={() => setConfirmPublish(true)} disabled={isPublishing || !fetchedProductType || hasOverLimit}
                        style={{
                          width: '100%', padding: '10px', borderRadius: 10, border: 'none',
                          cursor: (isPublishing || !fetchedProductType || hasOverLimit) ? 'not-allowed' : 'pointer',
                          background: (isPublishing || !fetchedProductType || hasOverLimit) ? 'var(--overlay-4)' : 'linear-gradient(135deg,var(--success),#059669)',
                          color: '#fff', fontWeight: 700, fontSize: 13,
                          boxShadow: (!isPublishing && fetchedProductType && !hasOverLimit) ? '0 4px 18px rgba(16,185,129,0.4)' : 'none',
                          opacity: (isPublishing || !fetchedProductType || hasOverLimit) ? 0.5 : 1,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                        }}>
                        {isPublishing ? <><Spinner /> Publishing…</> : '↑ Review & Publish'}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 12, color: 'var(--text-faint)' }}>
                  <div style={{ width: 64, height: 64, borderRadius: 20, background: 'linear-gradient(135deg,#8B5CF620,#3B82F620)', border: '1px solid rgba(139,92,246,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg style={{ width: 28, height: 28, color: 'var(--accent-strong)', opacity: 0.5 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z"/>
                    </svg>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-faint)' }}>Click "Optimize Listing" to generate</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ PRE-PUBLISH DIFF PANEL ══ */}
      {confirmPublish && optimized && (
        <PublishDiffPanel
          current={{ title, bullets, description, genericKeyword }}
          optimized={optimized}
          sku={sku.trim() || fetchedSku}
          overLimit={overLimit}
          hasOverLimit={hasOverLimit}
          isPublishing={isPublishing}
          onConfirm={() => { setConfirmPublish(false); handlePublish(); }}
          onCancel={() => setConfirmPublish(false)}
        />
      )}

      {/* ══ PUBLISH RESULT ══ */}
      {publishResult?.ok && (
        <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 12, padding: '14px 18px' }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--success-2)' }}>✓ Listing published to Amazon</p>
          {(publishResult.issues ?? []).length > 0 && (
            <div style={{ marginTop: 10 }}>
              <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, color: 'var(--warning-2)' }}>⚠ Amazon returned warnings:</p>
              {Object.entries(mapIssuesToFields(publishResult.issues)).map(([field, messages]) => (
                <div key={field} style={{ marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--warning-2)' }}>{field}: </span>
                  <span style={{ fontSize: 11, color: 'var(--warning)' }}>{messages.join(' · ')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══ OPTIMIZE CTA ══ */}
      {hasFetched && (
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 4 }}>
          <button onClick={handleOptimize} disabled={isOptimizing}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '14px 40px', borderRadius: 14, border: 'none',
              cursor: isOptimizing ? 'not-allowed' : 'pointer',
              background: isOptimizing ? 'var(--overlay-5)' : 'linear-gradient(135deg,var(--accent-strong),var(--info-strong))',
              color: '#fff', fontWeight: 800, fontSize: 15, letterSpacing: '-0.2px',
              boxShadow: isOptimizing ? 'none' : '0 6px 32px rgba(139,92,246,0.5)',
              opacity: isOptimizing ? 0.7 : 1, transition: 'all 0.2s',
            }}>
            {isOptimizing ? (
              <><Spinner size={16} />
                Optimizing with {aiModel === 'claude' ? 'Claude Sonnet' : 'Gemini 2.5 Flash'}…
              </>
            ) : (
              <>
                <svg style={{ width: 17, height: 17 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z"/>
                </svg>
                Optimize Listing
                {totalKeywords > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.7, background: 'rgba(255,255,255,0.15)', padding: '2px 10px', borderRadius: 99 }}>
                    {totalKeywords} keywords
                  </span>
                )}
              </>
            )}
          </button>
        </div>
      )}

    </div>
  );
}
