import { useEffect, useRef, useState } from 'react';
import { getUnreadCountApi, getAlertFiresApi } from '../services/api.js';

/**
 * Polls /api/alerts/unread-count every `intervalMs` and surfaces a banner
 * the first time the count rises (i.e. a new fire arrived since the last
 * poll). The banner stays sticky until the caller clears it (typically by
 * navigating to the alerts tab and marking fires read).
 *
 * Returns:
 *   unread   — current unread fires count
 *   banner   — { count, fires } when new fires arrived; null otherwise
 *   reset    — clear the banner + zero the local count (call after mark-read)
 */
export function useAlertPolling(intervalMs = 60_000) {
  const [unread, setUnread] = useState(0);
  const [banner, setBanner] = useState(null); // { count, fires }
  const prevCountRef = useRef(null); // null = haven't fetched yet
  const stoppedRef   = useRef(false);

  function reset() {
    setBanner(null);
    setUnread(0);
    prevCountRef.current = 0;
  }

  useEffect(() => {
    stoppedRef.current = false;

    async function tick() {
      if (stoppedRef.current) return;
      try {
        const { count } = await getUnreadCountApi();
        if (stoppedRef.current) return;
        setUnread(count ?? 0);

        // First poll just sets the baseline — don't pop a banner for fires
        // the user may have already seen on a previous session.
        const prev = prevCountRef.current;
        if (prev !== null && (count ?? 0) > prev) {
          // Pull the most recent unread fires for the banner detail.
          const newCount = (count ?? 0) - prev;
          getAlertFiresApi({ limit: Math.max(newCount, 5) })
            .then(rows => {
              if (stoppedRef.current) return;
              const unreadRows = (rows ?? []).filter(r => !r.isRead).slice(0, newCount);
              setBanner({
                count: newCount,
                fires: unreadRows.map(r => ({
                  alertName:    r.alert?.name ?? 'Alert',
                  campaignName: r.campaignName,
                  metric:       r.alert?.metric,
                  value:        r.metricValue,
                })),
              });
            })
            .catch(() => {/* keep silent — banner is best-effort */});
        }
        prevCountRef.current = count ?? 0;
      } catch {
        // network/auth glitches shouldn't kill the loop
      }
    }

    tick(); // immediate first poll
    const id = setInterval(tick, intervalMs);
    return () => {
      stoppedRef.current = true;
      clearInterval(id);
    };
  }, [intervalMs]);

  // External push: lets ad-hoc /evaluate flows (e.g. when the user manually
  // loads metrics) surface their fires through the same banner UI.
  function pushBanner(b) {
    setBanner(b ?? null);
  }

  return { unread, banner, reset, setUnread, pushBanner };
}
