import React, { useState, useMemo, useRef } from 'react';
import { lookupProduct, optimizeListingApi, getSearchTermsForProduct, publishListing } from '../services/api.js';
import { parseCsvKeywords, parseXlsxKeywords } from '../utils/file-parsers.js';
import { getTodayISO, getDaysAgoISO } from '../utils/date-helpers.js';

const CHAR_LIMIT = { title: 200, bullet: 255, description: 2000 };

// ── Shared styles ─────────────────────────────────────────────────────────────

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
  padding: '9px 13px',
  fontSize: 13,
  outline: 'none',
  transition: 'border-color 0.15s',
};

const taSt = (readOnly) => ({
  width: '100%',
  background: readOnly ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.04)',
  border: `1px solid ${readOnly ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.08)'}`,
  borderRadius: 10, color: readOnly ? '#94A3B8' : '#F1F5F9',
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
    <div style={{ ...glass, padding: '18px 20px', borderColor: `${accentColor}20`, boxShadow: `0 4px 32px ${glow}15`, display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
      <GradientBar top={gradient} />
      <GlowBlob color={glow} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', position: 'relative' }}>
        <div>
          <p style={{ fontSize: 10, fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 8px' }}>{label}</p>
          <p style={{ fontSize: 28, fontWeight: 900, color: '#fff', margin: 0, lineHeight: 1, letterSpacing: '-0.5px' }}>{value}</p>
          {sub && <p style={{ fontSize: 11, color: '#475569', margin: '5px 0 0', fontWeight: 500 }}>{sub}</p>}
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
  const color = pct > 1 ? '#F43F5E' : pct > 0.9 ? '#F59E0B' : '#334155';
  return <span style={{ fontSize: 10, color, marginLeft: 6 }}>{len}/{limit}</span>;
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text ?? ''); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      style={{
        fontSize: 10, padding: '3px 10px', borderRadius: 6,
        border: `1px solid ${copied ? '#10B981' : 'rgba(255,255,255,0.1)'}`,
        background: copied ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.04)',
        cursor: 'pointer', color: copied ? '#10B981' : '#64748B', transition: 'all .15s',
      }}>
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}

function FieldRow({ label, chars, limit, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 5 }}>
        <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#475569' }}>{label}</span>
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
      background: `${color}14`, color, border: `1px solid ${color}35`,
    }}>
      {text}
    </span>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function ListingOptimizerPanel({ profileId, searchTerms = [], aiModel = 'gemini' }) {
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
        description: optimized.description, profileId: profileId || undefined,
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ══ HERO HEADER ══ */}
      <div style={{ ...glass, padding: '22px 24px', borderColor: 'rgba(139,92,246,0.2)', boxShadow: '0 4px 40px rgba(139,92,246,0.1)' }}>
        <GradientBar top="linear-gradient(90deg,#8B5CF6,#3B82F6,#10B981)" />
        <GlowBlob color="rgba(139,92,246,0.25)" />

        <div style={{ position: 'relative' }}>
          {/* Title row */}
          <div style={{ marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            {fetchedImage && (
              <div style={{ flexShrink: 0, width: 72, height: 72, borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)' }}>
                <img src={fetchedImage} alt="Product" style={{ width: '100%', height: '100%', objectFit: 'contain' }} onError={e => { e.target.style.display = 'none'; }} />
              </div>
            )}
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
                <p style={{ margin: 0, fontWeight: 900, fontSize: 17, color: '#F1F5F9', letterSpacing: '-0.4px' }}>
                  Listing Optimizer
                </p>
                {hasFetched && fetchedAsin && (
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#8B5CF6', background: 'rgba(139,92,246,0.12)', padding: '2px 10px', borderRadius: 20, border: '1px solid rgba(139,92,246,0.25)' }}>
                    {fetchedAsin}
                  </span>
                )}
                {listingScore !== null && (
                  <span style={{
                    fontSize: 12, fontWeight: 800, padding: '2px 12px', borderRadius: 20,
                    background: listingScore >= 85 ? 'rgba(16,185,129,0.15)' : listingScore >= 70 ? 'rgba(245,158,11,0.15)' : 'rgba(244,63,94,0.15)',
                    color: listingScore >= 85 ? '#34D399' : listingScore >= 70 ? '#FCD34D' : '#F87171',
                    border: `1px solid ${listingScore >= 85 ? 'rgba(16,185,129,0.3)' : listingScore >= 70 ? 'rgba(245,158,11,0.3)' : 'rgba(244,63,94,0.3)'}`,
                  }}>
                    Grade {listingGrade} · {listingScore}/100
                  </span>
                )}
              </div>
              <p style={{ margin: 0, fontSize: 12, color: '#334155' }}>
                Fetch by ASIN or SKU — AI finds your campaigns, pulls search terms, and rewrites the listing
              </p>
            </div>
          </div>

          {/* ASIN / SKU inputs + Fetch */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <input value={asin} onChange={e => setAsin(e.target.value.toUpperCase())}
              placeholder="ASIN  (e.g. B0C…)" style={{ ...inputSt, width: 170 }}
              onFocus={e => e.target.style.borderColor = '#8B5CF6'}
              onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'}
              onKeyDown={e => e.key === 'Enter' && handleFetch()} />
            <span style={{ color: '#1E293B', fontSize: 12, fontWeight: 600 }}>or</span>
            <input value={sku} onChange={e => setSku(e.target.value)}
              placeholder="SKU" style={{ ...inputSt, width: 140 }}
              onFocus={e => e.target.style.borderColor = '#8B5CF6'}
              onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'}
              onKeyDown={e => e.key === 'Enter' && handleFetch()} />

            <button onClick={handleFetch} disabled={isFetching || (!asin.trim() && !sku.trim())}
              style={{
                display: 'flex', alignItems: 'center', gap: 7, padding: '9px 20px',
                borderRadius: 10, border: 'none',
                cursor: isFetching || (!asin.trim() && !sku.trim()) ? 'not-allowed' : 'pointer',
                background: isFetching ? 'rgba(255,255,255,0.07)' : 'linear-gradient(135deg,#8B5CF6,#3B82F6)',
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
                borderRadius: 10, border: `1px dashed ${uploadedKeywords.length > 0 ? 'rgba(167,139,250,0.4)' : 'rgba(255,255,255,0.1)'}`,
                background: uploadedKeywords.length > 0 ? 'rgba(167,139,250,0.08)' : 'transparent',
                cursor: isParsingFile ? 'not-allowed' : 'pointer',
                color: uploadedKeywords.length > 0 ? '#A78BFA' : '#475569',
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
                style={{ fontSize: 11, padding: '4px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: '#475569', cursor: 'pointer' }}>
                ✕ Clear
              </button>
            )}
          </div>

          {/* Load product-specific search terms */}
          {hasFetched && (sku.trim() || fetchedAsin) && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: '#334155', fontWeight: 600 }}>Search terms:</span>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} max={dateTo}
                style={{ ...inputSt, fontSize: 11, padding: '6px 10px' }} />
              <span style={{ color: '#1E293B', fontSize: 12 }}>→</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} min={dateFrom} max={today}
                style={{ ...inputSt, fontSize: 11, padding: '6px 10px' }} />
              <button onClick={handleLoadProductTerms} disabled={!canLoadTerms}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 9, border: 'none',
                  cursor: canLoadTerms ? 'pointer' : 'not-allowed',
                  background: isLoadingTerms ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg,#10B981,#3B82F6)',
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
        <div style={{ background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.25)', color: '#F87171', borderRadius: 12, padding: '12px 16px', fontSize: 13 }}>
          {error}
        </div>
      )}
      {termsMessage && (
        <div style={{
          background: termsMessage.type === 'success' ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)',
          border: `1px solid ${termsMessage.type === 'success' ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.25)'}`,
          color: termsMessage.type === 'success' ? '#34D399' : '#FCD34D',
          borderRadius: 12, padding: '10px 16px', fontSize: 12,
        }}>
          {termsMessage.type === 'success' ? '✓' : '⚠'} {termsMessage.text}
        </div>
      )}
      {hasFetched && activeTerms.length === 0 && !isLoadingTerms && !termsMessage && (
        <div style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)', color: '#FCD34D', borderRadius: 12, padding: '10px 16px', fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <svg style={{ width: 14, height: 14, flexShrink: 0 }} fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
          </svg>
          Click "Load Search Terms for this Product" above for best keyword results. You can still optimize without them.
        </div>
      )}

      {/* ══ LISTING QUALITY BREAKDOWN ══ */}
      {hasFetched && listingDimensions.length > 0 && (
        <div style={{ ...glass, padding: '18px 22px', borderColor: listingScore >= 85 ? 'rgba(16,185,129,0.2)' : listingScore >= 70 ? 'rgba(245,158,11,0.2)' : 'rgba(244,63,94,0.2)' }}>
          <GradientBar top={listingScore >= 85 ? 'linear-gradient(90deg,#10B981,#3B82F6)' : listingScore >= 70 ? 'linear-gradient(90deg,#F59E0B,#EF4444)' : 'linear-gradient(90deg,#EF4444,#8B5CF6)'} />
          <div style={{ position: 'relative' }}>
            <p style={{ fontSize: 10, fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 14px' }}>
              Listing Quality Breakdown
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {listingDimensions.map(dim => {
                const dimColor = dim.score >= 85 ? '#10B981' : dim.score >= 60 ? '#F59E0B' : '#EF4444';
                const dimBg    = dim.score >= 85 ? 'rgba(16,185,129,0.08)' : dim.score >= 60 ? 'rgba(245,158,11,0.08)' : 'rgba(244,63,94,0.08)';
                return (
                  <div key={dim.name} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 36px', gap: 10, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8' }}>{dim.name}</span>
                    <div style={{ position: 'relative', height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ width: `${dim.score}%`, height: '100%', background: `linear-gradient(90deg,${dimColor}99,${dimColor})`, borderRadius: 99, transition: 'width 0.8s ease' }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 800, color: dimColor, textAlign: 'right' }}>{dim.score}</span>
                  </div>
                );
              })}
            </div>
            {listingDimensions.some(d => d.score < 60) && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 5 }}>
                <p style={{ fontSize: 10, fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>Issues to fix</p>
                {listingDimensions.filter(d => d.score < 60).map(d => (
                  <p key={d.name} style={{ fontSize: 11, color: '#F87171', margin: 0 }}>
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
            gradient="linear-gradient(135deg,#A78BFA,#7C3AED)" glow="rgba(167,139,250,0.5)" accentColor="#A78BFA"
            icon={<svg width="19" height="19" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>}
          />
          <StatCard
            label="Scale Up Terms" value={scaleUpCount || '—'}
            sub="High-performance keywords"
            gradient="linear-gradient(135deg,#10B981,#059669)" glow="rgba(16,185,129,0.5)" accentColor="#10B981"
            spark={keywordSpark}
            icon={<svg width="19" height="19" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>}
          />
          <StatCard
            label="Add Exact Terms" value={exactCount || '—'}
            sub="Target conversion keywords"
            gradient="linear-gradient(135deg,#3B82F6,#2563EB)" glow="rgba(59,130,246,0.5)" accentColor="#3B82F6"
            icon={<svg width="19" height="19" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>}
          />
          <StatCard
            label="Total Keywords" value={totalKeywords || '—'}
            sub={optimized ? '✓ Listing optimized' : 'Ready to optimize'}
            gradient="linear-gradient(135deg,#8B5CF6,#6366F1)" glow="rgba(139,92,246,0.5)" accentColor="#8B5CF6"
            icon={<svg width="19" height="19" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>}
          />
          <StatCard
            label="AI Model" value={aiModel === 'claude' ? 'Claude' : 'Gemini'}
            sub={aiModel === 'claude' ? 'Sonnet 4.5' : '2.5 Flash'}
            gradient="linear-gradient(135deg,#F59E0B,#D97706)" glow="rgba(245,158,11,0.5)" accentColor="#F59E0B"
            icon={<svg width="19" height="19" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>}
          />
        </div>
      )}

      {/* ══ KEYWORD PILLS ══ */}
      {uploadedKeywords.length > 0 && (
        <div style={{ ...glass, padding: '18px 22px', borderColor: 'rgba(167,139,250,0.2)' }}>
          <GradientBar top="linear-gradient(90deg,#A78BFA,#7C3AED)" />
          <GlowBlob color="rgba(167,139,250,0.2)" />
          <div style={{ position: 'relative' }}>
            <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#A78BFA' }}>
              ★ Priority Keywords ({uploadedKeywords.length}) — AI uses these first
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {uploadedKeywords.slice(0, 60).map((kw, i) => <Pill key={i} text={kw} color="#A78BFA" />)}
              {uploadedKeywords.length > 60 && <span style={{ fontSize: 11, color: '#475569', padding: '3px 0' }}>+{uploadedKeywords.length - 60} more</span>}
            </div>
          </div>
        </div>
      )}

      {relevantTerms.length > 0 && (
        <div style={{ ...glass, padding: '18px 22px' }}>
          <GradientBar top="linear-gradient(90deg,#10B981,#3B82F6)" />
          <GlowBlob color="rgba(16,185,129,0.15)" />
          <div style={{ position: 'relative' }}>
            <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#334155' }}>
              Campaign Keywords ({relevantTerms.length})
              {productSearchTerms.length > 0 && <span style={{ color: '#10B981', marginLeft: 8, fontWeight: 600 }}>· product-specific</span>}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {relevantTerms.slice(0, 50).map((t, i) => (
                <Pill key={i} text={t.searchTerm} color={t.recommendation === 'SCALE_UP' ? '#10B981' : '#3B82F6'} />
              ))}
              {relevantTerms.length > 50 && <span style={{ fontSize: 11, color: '#475569', padding: '3px 0' }}>+{relevantTerms.length - 50} more</span>}
            </div>
          </div>
        </div>
      )}

      {/* ══ SIDE-BY-SIDE EDITOR ══ */}
      {hasFetched && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

          {/* LEFT — Current (editable) */}
          <div style={{ ...glass, padding: 0, overflow: 'hidden' }}>
            <GradientBar top="linear-gradient(90deg,#3B82F6,#6366F1)" />
            <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#334155' }}>Current Listing</p>
            </div>
            <div style={{ padding: '16px 18px' }}>
              <FieldRow label="Title" chars={title} limit={CHAR_LIMIT.title}>
                <textarea value={title} onChange={e => setTitle(e.target.value)} rows={3} style={taSt(false)}
                  onFocus={e => e.target.style.borderColor = '#3B82F6'}
                  onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'} />
              </FieldRow>
              {bullets.map((b, i) => (
                <FieldRow key={i} label={`Bullet ${i + 1}`} chars={b} limit={CHAR_LIMIT.bullet}>
                  <textarea value={b} onChange={e => setBullet(i, e.target.value)} rows={2} style={taSt(false)}
                    onFocus={e => e.target.style.borderColor = '#3B82F6'}
                    onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'} />
                </FieldRow>
              ))}
              <FieldRow label="Description" chars={description} limit={CHAR_LIMIT.description}>
                <textarea value={description} onChange={e => setDescription(e.target.value)} rows={6} style={taSt(false)}
                  onFocus={e => e.target.style.borderColor = '#3B82F6'}
                  onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'} />
              </FieldRow>
            </div>
          </div>

          {/* RIGHT — Optimized */}
          <div style={{ ...glass, padding: 0, overflow: 'hidden', borderColor: optimized ? 'rgba(139,92,246,0.25)' : 'rgba(255,255,255,0.06)', boxShadow: optimized ? '0 4px 40px rgba(139,92,246,0.15)' : 'none' }}>
            {optimized && <GradientBar top="linear-gradient(90deg,#8B5CF6,#3B82F6,#10B981)" />}
            <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.05)', background: optimized ? 'rgba(139,92,246,0.06)' : 'transparent' }}>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: optimized ? '#A78BFA' : '#334155' }}>
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

                  {/* Copy All */}
                  <button onClick={() => navigator.clipboard.writeText(
                    `TITLE:\n${optimized.title}\n\nBULLETS:\n${(optimized.bullets ?? []).map((b, i) => `${i+1}. ${b}`).join('\n')}\n\nDESCRIPTION:\n${optimized.description}`
                  )} style={{
                    width: '100%', marginBottom: 10, padding: '8px', borderRadius: 9,
                    border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)',
                    color: '#64748B', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                    onMouseEnter={e => { e.target.style.background = 'rgba(255,255,255,0.06)'; e.target.style.color = '#94A3B8'; }}
                    onMouseLeave={e => { e.target.style.background = 'rgba(255,255,255,0.03)'; e.target.style.color = '#64748B'; }}>
                    Copy All
                  </button>

                  {/* Publish section */}
                  {(sku.trim() || fetchedSku) && (
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 12 }}>
                      <div style={{ marginBottom: 8 }}>
                        <label style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: fetchedProductType ? '#475569' : '#F59E0B' }}>
                          Product Type {!fetchedProductType && <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>— enter manually</span>}
                        </label>
                        <input value={fetchedProductType} onChange={e => setFetchedProductType(e.target.value.toUpperCase())}
                          placeholder="e.g. HOME_FURNISHINGS"
                          style={{ ...inputSt, width: '100%', marginTop: 5, fontSize: 12, boxSizing: 'border-box',
                            borderColor: fetchedProductType ? 'rgba(255,255,255,0.08)' : 'rgba(245,158,11,0.4)' }}
                          onFocus={e => e.target.style.borderColor = '#8B5CF6'}
                          onBlur={e => e.target.style.borderColor = fetchedProductType ? 'rgba(255,255,255,0.08)' : 'rgba(245,158,11,0.4)'} />
                      </div>

                      <button onClick={() => setConfirmPublish(true)} disabled={isPublishing || !fetchedProductType}
                        style={{
                          width: '100%', padding: '10px', borderRadius: 10, border: 'none',
                          cursor: (isPublishing || !fetchedProductType) ? 'not-allowed' : 'pointer',
                          background: (isPublishing || !fetchedProductType) ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg,#10B981,#059669)',
                          color: '#fff', fontWeight: 700, fontSize: 13,
                          boxShadow: (!isPublishing && fetchedProductType) ? '0 4px 18px rgba(16,185,129,0.4)' : 'none',
                          opacity: (isPublishing || !fetchedProductType) ? 0.5 : 1,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                        }}>
                        {isPublishing ? <><Spinner /> Publishing…</> : '↑ Publish to Amazon'}
                      </button>

                      {confirmPublish && (
                        <div style={{ marginTop: 10, background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 10, padding: '12px 14px', fontSize: 12, color: '#FCD34D' }}>
                          <p style={{ margin: '0 0 10px', fontWeight: 600 }}>
                            This will overwrite the live listing for SKU: <strong>{sku.trim() || fetchedSku}</strong>
                          </p>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={() => { setConfirmPublish(false); handlePublish(); }}
                              style={{ padding: '6px 16px', borderRadius: 7, border: 'none', background: '#10B981', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
                              Yes, publish
                            </button>
                            <button onClick={() => setConfirmPublish(false)}
                              style={{ padding: '6px 16px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#64748B', cursor: 'pointer', fontSize: 12 }}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {publishResult?.ok && (
                        <div style={{ marginTop: 10, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#34D399' }}>
                          ✓ Listing published successfully.
                          {publishResult.issues.length > 0 && (
                            <span style={{ color: '#FCD34D', display: 'block', marginTop: 4 }}>
                              Warnings: {publishResult.issues.map(i => i.message).join('; ')}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 12, color: '#1E293B' }}>
                  <div style={{ width: 64, height: 64, borderRadius: 20, background: 'linear-gradient(135deg,#8B5CF620,#3B82F620)', border: '1px solid rgba(139,92,246,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg style={{ width: 28, height: 28, color: '#8B5CF6', opacity: 0.5 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z"/>
                    </svg>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: '#334155' }}>Click "Optimize Listing" to generate</p>
                </div>
              )}
            </div>
          </div>
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
              background: isOptimizing ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg,#8B5CF6,#3B82F6)',
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
