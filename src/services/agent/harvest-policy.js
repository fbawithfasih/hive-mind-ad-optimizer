/**
 * Search-term harvesting policy — the part of the agent that decides.
 *
 * Pure functions over report rows. No database, no network, no clock beyond
 * what the caller passes in. Every number the agent acts on is computed here,
 * so every number is reproducible and unit-testable; the LLM reviewer that runs
 * after this may reorder or veto candidates, but it never invents one.
 *
 * ── What this encodes ────────────────────────────────────────────────────────
 *
 * The two moves an account manager makes daily from a search-term report:
 *
 *   Negate  — a term that has taken enough clicks to have converted by now and
 *             has not. Money leaving with nothing to show for it.
 *   Promote — a term that converts at or under the account's target ACoS, but is
 *             only being matched loosely. Pull it into its own exact keyword so
 *             it can be bid on deliberately.
 *
 * ── The threshold that matters ───────────────────────────────────────────────
 *
 * `minClicks` is the whole safety story for negation. Negating on three clicks
 * is the classic harvesting mistake: three clicks with no sale is not evidence
 * of a bad term, it is evidence of not much data. Worse, `purchases14d` is a
 * 14-day attribution window, so a term that looks dead today may be credited a
 * sale tomorrow for a click that already happened. The default of 12 is
 * deliberately conservative; it is per-profile precisely because the right
 * number depends on the account's conversion rate.
 *
 * ── Why rows are aggregated first ────────────────────────────────────────────
 *
 * Amazon reports one row per (search term × the target that matched it). A term
 * pulled in by both a broad and a phrase keyword arrives as two rows. Judging
 * rows individually would see 6 clicks and 7 clicks and negate neither, when the
 * term has actually taken 13 clicks and earned nothing. Aggregation by
 * (campaign, ad group, term) happens before any rule runs.
 */

/** Amazon's floor for a Sponsored Products keyword bid. */
const MIN_BID = 0.02;

/** Amazon rejects bids above this on most marketplaces; a sanity ceiling. */
const MAX_BID = 100;

/**
 * The chance we are willing to accept of negating a perfectly healthy term.
 *
 * A term that converts at the account's baseline can still show zero sales for a
 * while purely by chance. That probability is (1 - cvr)^clicks, so the click
 * threshold is not a matter of taste — it falls out of the account's own
 * conversion rate and how often you are willing to be wrong.
 */
export const DEFAULT_FALSE_NEGATION_RATE = 0.10;

/** Bounds on a derived threshold, for accounts at the extremes. */
const MIN_DERIVED_CLICKS = 15;
const MAX_DERIVED_CLICKS = 80;

