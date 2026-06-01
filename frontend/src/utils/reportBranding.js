/**
 * Single source of truth for branding applied to every downloadable report.
 * Use this helper from any export path (CSV, PDF, print-to-PDF) so the logo
 * and confidentiality notice stay consistent.
 */

export const BRAND_NAME       = 'Hive Mind Nestor';
export const BRAND_TAGLINE    = 'Amazon Advertising Intelligence';
export const BRAND_URL        = 'https://www.hivemindnestor.com';
export const BRAND_LOGO_URL   = '/HMN-APP-ICON.png';
export const CONFIDENTIAL_TXT =
  'CONFIDENTIAL — This report contains proprietary advertising data. ' +
  'Do not distribute, copy, or share outside the recipient organization.';

// ── CSV ──────────────────────────────────────────────────────────────────────

/**
 * Lines to prepend to a CSV file, before the header row. Spreadsheet apps
 * render them as the first few rows of the document.
 *
 * @param {{ title?: string, subtitle?: string }} [meta]
 * @returns {string[]}
 */
export function csvBrandingLines({ title, subtitle } = {}) {
  return [
    `# ${BRAND_NAME} — ${BRAND_TAGLINE}`,
    `# ${BRAND_URL}`,
    title    ? `# ${title}`    : null,
    subtitle ? `# ${subtitle}` : null,
    `# Generated: ${new Date().toISOString()}`,
    `# ${CONFIDENTIAL_TXT}`,
    '',
  ].filter(l => l !== null);
}

// ── PDF (jsPDF) ──────────────────────────────────────────────────────────────

let _logoDataUrlPromise = null;
function loadLogoDataUrl() {
  if (_logoDataUrlPromise) return _logoDataUrlPromise;
  _logoDataUrlPromise = fetch(BRAND_LOGO_URL)
    .then(r => r.blob())
    .then(blob => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    }))
    .catch(() => null);
  return _logoDataUrlPromise;
}

/**
 * Stamp a jsPDF document with header (logo + brand) and footer (confidential)
 * on every page. Call AFTER autoTable so all pages exist.
 *
 * @param {import('jspdf').jsPDF} doc
 * @param {{ title?: string, subtitle?: string }} [meta]
 */
export async function addPdfBranding(doc, { title, subtitle } = {}) {
  const logoDataUrl = await loadLogoDataUrl();
  const pageCount   = doc.internal.getNumberOfPages();
  const pageWidth   = doc.internal.pageSize.getWidth();
  const pageHeight  = doc.internal.pageSize.getHeight();

  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);

    // Header band
    if (logoDataUrl) {
      try { doc.addImage(logoDataUrl, 'PNG', pageWidth - 22, 6, 12, 12); } catch { /* ignore */ }
    }
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(BRAND_NAME, pageWidth - 25, 12, { align: 'right' });
    doc.setFontSize(6);
    doc.text(BRAND_URL, pageWidth - 25, 16, { align: 'right' });

    // Footer band — confidential + page number
    doc.setFontSize(7);
    doc.setTextColor(244, 63, 94);
    doc.text(CONFIDENTIAL_TXT, 10, pageHeight - 8, { maxWidth: pageWidth - 40 });
    doc.setTextColor(148, 163, 184);
    doc.text(`Page ${i} / ${pageCount}`, pageWidth - 10, pageHeight - 8, { align: 'right' });
  }
}

// ── HTML (window.open + window.print) ────────────────────────────────────────

/**
 * Inline <style> block with print-friendly rules for the branding header,
 * footer, and watermark. Drop into the document's <head>.
 */
export function htmlBrandingStyles() {
  return `
    .hmn-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 0 16px; margin: 0 0 24px; border-bottom: 2px solid #e5e7eb;
    }
    .hmn-header img { width: 40px; height: 40px; border-radius: 8px; }
    .hmn-header .hmn-brand { font-weight: 800; font-size: 16px; color: #111827; }
    .hmn-header .hmn-tag   { font-size: 11px; color: #6b7280; }
    .hmn-confidential {
      margin: 24px 0 0; padding: 10px 14px;
      border: 1px solid #fecaca; background: #fef2f2;
      color: #b91c1c; font-size: 11px; font-weight: 600;
      border-radius: 6px;
    }
    .hmn-watermark {
      position: fixed; inset: 0; pointer-events: none;
      display: flex; align-items: center; justify-content: center;
      font-size: 96px; font-weight: 900; color: rgba(244, 63, 94, 0.06);
      transform: rotate(-30deg); letter-spacing: 12px; z-index: -1;
    }
    @media print {
      .hmn-header     { page-break-after: avoid; }
      .hmn-watermark  { display: flex; }
    }
  `;
}

/**
 * HTML fragment to render at the top of the printable body.
 *
 * @param {{ title?: string, subtitle?: string }} [meta]
 */
export function htmlBrandingHeader({ title, subtitle } = {}) {
  return `
    <div class="hmn-watermark">CONFIDENTIAL</div>
    <div class="hmn-header">
      <div style="display:flex;align-items:center;gap:12px;">
        <img src="${BRAND_LOGO_URL}" alt="${BRAND_NAME}">
        <div>
          <div class="hmn-brand">${BRAND_NAME}</div>
          <div class="hmn-tag">${BRAND_TAGLINE}</div>
        </div>
      </div>
      <div style="text-align:right;font-size:11px;color:#6b7280;">
        ${title ? `<div style="font-weight:700;color:#111827;">${title}</div>` : ''}
        ${subtitle ? `<div>${subtitle}</div>` : ''}
        <div>Generated ${new Date().toLocaleString()}</div>
      </div>
    </div>
  `;
}

export function htmlBrandingFooter() {
  return `<div class="hmn-confidential">${CONFIDENTIAL_TXT}</div>`;
}
