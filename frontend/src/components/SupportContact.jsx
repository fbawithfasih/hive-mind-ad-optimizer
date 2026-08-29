import { useState, useEffect, useCallback } from 'react';

export const SUPPORT_EMAIL = 'info@hivemindnestor.com';

/**
 * Support contact dialog.
 *
 * A bare `mailto:` link is a silent failure for anyone without a registered
 * mail handler — which is most people who read mail in a browser tab. The OS
 * accepts the handoff and nothing visibly happens, so the link reads as broken.
 *
 * This offers three routes instead, so at least one always works:
 *   - copy the address        (no dependencies at all)
 *   - open Gmail compose      (works for webmail users)
 *   - open the mail app       (the original mailto, for those who have one)
 */

const GMAIL_COMPOSE =
  `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(SUPPORT_EMAIL)}`;

/** Clipboard API needs a secure context; fall back to a temporary textarea. */
async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default function SupportContact({ open, onClose }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(SUPPORT_EMAIL);
    setCopied(ok ? 'yes' : 'no');
    setTimeout(() => setCopied(false), 2000);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => { if (!open) setCopied(false); }, [open]);

  if (!open) return null;

  const action = {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
    padding: '12px 14px', borderRadius: 10, marginBottom: 8,
    border: '1px solid rgba(255,255,255,0.09)', background: 'var(--overlay-2)',
    color: 'var(--text-strong)', fontSize: 13, fontWeight: 600,
    textDecoration: 'none', cursor: 'pointer', textAlign: 'left',
    fontFamily: 'inherit',
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'var(--scrim)', backdropFilter: 'blur(4px)' }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Contact support"
        style={{
          position: 'fixed', top: '22vh', left: '50%', transform: 'translateX(-50%)',
          zIndex: 301, width: 'min(92vw, 380px)',
          background: 'var(--surface-raised)', border: '1px solid rgba(255,255,255,0.09)',
          borderRadius: 16, padding: 22,
          boxShadow: '0 25px 60px rgba(0,0,0,0.55)',
        }}
      >
        <h2 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>
          Contact support
        </h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-subtle)', lineHeight: 1.6 }}>
          We usually reply within one business day.
        </p>

        <div style={{
          padding: '10px 12px', borderRadius: 10, marginBottom: 14,
          background: 'var(--overlay-3)', border: '1px solid rgba(255,255,255,0.09)',
          fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)',
          overflowWrap: 'anywhere',
        }}>
          {SUPPORT_EMAIL}
        </div>

        <button type="button" onClick={handleCopy} style={action}>
          {copied === 'yes' ? '✓ Copied to clipboard'
            : copied === 'no' ? 'Press ⌘C to copy'
            : 'Copy email address'}
        </button>

        <a href={GMAIL_COMPOSE} target="_blank" rel="noopener noreferrer" onClick={onClose} style={action}>
          Open in Gmail
        </a>

        <a href={`mailto:${SUPPORT_EMAIL}`} onClick={onClose} style={action}>
          Open in mail app
        </a>

        <button
          type="button"
          onClick={onClose}
          style={{
            ...action, marginBottom: 0, marginTop: 4, justifyContent: 'center',
            background: 'transparent', border: '1px solid transparent',
            color: 'var(--text-subtle)', fontWeight: 500,
          }}
        >
          Close
        </button>
      </div>
    </>
  );
}