export const DEFAULT_OBJECTIVE = {
  /** Percent. The account's ACoS ceiling — the thing the agent optimises against. */
  targetAcos: 30,
  /**
   * Clicks a term must have taken before zero sales counts as evidence.
   *
   * null means derive it from the account's own conversion rate, which is what
   * a profile should normally do — see minClicksFor. The number below is only
   * the fallback for a report with no conversions at all to calibrate from.
   *
   * It was 12, chosen by feel and described in this file as "deliberately
   * conservative". Real data says otherwise: Queenza's US account converts at
   * 5.97% (356 purchases on 5,960 brand clicks, Q2 2026), and at that rate a
   * healthy term still shows zero sales after 12 clicks 48% of the time. A
   * threshold of 12 would have negated roughly half of the good terms it
   * looked at. 40 holds that error at 8.5% for the same account.
   */
  minClicks: 40,
  /**
   * Clicks a term needs before its conversion rate is worth acting on.
   *
   * The promotion rule had no click floor at all — minClicks guards only
   * negation — so `purchases >= 2 && acos <= target` was the whole test. A term
   * with one click and two attributed orders passed it, on an implied
   * conversion rate of 200%.
   *
   * Those rows are not fabricated: purchases14d counts orders and sales14d
   * revenue, so one click really can carry three units bought over the
   * following fortnight. What they are is unmeasured. One click says nothing
   * about whether the term converts at 40% or at 4%, and the queue fills with
   * rows a reviewer can only shrug at — six of Queenza's first sixteen had five
   * clicks or fewer.
   *
   * Five rather than the calibrated minClicks (~38 for that account), because
   * the two thresholds answer different questions. Negation asks "is this
   * silence long enough to be evidence of failure", which needs the account's
   * conversion rate. Promotion asks "did this convert often enough to be worth
   * a keyword", and the orders themselves are already the evidence — the floor
   * only has to rule out a rate computed from almost no denominator. Requiring
   * 38 clicks to promote would reject nearly everything the agent exists to
   * find.
   */
  minClicksToPromote: 5,
  /** Sales a term needs before it is worth its own exact keyword. */
  minPurchasesToPromote: 2,
  /** Negate a converting-nothing term once its spend reaches this × target CPA. */
  wasteMultiplier: 2,
  /** Terms containing any of these are never negated. */
  brandTerms: [],
};

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * The click threshold implied by a conversion rate.
 *
 * Solve (1 - cvr)^n <= falseNegationRate for n. At a 6% conversion rate and a
 * 10% tolerance that is 38 clicks; at 12% it is 19. Bounded at both ends: a
 * freakishly high converter would otherwise get a threshold low enough to
 * negate on noise, and a very low converter one so high that nothing is ever
 * negated and the spend rule has to carry the whole job.
 *
 * @param {number} cvr  purchases per click, 0..1
 * @returns {number|null} null when there is no usable rate to derive from
 */
export function minClicksFor(cvr, falseNegationRate = DEFAULT_FALSE_NEGATION_RATE) {
  if (!Number.isFinite(cvr) || cvr <= 0 || cvr >= 1) return null;
  const n = Math.log(falseNegationRate) / Math.log(1 - cvr);
  return Math.min(Math.max(Math.ceil(n), MIN_DERIVED_CLICKS), MAX_DERIVED_CLICKS);
}

/**
 * The account's own click-to-purchase rate, from the report in hand.
 *
 * Whole-report rather than per-term on purpose: a single term never has enough
 * data to estimate its own rate, which is the entire reason a threshold is
 * needed in the first place.
 */
export function observedCvr(terms = []) {
  let clicks = 0, purchases = 0;
  for (const t of terms) { clicks += t.clicks; purchases += t.purchases; }
  return clicks > 0 && purchases > 0 ? purchases / clicks : null;
}

/**
 * An unambiguous composite key from parts that may contain anything.
 *
 * JSON rather than a separator character. The obvious approach — join on
 * something the fields cannot contain — was a literal NUL, which is unambiguous
 * and cost more than it was worth: a NUL anywhere in a file makes git and grep
 * both classify it as binary. `grep` then prints *nothing* for that file rather
 * than reporting a binary match, and git renders `Bin 13840 -> 15945 bytes`
 * instead of a diff — so a change to the policy that decides what the agent does
 * to live ad spend was invisible in review (#83).
 *
 * JSON escaping gives the same guarantee for free: no member of the array can be
 * confused with a boundary between two of them, whatever a search term contains.
 * These keys live only in a Map and a Set within one run — nothing is persisted —
 * so the format is free to change.
 */
const compositeKey = (...parts) => JSON.stringify(parts.map((p) => String(p)));

/** Stable key for one term inside one ad group. */
const termKey = (row) => compositeKey(row.campaignId, row.adGroupId, normalise(row.searchTerm));

/**
 * Stable key for one *decision* about a term — the term key plus the action.
 *
 * Action-typed because negating a term and promoting it are different
 * judgements: having ruled on one says nothing about the other.
 */
export const decisionKey = (actionType, row) =>
  compositeKey(actionType, row.campaignId, row.adGroupId, normalise(row.searchTerm));

