# PostHog Self-driving setup report

## Summary

PostHog Self-driving is configured for this project. Session Replay, Error Tracking, and Support were enabled; health, error-tracking, and support signal sources were enabled; and the scout troop, two custom scouts, and two Replay Vision monitors were configured.

Findings will begin appearing in the [Self-driving inbox](https://us.posthog.com/project/607576/inbox) within about 30 minutes as scouts run and qualifying evidence accumulates.

## AI data processing

Approved by the organization-level setup gate.

## GitHub

GitHub was already connected before this setup. GitHub Issues was not selected as a connected tool, so no GitHub Issues responder was enabled.

## Products enabled

| Product | Status | Notes |
|---|---|---|
| Session Replay | enabled but inert | The server-side toggle is on, but this Vite/React frontend has no `posthog-js` initialization, so browser recordings will not arrive until client-side PostHog is configured. |
| Error Tracking | enabled | The Node service already initializes `posthog-node` with exception autocapture enabled. |
| Support | enabled | Tickets will arrive only after an inbound email, inbox, or Slack channel is connected in PostHog. |

The frontend has no `posthog.init(...)` override to remove or change.

## Signal sources

| Signal source | Action | Details |
|---|---|---|
| `health_checks` / `health_issue` | enabled | New source config `01a09c38-ea8a-7c95-a05e-549898803e25`. |
| `error_tracking` / `issue_created` | enabled | New source config `01a09c38-ead1-7231-b199-a0d93e0dec00`. |
| `error_tracking` / `issue_reopened` | enabled | New source config `01a09c38-ec4a-74f6-b080-34581f936bab`. |
| `error_tracking` / `issue_spiking` | enabled | New source config `01a09c38-eaac-76eb-917f-521b9eaa87cc`. |
| `conversations` / `ticket` | enabled | New source config `01a09c38-ec24-7a54-bdca-38000beb272f`. |
| `signals_scout` / `cross_source_issue` | skipped | Self-driving scout findings are enabled by default and no opt-out row existed. |
| Session replay | skipped | Replay coverage is supplied by the two Replay Vision monitors below; the retired session-analysis source was not created. |

## Connected tools

| Tool | Status |
|---|---|
| Sentry | not used — selected “None of these.” |
| GitHub Issues | not used — selected “None of these”; the GitHub App remains connected. |
| Linear | not used — selected “None of these.” |
| Jira | not used — selected “None of these.” |
| Zendesk | not used — selected “None of these.” |

## Scout troop

**Run budget:** verified at 100 maximum runs per day, 0 used today, 100 remaining. The current early-access notice says to contact `team-self-driving@posthog.com` to request more capacity.

**Enabled (6 of 29):**

| Scout | Why it is active |
|---|---|
| `signals-scout-general` | Cross-product correlations and surfaces not owned by a specialist. |
| `signals-scout-product-analytics` | The service emits an explicit organization-to-subscription event taxonomy. |
| `signals-scout-health-checks` | Self-driving health source is enabled and instrumentation health is actionable. |
| `signals-scout-observability-gaps` | Detects important emitted events that lack insight, dashboard, or alert coverage. |
| `signals-scout-seller-activation` | Custom coverage for seller activation volume and handoff health. |
| `signals-scout-subscription-lifecycle` | Custom coverage for paid conversion and cancellation behavior. |

**Disabled (23 of 29):**

| Scout | Reason |
|---|---|
| `signals-scout-ai-observability` | Anthropic is used in the codebase, but PostHog LLM observability events are not confirmed. |
| `signals-scout-anomaly-detection` | No established, highly viewed PostHog dashboards or insights were found to watch. |
| `signals-scout-apm` | No PostHog APM or OpenTelemetry surface was confirmed. |
| `signals-scout-conversations` | Support is newly enabled but no inbound channel or ticket activity exists yet. |
| `signals-scout-csp-violations` | No PostHog CSP reporting was confirmed. |
| `signals-scout-customer-analytics` | PostHog Customer Analytics usage was not confirmed. |
| `signals-scout-data-pipelines` | No CDP destination, batch export, or Hog Flow usage was confirmed. |
| `signals-scout-data-warehouse` | No warehouse source was selected or connected. |
| `signals-scout-error-tracking` | Covered by the enabled native Error Tracking sources. |
| `signals-scout-experiments` | No active experiment surface was confirmed. |
| `signals-scout-feature-flags` | No feature-flag usage was confirmed. |
| `signals-scout-inbox-validation` | Fresh setup; there are no shipped Self-driving fixes to re-measure yet. |
| `signals-scout-insight-alerts` | No insight-alert surface was confirmed. |
| `signals-scout-logs` | PostHog Logs usage was not confirmed. |
| `signals-scout-mcp-tool-calls` | No need to monitor PostHog MCP telemetry was established. |
| `signals-scout-replay-vision` | Kept off until Replay Vision observations accumulate; it does not replace the monitors. |
| `signals-scout-revenue-analytics` | Razorpay is used, but no PostHog Revenue Analytics warehouse surface is configured. |
| `signals-scout-session-replay` | Covered by the Replay Vision monitors. |
| `signals-scout-skills-store` | No active skills-store maintenance surface was established. |
| `signals-scout-surveys` | No surveys exist. |
| `signals-scout-tasks` | No PostHog Tasks usage was confirmed. |
| `signals-scout-web-analytics` | Client-side PostHog web analytics is not configured. |
| `signals-scout-web-vitals` | Client-side PostHog web-vitals collection is not configured. |

## Custom scouts

| Scout | What it watches | Discriminator | Why it adds coverage |
|---|---|---|---|
| `signals-scout-seller-activation` | Organization creation → Amazon connection → agent enrollment. | A sustained completed-bucket entry-volume cliff or mature-cohort stage-conversion regression. | The built-in product scout focuses on saved-flow conversion regressions while entrants hold; this scout also detects an activation entry collapse or liveness break. |
| `signals-scout-subscription-lifecycle` | Checkout → paid subscription → cancellation. | Mature checkout-to-paid conversion and cancellation rate, not raw volume. | It isolates the paid lifecycle without assuming a PostHog Revenue Analytics warehouse integration. |

The following surfaces were considered and not made into custom scouts: error tracking and replay are already covered by their dedicated routes; surveys, feature flags, experiments, logs, CSP, APM, PostHog AI observability, and data pipelines lack confirmed activity; and the Razorpay integration is not a PostHog Revenue Analytics source. No approved proposal was declined.

If either custom scout becomes noisy, set its scout configuration’s `emit` flag to `false` in PostHog to run it in dry-run mode.

## Replay Vision scanners

A scanner is an LLM that watches individual session recordings on a schedule and pushes qualifying observations to the Self-driving inbox. It is the only part of this setup that spends Replay Vision quota. Scanner findings arrive at half weight and need corroboration before they are promoted into a report.

| Brief | Status | What it watches | Query scope | Sampling | Estimate |
|---|---|---|---|---:|---:|
| Breakage monitor | created — **Seller activation breakage** | Visible failures in organization setup, Amazon account connection, seller profile sync, and the post-setup optimization surface. | Recordings that visited `/onboarding`, the completion flow where sellers establish their organization and connect Amazon before using the product. | 0.5 | 0 observations / 0 credits per month from the current 7-day sample. |
| Frustration monitor | created — **Seller workflow frustration** | Visible retries and stuck behavior in setup, Amazon connection, profile sync, campaign/listing optimization, and agent actions. | Sessions containing `$rageclick` only. | 1.0 | 0 observations / 0 credits per month from the current 7-day sample. |

Replay Vision quota was checked before creation: 2,500 credits remain and no credits have been used. No recordings currently exist, so both monitors are armed and will begin work when browser session recording is configured and recordings arrive.

## Files created or modified

| Path | Change |
|---|---|
| `posthog-self-driving-report.md` | Created this setup report. |
| `.claude/skills/replay-vision-scanners-core/` | Installed shared local scanner workflow guidance. |
| `.claude/skills/replay-vision-scanner-broken-experiences/` | Installed the local breakage-monitor brief. |
| `.claude/skills/replay-vision-scanner-user-frustration/` | Installed the local frustration-monitor brief. |

No application source files or environment files were modified.

## Follow-ups

- [ ] Configure `posthog-js` in the Vite/React frontend using the project’s existing PostHog environment configuration so browser session recordings can be collected. Do not hardcode credentials; retain default session-replay and exception-capture behavior.
- [ ] Connect an inbound Support channel (email, inbox, or Slack) in PostHog so the enabled Support ticket source can receive tickets.
- [ ] Once recordings arrive, review the two monitor outputs and rate observations in Replay Vision to receive configuration recommendations.
- [ ] The project profile was unavailable on this first run and no recordings, surveys, or active Error Tracking issues were observed. Re-run or revisit configuration after production traffic establishes a baseline.

## What happens next

Fresh scout configurations are picked up within about 30 minutes and each run draws from the verified daily budget. Findings cluster into reports in the [Self-driving inbox](https://us.posthog.com/project/607576/inbox); immediately actionable reports can begin coding tasks.