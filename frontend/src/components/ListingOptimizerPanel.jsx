import React, { useState, useMemo } from 'react';
import { lookupProduct, optimizeListingApi, getSearchTermsForProduct, publishListing } from '../services/api.js';

const today        = new Date().toISOString().slice(0, 10);
const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
const CHAR_LIMIT = { title: 200, bullet: 255, description: 2000 };

function CharCount({ value, limit }) {
  const len = (value ?? '').length;
  const over = len > limit;
  return (
    <span style={{ fontSize: 10, color: over ? '#F43F5E' : '#64748B', marginLeft: 6 }}>
      {len}/{limit}
    </span>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text ?? ''); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, border: `1px solid ${copied ? '#10B981' : '#334155'}`,
        background: 'transparent', cursor: 'pointer', color: copied ? '#10B981' : '#64748B', transition: 'all .15s' }}>
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}

function FieldLabel({ label, chars, limit, children }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#94A3B8' }}>{label}</span>
        {chars != null && <CharCount value={chars} limit={limit} />}
      </div>
      {children}
    </div>
  );
}

const taStyle = (readOnly) => ({
  width: '100%', background: readOnly ? '#0F172A' : '#263348',
  border: `1px solid ${readOnly ? '#1E293B' : '#334155'}`,
  borderRadius: 8, color: readOnly ? '#CBD5E1' : '#F1F5F9',
  padding: '10px 12px', fontSize: 12, resize: 'vertical',
  outline: 'none', lineHeight: 1.6, fontFamily: 'inherit',
  boxSizing: 'border-box',
});

const inputStyle = {
  background: '#263348', border: '1px solid #334155', color: '#F1F5F9',
  borderRadius: 8, padding: '9px 13px', fontSize: 13, outline: 'none',
};

