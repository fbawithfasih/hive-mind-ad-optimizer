/**
 * What goes in the Monday email, decided without touching the database.
 *
 * A weekly digest is the retention loop for a part-time seller: someone
 * running Amazon alongside a job does not open a dashboard on a Tuesday, and
 * the marketing site has promised "weekly performance reports" since before
 * there were any.
 *
 * ── Two clocks, and not pretending they are one ──────────────────────────────
 *
 * The agent's activity really is weekly: decisions and alert fires carry
 * their own timestamps and can be counted over the last seven days honestly.
 *
 * Performance cannot. There is no weekly report — there is the latest
 * campaign report the seller happened to run, covering whatever range they
 * chose. Presenting that as "your week" would be a wrong number nobody would
 * think to question, so the digest names the period the figures actually
 * cover, and drops them entirely when the report is too old to be worth
 * quoting. Stale data presented as current is worse than no data.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back "this week" reaches for the agent and alert counts. */
export const DIGEST_WINDOW_DAYS = 7;

/**
 * A campaign report older than this is not quoted at all.
 *
 * Two weeks, because a seller who ran a report a fortnight ago has moved on
 * from those numbers, and repeating them each Monday would make the email
 * look automatic in the bad sense.
 */
export const REPORT_STALE_DAYS = 14;

export const windowStart = (now) => new Date(now.getTime() - DIGEST_WINDOW_DAYS * DAY_MS);

/** Totals across the rows of a campaign performance report. */
export function summariseCampaigns(rows = []) {
  const t = { campaigns: 0, impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 };
  for (const r of rows) {
    if (!r) continue;
    t.campaigns   += 1;
    t.impressions += Number(r.impressions ?? 0) || 0;
    t.clicks      += Number(r.clicks ?? 0) || 0;
    t.spend       += Number(r.cost ?? r.spend ?? 0) || 0;
    t.sales       += Number(r.sales14d ?? r.sales ?? 0) || 0;
    t.orders      += Number(r.purchases14d ?? r.orders ?? 0) || 0;
  }
  return {
    ...t,
    spend: +t.spend.toFixed(2),
    sales: +t.sales.toFixed(2),
    // Null rather than zero or Infinity: no sales means ACoS is undefined,
    // and "0% ACoS" reads as spectacular when it means the opposite.
    acos: t.sales > 0 ? +((t.spend / t.sales) * 100).toFixed(1) : null,
    roas: t.spend > 0 ? +(t.sales / t.spend).toFixed(2) : null,
  };
}

/**
 * Is this report recent enough to quote?
 *
 * @param {{completedAt?: Date|string|null}|null} report
 */
export function reportIsFresh(report, now = new Date()) {
  const at = report?.completedAt ? new Date(report.completedAt) : null;
  if (!at || Number.isNaN(at.getTime())) return false;
  return now.getTime() - at.getTime() <= REPORT_STALE_DAYS * DAY_MS;
}

/**
 * Is there anything here worth an email?
 *
 * An empty digest every Monday is how a sender teaches a reader to filter
 * them. Silence when there is nothing to say is what keeps the weeks that
 * do have something worth opening.
 */
export function worthSending(digest) {
  if (!digest) return false;
  const { agent, alerts, performance } = digest;
  return Boolean(
    (agent?.proposed ?? 0) > 0
    || (agent?.applied ?? 0) > 0
    || (agent?.awaitingVerdict ?? 0) > 0
    || (alerts ?? 0) > 0
    || performance,
  );
}

/**
 * Should this org get a digest at all?
 *
 * A lapsed org keeps its account and its history, but a weekly email about
 * an agent it can no longer act on is not a service to anyone. Entitlement
 * has two sources and both count: a trial that has not run out, or a
 * subscription that is still worth something — a cancelled one included,
 * until the period the customer already paid for ends.
 *
 * @param {{trialEndsAt?: Date|string|null, subscriptions?: object[]}} org
 * @param {(sub: object) => boolean} isEntitled  injected, so this stays pure
 */
export function canReceiveDigest(org, isEntitled, now = new Date()) {
  const trialEndsAt = org?.trialEndsAt ? new Date(org.trialEndsAt) : null;
  if (trialEndsAt && !Number.isNaN(trialEndsAt.getTime()) && trialEndsAt.getTime() > now.getTime()) return true;
  return (org?.subscriptions ?? []).some((sub) => isEntitled(sub, now.getTime()));
}