function normalise(text) {
  return String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Whether a search term is an ASIN rather than something a shopper typed.
 *
 * A search-term report mixes two different things in one column. Most rows are
 * queries; rows served by product targeting or an auto campaign's
 * product placements carry the *target ASIN* instead. Both look like text, and
 * neither the report nor this policy previously told them apart.
 *
 * That matters because the action the rules reach for cannot express an ASIN.
 * Promoting one adds an exact *keyword* `b0926qf71k`, which matches only a
 * shopper who literally types that string into search — essentially nobody,
 * while the 38,791 impressions it was harvested from came from a product page.
 * Negating one is worse than useless: a negative keyword does not block a
 * product placement, so the spend continues, the decision is recorded, and
 * decisionKey then suppresses the term for 90 days — the account keeps paying
 * for traffic the agent has convinced itself it already handled.
 *
 * So both branches skip these. The right capture is a product target, which is
 * a capability this agent does not have yet; proposing the wrong action is not
 * a substitute for lacking the right one.
 *
 * Matches the B-prefixed form Amazon has issued since 2000. Books can carry a
 * ten-digit ISBN as their ASIN, which is deliberately NOT matched: a bare
 * ten-digit number is a plausible query (a model number, a phone number), and
 * skipping a real query is a worse failure here than proposing on a rare one.
 */
export function isAsinTerm(searchTerm) {
  return /^b0[a-z0-9]{8}$/.test(normalise(searchTerm));
}

/**
 * Whether a search term contains a brand term as a whole word.
 *
 * Substring matching would treat "case" as branded for a brand called "ase",
 * so this matches on word boundaries. Brand terms may themselves be phrases.
 */
export function isBrandTerm(searchTerm, brandTerms = []) {
  const term = normalise(searchTerm);
  if (!term) return false;
  return brandTerms.some((brand) => {
    const b = normalise(brand);
    if (!b) return false;
    return new RegExp(`(^|\\s)${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(term);
  });
}

/**
 * Collapse report rows to one entry per (campaign, ad group, search term).
 *
 * `alreadyExact` is carried through rather than recomputed later: if any row for
 * this term was served by an exact keyword equal to the term itself, the term is
 * already harvested and must be neither negated nor promoted.
 */
export function aggregateRows(rows = []) {
  const byTerm = new Map();

  for (const row of rows) {
    const searchTerm = normalise(row?.searchTerm);
    if (!searchTerm || row?.campaignId == null || row?.adGroupId == null) continue;

    const key = termKey(row);
    const entry = byTerm.get(key) ?? {
      campaignId:   String(row.campaignId),
      campaignName: row.campaignName ?? null,
      adGroupId:    String(row.adGroupId),
      adGroupName:  row.adGroupName ?? null,
      searchTerm,
      impressions: 0, clicks: 0, cost: 0, purchases: 0, sales: 0,
      alreadyExact: false,
      rowCount: 0,
    };

    entry.impressions += num(row.impressions);
    entry.clicks      += num(row.clicks);
    entry.cost        += num(row.cost);
    entry.purchases   += num(row.purchases14d);
    entry.sales       += num(row.sales14d);
    entry.rowCount    += 1;

    if (String(row.matchType ?? '').toUpperCase() === 'EXACT'
        && normalise(row.targeting) === searchTerm) {
      entry.alreadyExact = true;
    }

    byTerm.set(key, entry);
  }

  for (const entry of byTerm.values()) {
    entry.acos = entry.sales > 0 ? (entry.cost / entry.sales) * 100 : null;
    entry.cpc  = entry.clicks > 0 ? entry.cost / entry.clicks : 0;
  }

  return [...byTerm.values()];
}

/**
 * Average order value per ad group, used to turn a target ACoS into a target CPA.
 *
 * Returns null for an ad group with no attributed sales: without an AOV there is
 * no defensible CPA, and the spend rule that depends on it is skipped rather
 * than guessed at.
 */
export function adGroupAov(terms = []) {
  const totals = new Map();
  for (const t of terms) {
    const agg = totals.get(t.adGroupId) ?? { sales: 0, purchases: 0 };
    agg.sales     += t.sales;
    agg.purchases += t.purchases;
    totals.set(t.adGroupId, agg);
  }
  const aov = new Map();
  for (const [adGroupId, { sales, purchases }] of totals) {
    aov.set(adGroupId, purchases > 0 ? sales / purchases : null);
  }
  return aov;
}

/**
 * The bid to open a promoted term at.
 *
 * Two constraints, and we take the lower: what the term already costs per click
 * (no reason to bid above a price that is already winning it), and the most a
 * click can be worth while still hitting target ACoS — revenue per click times
 * the target. Bidding above the second guarantees the new keyword misses target.
 */
export function promotionBid(term, targetAcos) {
  const revenuePerClick = term.clicks > 0 ? term.sales / term.clicks : 0;
  const maxAtTarget     = revenuePerClick * (targetAcos / 100);
  const candidate       = Math.min(term.cpc || maxAtTarget, maxAtTarget);
  if (!Number.isFinite(candidate) || candidate <= 0) return null;
  return Math.min(Math.max(+candidate.toFixed(2), MIN_BID), MAX_BID);
}

/**
 * Decide what to do with a report.
 *
 * Returns candidates AND the terms it deliberately passed over, with a reason
 * for each. The skips are not noise: in shadow mode they are how you tell
 * "the agent saw nothing" apart from "the agent saw plenty and held off", which
 * is the difference between a broken policy and a cautious one.
 *
 * `decided` suppresses candidates this profile has already been judged on — see
 * the filter below for why that is a correctness matter and not a tidiness one.
 *
 * @param {Array<object>} rows       raw search-term report rows
 * @param {object}        objective  merged over DEFAULT_OBJECTIVE
 * @param {Set<string>}   decided    decisionKey()s already recorded for this profile
 * @returns {{ candidates: Array<object>, skipped: Array<object>, stats: object }}
 */
export function decideHarvest(rows = [], objective = {}, decided = new Set()) {
  const obj   = { ...DEFAULT_OBJECTIVE, ...objective };
  const terms = aggregateRows(rows);
  const aov   = adGroupAov(terms);

  // A pinned minClicks wins; otherwise calibrate to this account. Explicit null
  // means "derive", which is what a profile should normally do — the right
  // threshold is a property of how the account converts, not of the operator's
  // instinct.
  const cvr = observedCvr(terms);
  if (obj.minClicks === null || obj.minClicks === undefined) {
    obj.minClicks = minClicksFor(cvr) ?? DEFAULT_OBJECTIVE.minClicks;
  }

  // Null means the policy's floor, not "no floor" — the column stores no
  // default so that this number lives in exactly one place.
  if (obj.minClicksToPromote === null || obj.minClicksToPromote === undefined) {
    obj.minClicksToPromote = DEFAULT_OBJECTIVE.minClicksToPromote;
  }

  const candidates = [];
  const skipped    = [];

  const skip = (term, reason) => skipped.push({
    searchTerm: term.searchTerm, campaignId: term.campaignId, adGroupId: term.adGroupId,
    reason, clicks: term.clicks, cost: +term.cost.toFixed(2), purchases: term.purchases,
  });

  for (const term of terms) {
    const inputs = {
      impressions: term.impressions,
      clicks:      term.clicks,
      cost:        +term.cost.toFixed(2),
      purchases:   term.purchases,
      sales:       +term.sales.toFixed(2),
      acos:        term.acos === null ? null : +term.acos.toFixed(2),
      cpc:         +term.cpc.toFixed(2),
    };

    const base = {
      campaignId:   term.campaignId,
      campaignName: term.campaignName,
      adGroupId:    term.adGroupId,
      adGroupName:  term.adGroupName,
      searchTerm:   term.searchTerm,
      inputs,
    };

    if (term.alreadyExact) { skip(term, 'ALREADY_EXACT'); continue; }

    // Before either rule: an ASIN cannot be expressed as a keyword in
    // promotion or negation, so neither branch may act on one.
    if (isAsinTerm(term.searchTerm)) { skip(term, 'ASIN_TARGET'); continue; }

    if (term.purchases === 0) {
      if (isBrandTerm(term.searchTerm, obj.brandTerms)) { skip(term, 'BRAND_TERM'); continue; }

      if (term.clicks >= obj.minClicks) {
        candidates.push({ ...base, actionType: 'ADD_NEGATIVE', matchType: 'negativeExact',
          reason: 'NO_CONVERSION',
          detail: `${term.clicks} clicks, no sales in the lookback (threshold ${obj.minClicks})` });
        continue;
      }

      const groupAov  = aov.get(term.adGroupId);
      const targetCpa = groupAov === null || groupAov === undefined
        ? null
        : groupAov * (obj.targetAcos / 100);

      if (targetCpa !== null && term.cost >= obj.wasteMultiplier * targetCpa) {
        candidates.push({ ...base, actionType: 'ADD_NEGATIVE', matchType: 'negativeExact',
          reason: 'WASTED_SPEND',
          detail: `$${term.cost.toFixed(2)} spent with no sales — ${obj.wasteMultiplier}× the $${targetCpa.toFixed(2)} target CPA` });
        continue;
      }

      skip(term, term.clicks > 0 ? 'INSUFFICIENT_CLICKS' : 'NO_CLICKS');
      continue;
    }

    if (term.purchases >= obj.minPurchasesToPromote && term.acos !== null && term.acos <= obj.targetAcos) {
      // Checked inside the branch, after the term has otherwise qualified, so
      // the skip reason names the thing that actually stopped it. Outside, a
      // one-click term with no sales would report TOO_FEW_CLICKS_TO_PROMOTE
      // when what is true of it is that it never converted.
      if (term.clicks < obj.minClicksToPromote) {
        skip(term, 'TOO_FEW_CLICKS_TO_PROMOTE');
        continue;
      }

      const bid = promotionBid(term, obj.targetAcos);
      if (bid === null) { skip(term, 'NO_VIABLE_BID'); continue; }

      candidates.push({ ...base, actionType: 'ADD_EXACT', matchType: 'exact', bid,
        reason: 'CONVERTS_AT_TARGET',
        detail: `${term.purchases} sales at ${term.acos.toFixed(1)}% ACoS (target ${obj.targetAcos}%)` });
      continue;
    }

    skip(term, term.purchases < obj.minPurchasesToPromote ? 'TOO_FEW_SALES' : 'ABOVE_TARGET_ACOS');
  }

  // ── Terms already ruled on ─────────────────────────────────────────────────
  //
  // In shadow nothing is applied, so nothing about the account changes: the
  // term is not negated, no exact keyword appears, `alreadyExact` stays false,
  // and tomorrow's report proposes the identical term again. Left alone, one
  // profile's five negatives become 200 rows in forty days that are five
  // distinct judgements repeated forty times.
  //
  // That corrupts the thing shadow mode exists to produce. graduationStatus
  // counts rows, so the gate would open on a denominator that looks like 200
  // independent judgements and is not — and the reviewer meets the same terms
  // every morning, which is how a queue teaches people to click AGREE without
  // reading it.
  //
  // Suppressing after the rules rather than before keeps every threshold and
  // every reason exactly as it was: this only decides whether an already-judged
  // candidate is worth asking about a second time.
  const kept = [];
  for (const c of candidates) {
    if (decided.has(decisionKey(c.actionType, c))) {
      skipped.push({
        searchTerm: c.searchTerm, campaignId: c.campaignId, adGroupId: c.adGroupId,
        reason: 'ALREADY_DECIDED',
        clicks: c.inputs.clicks, cost: c.inputs.cost, purchases: c.inputs.purchases,
      });
      continue;
    }
    kept.push(c);
  }

  const stats = {
    observedCvr:  cvr === null ? null : +(cvr * 100).toFixed(2),
    minClicksUsed: obj.minClicks,
    minClicksToPromoteUsed: obj.minClicksToPromote,
    rowsIn:       rows.length,
    termsAfterAggregation: terms.length,
    candidates:   kept.length,
    negatives:    kept.filter(c => c.actionType === 'ADD_NEGATIVE').length,
    promotions:   kept.filter(c => c.actionType === 'ADD_EXACT').length,
    skipped:      skipped.length,
    alreadyDecided: candidates.length - kept.length,
  };

  return { candidates: kept, skipped, stats };
}

export default decideHarvest;
