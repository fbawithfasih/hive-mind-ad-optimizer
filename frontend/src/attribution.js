/**
 * First-touch attribution.
 *
 * On the first page this browser opens, remember how it got here — utm_*
 * parameters, a partner's ?ref= code, the plan chosen on the marketing site,
 * the landing path, and the referrer — and hand that to the server at
 * signup. First touch, not last: the value is kept only if nothing is stored
 * yet, so a return visit from a bookmark does not overwrite the YouTube video
 * that actually brought them.
 *
 * Storage may be unavailable (private mode, blocked site data). Every access
 * is wrapped, and the app renders identically with nothing captured.
 */

export const ATTRIBUTION_KEY = 'hmn.attribution';

const PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'plan'];

/** Capture the first touch, if this browser has none. Safe to call on every load. */
export function captureAttribution({ search = window.location.search, path = window.location.pathname, referrer = document.referrer } = {}) {
  try {
    if (localStorage.getItem(ATTRIBUTION_KEY)) return;
    const params = new URLSearchParams(search);
    const out = {};
    for (const k of PARAMS) {
      const v = params.get(k);
      if (v) out[k] = v.slice(0, 200);
    }
    if (referrer) {
      try { out.referrer = new URL(referrer).host.slice(0, 200); } catch { /* not a URL */ }
    }
    // Landing path is worth keeping even with no parameters — "/pricing" and
    // "/" are different first impressions — but only when something arrived
    // with it; a bare "/" with nothing else is not attribution.
    if (Object.keys(out).length && path) out.landing = path.slice(0, 200);
    if (!Object.keys(out).length) return;
    localStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(out));
  } catch { /* storage unavailable */ }
}

/** What was captured, or null. */
export function readAttribution() {
  try {
    const raw = localStorage.getItem(ATTRIBUTION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
