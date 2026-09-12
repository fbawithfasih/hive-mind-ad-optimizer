/**
 * The nightly Sales & Traffic snapshot: what it covers and what it keeps.
 *
 * Every seller-facing question about stock-outs and the Buy Box needs this
 * data, and until now it existed only for as long as a browser tab was open:
 * routes/sales.js starts a report, polls it, hands it to the page, and it is
 * gone. A nightly worker that reads the alert thresholds has nothing to read.
 *
 * So one snapshot per org per day, stored as a ReportJob of type
 * SALES_TRAFFIC. That is the row the Buy Box and stock-out alerts will be
 * evaluated against, and it is also why the dashboard need not wait minutes
 * for a fresh report to show a figure that changes once a day.
 *
 * The pure parts live here so the worker is only orchestration.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How many days each snapshot covers.
 *
 * Seven, not one. A single day is noisy enough that a Buy Box dip on a quiet
 * Tuesday looks like a crisis, and Amazon restates recent days as orders
 * settle. A week smooths both and is still current enough to act on.
 */
export const SNAPSHOT_DAYS = 7;

/**
 * Sales and Traffic lags. Asking for today returns a day that is still being
 * written, so the window ends yesterday.
 */
export const LAG_DAYS = 1;

const iso = (d) => new Date(d).toISOString().slice(0, 10);

/** The window a snapshot taken now should ask Amazon for. */
export function snapshotWindow(now = new Date()) {
  const end   = new Date(now.getTime() - LAG_DAYS * DAY_MS);
  const start = new Date(end.getTime() - (SNAPSHOT_DAYS - 1) * DAY_MS);
  return { startDate: iso(start), endDate: iso(end) };
}

/**
 * One job id per org per day, so a re-run of the sweep finds the snapshot
 * already taken rather than taking it again. Same shape as the agent's slot
 * key, and for the same reason.
 */
export const snapshotJobId = (orgId, now = new Date()) => `sales:${orgId}:${iso(now)}`;

/**
 * What gets stored.
 *
 * Trimmed deliberately. The poller returns every ASIN the marketplace knows
 * about, and a large catalogue would put megabytes into a row read nightly by
 * an evaluator that only cares about the ones in trouble. Sorted so the cap
 * keeps the ASINs worth looking at rather than the first ones Amazon listed.
 */
export const MAX_ASINS = 500;

export function snapshotResult(polled, window) {
  const asins = [...(polled?.asins ?? [])]
    .sort((a, b) => {
      // Trouble first: no sales despite traffic, then lowest Buy Box, then
      // busiest. An ASIN with an unknown Buy Box sorts as if it were fine —
      // absence of a figure is not evidence of a problem.
      if (a.noSalesDespiteTraffic !== b.noSalesDespiteTraffic) return a.noSalesDespiteTraffic ? -1 : 1;
      const ab = a.buyBoxPercentage ?? 101;
      const bb = b.buyBoxPercentage ?? 101;
      if (ab !== bb) return ab - bb;
      return (b.sessions ?? 0) - (a.sessions ?? 0);
    })
    .slice(0, MAX_ASINS);

  return {
    window,
    totalSales: polled?.totalSales ?? 0,
    currency:   polled?.currency ?? null,
    days:       polled?.days ?? 0,
    asinCount:  polled?.asins?.length ?? 0,
    truncated:  (polled?.asins?.length ?? 0) > MAX_ASINS,
    asins,
  };
}