export default function ListingOptimizerPanel({ profileId, searchTerms = [], aiModel = 'gemini' }) {
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

  // Date range for search term loading
  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo]     = useState(today);

  // Current (editable) listing
  const [title, setTitle]             = useState('');
  const [bullets, setBullets]         = useState(['', '', '', '', '']);
  const [description, setDescription] = useState('');
  const [fetchedAsin, setFetchedAsin]         = useState('');
  const [fetchedSku, setFetchedSku]           = useState('');
  const [fetchedProductType, setFetchedProductType] = useState('');
  const [hasFetched, setHasFetched]   = useState(true);

  // Product-specific search terms (loaded via "Load Search Terms for this Product")
  const [productSearchTerms, setProductSearchTerms] = useState([]);

  // Merge: product-specific terms take priority; fall back to passed-in terms
  const activeTerms = productSearchTerms.length > 0 ? productSearchTerms : searchTerms;

  // Optimized result
  const [optimized, setOptimized] = useState(null);

  // Filter to SCALE_UP + ADD_EXACT terms
  const relevantTerms = useMemo(() =>
    activeTerms.filter(t => t.recommendation === 'SCALE_UP' || t.recommendation === 'ADD_EXACT'),
    [activeTerms]
  );

  async function handleFetch() {
    if (!asin.trim() && !sku.trim()) return;
    setIsFetching(true); setError(null); setOptimized(null);
    setProductSearchTerms([]); setTermsMessage(null);
    setPublishResult(null); setConfirmPublish(false);
    try {
      const p = await lookupProduct(asin.trim() || undefined, sku.trim() || undefined);
      setTitle(p.title ?? '');
      setBullets(Array.from({ length: 5 }, (_, i) => p.bullets?.[i] ?? ''));
      setDescription(p.description ?? '');
      setFetchedAsin(p.asin ?? asin.trim());
      setFetchedSku(p.sku ?? '');
      setFetchedProductType(p.productType ?? '');
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
        sku: skuToUse,
        productType: fetchedProductType,
        title: optimized.title,
        bullets: optimized.bullets.filter(Boolean),
        description: optimized.description,
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
        sku:  skuVal  || undefined,
        asin: asinVal || undefined,
        startDate: dateFrom,
        endDate:   dateTo,
      });
      const terms = Array.isArray(data.searchTerms) ? data.searchTerms : [];
      setProductSearchTerms(terms);
      if (data.message) {
        setTermsMessage({ type: 'warn', text: data.message });
      } else {
        const scaleUp = terms.filter(t => t.recommendation === 'SCALE_UP').length;
        const addExact = terms.filter(t => t.recommendation === 'ADD_EXACT').length;
        setTermsMessage({
          type: 'success',
          text: `Loaded ${terms.length} search terms from ${data.filteredByCampaigns} campaign(s) · ${scaleUp} Scale Up · ${addExact} Add Exact`,
        });
      }
    } catch (err) {
      setError('Failed to load search terms: ' + (err.response?.data?.error ?? err.message));
    } finally {
      setIsLoadingTerms(false);
    }
  }

  async function handleOptimize() {
    setIsOptimizing(true); setError(null); setOptimized(null);
    try {
      const result = await optimizeListingApi({
        asin: fetchedAsin,
        title,
        bullets: bullets.filter(Boolean),
        description,
        searchTerms: relevantTerms,
        model: aiModel,
      });
      const normalizedBullets = Array.from({ length: 5 }, (_, i) => result.bullets?.[i] ?? '');
      setOptimized({ ...result, bullets: normalizedBullets });
    } catch (err) {
      setError(err.response?.data?.error ?? err.message ?? 'Optimization failed');
    } finally {
      setIsOptimizing(false);
    }
  }

  const setBullet = (i, val) => setBullets(prev => prev.map((b, idx) => idx === i ? val : b));

  const colHeader = (label, color) => (
    <div style={{ padding: '10px 16px', borderBottom: '1px solid #334155', background: color }}>
      <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94A3B8' }}>{label}</span>
    </div>
  );

  const canLoadTerms = (sku.trim() || fetchedAsin) && !isLoadingTerms;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Header / Fetch row ── */}
      <div style={{ background: '#1E293B', border: '1px solid #334155', borderRadius: 12, padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <p style={{ margin: 0, fontWeight: 600, color: '#F1F5F9' }}>Listing Optimizer</p>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: '#94A3B8' }}>
              Fetch by ASIN/SKU — AI finds your campaigns, pulls search terms, and rewrites the listing.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input value={asin} onChange={e => setAsin(e.target.value.toUpperCase())}
              placeholder="ASIN (e.g. B0C...)" style={{ ...inputStyle, width: 160 }}
              onFocus={e => e.target.style.borderColor = '#3B82F6'}
              onBlur={e => e.target.style.borderColor = '#334155'}
              onKeyDown={e => e.key === 'Enter' && handleFetch()}
            />
            <span style={{ color: '#475569', fontSize: 12 }}>or</span>
            <input value={sku} onChange={e => setSku(e.target.value)}
              placeholder="SKU" style={{ ...inputStyle, width: 140 }}
              onFocus={e => e.target.style.borderColor = '#3B82F6'}
              onBlur={e => e.target.style.borderColor = '#334155'}
              onKeyDown={e => e.key === 'Enter' && handleFetch()}
            />
            <button onClick={handleFetch} disabled={isFetching || (!asin.trim() && !sku.trim())}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '9px 16px', borderRadius: 8, border: 'none',
                cursor: isFetching || (!asin.trim() && !sku.trim()) ? 'not-allowed' : 'pointer',
                background: isFetching ? '#334155' : 'linear-gradient(135deg,#3B82F6,#8B5CF6)',
                color: '#fff', fontWeight: 600, fontSize: 13,
                opacity: (!asin.trim() && !sku.trim()) ? 0.4 : 1,
                whiteSpace: 'nowrap',
              }}>
              {isFetching ? (
                <>
                  <svg style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} fill="none" viewBox="0 0 24 24">
                    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                    <circle style={{ opacity: .25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path style={{ opacity: .75 }} fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  Fetching…
                </>
              ) : (
                <>
                  <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                  </svg>
                  Fetch Listing
                </>
              )}
            </button>
          </div>
        </div>

        {/* ── Load Search Terms for this Product ── */}
        {hasFetched && (sku.trim() || fetchedAsin) && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #1E293B', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: '#64748B' }}>Search term date range:</span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} max={dateTo}
              style={{ ...inputStyle, fontSize: 12, padding: '6px 10px' }} />
            <span style={{ color: '#475569', fontSize: 12 }}>→</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} min={dateFrom} max={today}
              style={{ ...inputStyle, fontSize: 12, padding: '6px 10px' }} />
            <button onClick={handleLoadProductTerms} disabled={!canLoadTerms}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', borderRadius: 8, border: 'none',
                cursor: canLoadTerms ? 'pointer' : 'not-allowed',
                background: isLoadingTerms ? '#334155' : 'linear-gradient(135deg,#10B981,#3B82F6)',
                color: '#fff', fontWeight: 600, fontSize: 12,
                opacity: canLoadTerms ? 1 : 0.5, whiteSpace: 'nowrap',
              }}>
              {isLoadingTerms ? (
                <>
                  <svg style={{ width: 13, height: 13, animation: 'spin 1s linear infinite' }} fill="none" viewBox="0 0 24 24">
                    <circle style={{ opacity: .25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path style={{ opacity: .75 }} fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  Finding campaigns… (~60s)
                </>
              ) : (
                <>
                  <svg style={{ width: 13, height: 13 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
                  </svg>
                  Load Search Terms for this Product
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{ background: '#F43F5E18', border: '1px solid #F43F5E44', color: '#F43F5E', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* ── Terms load status message ── */}
      {termsMessage && (
        <div style={{
          background: termsMessage.type === 'success' ? '#10B98110' : '#F59E0B10',
          border: `1px solid ${termsMessage.type === 'success' ? '#10B98140' : '#F59E0B40'}`,
          color: termsMessage.type === 'success' ? '#10B981' : '#F59E0B',
          borderRadius: 8, padding: '10px 14px', fontSize: 12,
        }}>
          {termsMessage.text}
        </div>
      )}

      {/* ── No search terms notice (only if product fetched and no terms loaded) ── */}
      {hasFetched && activeTerms.length === 0 && !isLoadingTerms && !termsMessage && (
        <div style={{ background: '#F59E0B10', border: '1px solid #F59E0B40', color: '#F59E0B', borderRadius: 8, padding: '10px 14px', fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <svg style={{ width: 14, height: 14, flexShrink: 0 }} fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
          </svg>
          Click "Load Search Terms for this Product" above for best keyword results. You can still optimize without them.
        </div>
      )}

      {/* ── Keyword pills ── */}
      {relevantTerms.length > 0 && (
        <div style={{ background: '#1E293B', border: '1px solid #334155', borderRadius: 10, padding: '12px 16px' }}>
          <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#64748B' }}>
            Keywords for optimization ({relevantTerms.length} terms — SCALE_UP + ADD_EXACT)
            {productSearchTerms.length > 0 && <span style={{ color: '#10B981', marginLeft: 8, fontWeight: 500 }}>· product-specific</span>}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {relevantTerms.slice(0, 40).map((t, i) => (
              <span key={i} style={{
                fontSize: 11, padding: '3px 9px', borderRadius: 999, fontWeight: 500,
                background: t.recommendation === 'SCALE_UP' ? '#10B98118' : '#3B82F618',
                color: t.recommendation === 'SCALE_UP' ? '#10B981' : '#3B82F6',
                border: `1px solid ${t.recommendation === 'SCALE_UP' ? '#10B98140' : '#3B82F640'}`,
              }}>
                {t.searchTerm}
              </span>
            ))}
            {relevantTerms.length > 40 && (
              <span style={{ fontSize: 11, color: '#64748B', padding: '3px 0' }}>+{relevantTerms.length - 40} more</span>
            )}
          </div>
        </div>
      )}

      {/* ── Side-by-side editor ── */}
      {hasFetched && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

          {/* LEFT — Current (editable) */}
          <div style={{ background: '#1E293B', border: '1px solid #334155', borderRadius: 12, overflow: 'hidden' }}>
            {colHeader('Current Listing', '#1E293B')}
            <div style={{ padding: '16px' }}>
              <FieldLabel label="Title" chars={title} limit={CHAR_LIMIT.title}>
                <textarea value={title} onChange={e => setTitle(e.target.value)}
                  rows={3} style={taStyle(false)} />
              </FieldLabel>
              {bullets.map((b, i) => (
                <FieldLabel key={i} label={`Bullet ${i + 1}`} chars={b} limit={CHAR_LIMIT.bullet}>
                  <textarea value={b} onChange={e => setBullet(i, e.target.value)}
                    rows={2} style={taStyle(false)} />
                </FieldLabel>
              ))}
              <FieldLabel label="Description" chars={description} limit={CHAR_LIMIT.description}>
                <textarea value={description} onChange={e => setDescription(e.target.value)}
                  rows={6} style={taStyle(false)} />
              </FieldLabel>
            </div>
          </div>

          {/* RIGHT — Optimized (readonly) */}
          <div style={{ background: '#1E293B', border: '1px solid #8B5CF640', borderRadius: 12, overflow: 'hidden' }}>
            {colHeader(
              optimized ? 'AI-Optimized Listing' : 'Optimized Listing',
              optimized ? 'linear-gradient(90deg,#8B5CF614,#3B82F614)' : '#1E293B'
            )}
            <div style={{ padding: '16px' }}>
              {optimized ? (
                <>
                  <FieldLabel label="Title">
                    <div style={{ position: 'relative' }}>
                      <textarea value={optimized.title ?? ''} readOnly rows={3} style={taStyle(true)} />
                      <div style={{ position: 'absolute', top: 6, right: 8 }}><CopyButton text={optimized.title} /></div>
                    </div>
                  </FieldLabel>
                  {(optimized.bullets ?? []).map((b, i) => (
                    <FieldLabel key={i} label={`Bullet ${i + 1}`}>
                      <div style={{ position: 'relative' }}>
                        <textarea value={b} readOnly rows={2} style={taStyle(true)} />
                        <div style={{ position: 'absolute', top: 6, right: 8 }}><CopyButton text={b} /></div>
                      </div>
                    </FieldLabel>
                  ))}
                  <FieldLabel label="Description">
                    <div style={{ position: 'relative' }}>
                      <textarea value={optimized.description ?? ''} readOnly rows={6} style={taStyle(true)} />
                      <div style={{ position: 'absolute', top: 6, right: 8 }}><CopyButton text={optimized.description} /></div>
                    </div>
                  </FieldLabel>
                  <button
                    onClick={() => {
                      const all = [
                        `TITLE:\n${optimized.title}`,
                        `\nBULLETS:\n${(optimized.bullets ?? []).map((b, i) => `${i + 1}. ${b}`).join('\n')}`,
                        `\nDESCRIPTION:\n${optimized.description}`,
                      ].join('\n');
                      navigator.clipboard.writeText(all);
                    }}
                    style={{
                      width: '100%', marginTop: 4, padding: '8px', borderRadius: 8,
                      border: '1px solid #334155', background: 'transparent',
                      color: '#94A3B8', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}>
                    Copy All
                  </button>

                  {/* Publish to Amazon — only when a SKU is known */}
                  {(sku.trim() || fetchedSku) && (
                    <>
                      <button
                        onClick={() => setConfirmPublish(true)}
                        disabled={isPublishing}
                        style={{
                          width: '100%', marginTop: 8, padding: '9px', borderRadius: 8,
                          border: 'none', cursor: isPublishing ? 'not-allowed' : 'pointer',
                          background: isPublishing ? '#334155' : 'linear-gradient(135deg,#10B981,#059669)',
                          color: '#fff', fontWeight: 700, fontSize: 12,
                          opacity: isPublishing ? 0.7 : 1,
                        }}>
                        {isPublishing ? (
                          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                            <svg style={{ width: 13, height: 13, animation: 'spin 1s linear infinite' }} fill="none" viewBox="0 0 24 24">
                              <circle style={{ opacity: .25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                              <path style={{ opacity: .75 }} fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                            </svg>
                            Publishing…
                          </span>
                        ) : 'Publish to Amazon'}
                      </button>

                      {confirmPublish && (
                        <div style={{
                          marginTop: 8, background: '#F59E0B10', border: '1px solid #F59E0B60',
                          borderRadius: 8, padding: '12px 14px', fontSize: 12, color: '#F59E0B',
                        }}>
                          <p style={{ margin: '0 0 8px', fontWeight: 600 }}>
                            This will overwrite the live listing for SKU: <strong>{sku.trim() || fetchedSku}</strong>
                          </p>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              onClick={() => { setConfirmPublish(false); handlePublish(); }}
                              style={{ padding: '5px 14px', borderRadius: 6, border: 'none',
                                background: '#10B981', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
                              Yes, publish
                            </button>
                            <button
                              onClick={() => setConfirmPublish(false)}
                              style={{ padding: '5px 14px', borderRadius: 6, border: '1px solid #334155',
                                background: 'transparent', color: '#94A3B8', cursor: 'pointer', fontSize: 12 }}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {publishResult?.ok && (
                        <div style={{
                          marginTop: 8, background: '#10B98110', border: '1px solid #10B98140',
                          borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#10B981',
                        }}>
                          Listing published successfully.
                          {publishResult.issues.length > 0 && (
                            <span style={{ color: '#F59E0B', display: 'block', marginTop: 4 }}>
                              Warnings: {publishResult.issues.map(i => i.message).join('; ')}
                            </span>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 10, color: '#475569' }}>
                  <svg style={{ width: 36, height: 36, opacity: .3 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z"/>
                  </svg>
                  <p style={{ margin: 0, fontSize: 13 }}>Click "Optimize Listing" to generate</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Optimize button ── */}
      {hasFetched && (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <button onClick={handleOptimize} disabled={isOptimizing}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '12px 32px', borderRadius: 10, border: 'none',
              cursor: isOptimizing ? 'not-allowed' : 'pointer',
              background: isOptimizing ? '#334155' : 'linear-gradient(135deg,#8B5CF6,#3B82F6)',
              color: '#fff', fontWeight: 700, fontSize: 14,
              opacity: isOptimizing ? 0.7 : 1,
            }}>
            {isOptimizing ? (
              <>
                <svg style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} fill="none" viewBox="0 0 24 24">
                  <circle style={{ opacity: .25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path style={{ opacity: .75 }} fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                Optimizing with {aiModel === 'claude' ? 'Claude Sonnet' : 'Gemini 2.5 Flash'}…
              </>
            ) : (
              <>
                <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z"/>
                </svg>
                Optimize Listing {relevantTerms.length > 0 ? `(${relevantTerms.length} keywords)` : ''}
              </>
            )}
          </button>
        </div>
      )}

    </div>
  );
}
