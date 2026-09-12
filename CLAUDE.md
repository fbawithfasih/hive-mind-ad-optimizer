# CLAUDE.md — Hive Mind Ad Optimizer (AMAIOP)

Express + Prisma + BullMQ API with a Vite/React frontend, deployed to Railway.
Stack, scripts and layout are readable from `package.json`, `prisma/schema.prisma`
and the tree — only what those *don't* tell you is here.

## This is not the only repo in the neighbourhood

The marketing site (`~/Projects/hivemindnestor`) is a **separate repository**
whose git root is the home directory, and pushing its `main` deploys to
Cloudflare with no staging step. It carries its own `CLAUDE.md`.

The two are deliberately checked out side by side:
`src/config/__tests__/pricing.test.js` reads `../hivemindnestor/src` and fails
if the site's prices drift from `src/config/pricing.js`. That guard is skipped
in CI, which has no copy of the site — **a developer machine is the only place
it runs**, so run `npm test` here after changing a price anywhere.

## Commands

```bash
npm test                 # jest --coverage — coverage thresholds are enforced
npm run dev              # nodemon API
npm run start:worker     # the BullMQ workers (src/workers/*.worker.js)
npm run build            # builds frontend/ only
npx prisma migrate dev   # local migration
```

There is no lint step. `npm test` is the gate.

### Coverage thresholds are per-file and they fail the build

`jest.config.js` sets a low global floor and then pins specific files far
higher — credentials, tenant isolation, auth gates, anything that writes to a
live advertiser account or moves money. A file over its threshold that drops
below it fails CI *with every test passing*, which reads as an unrelated
breakage on whatever branch runs next. If CI is red and the summary says
`N passed, N total`, look for `coverage threshold ... not met`.

## Deployment

Railway, from `main`. `railway.toml` runs `npx prisma migrate deploy` as
`preDeployCommand` — read the comment at the top of that file before touching
it, or migrations stop running silently.

**Green CI is not a deploy.** Check the running commit:

```bash
curl -s https://optimizer.hivemindnestor.com/ready
```

Postgres and Redis are private-network only with no TCP proxies, so
`railway run` from a laptop injects env vars but **cannot reach the database**.
Anything touching the DB runs inside the container. `scripts/` is shipped in
the image for exactly this reason (see the comment on `COPY scripts/` in the
Dockerfile), so no piping is needed:

```bash
railway ssh "node scripts/plan-limit-audit.js"
```

`railway run` is still the right tool for a script that only needs env vars and
an outbound API — `check-razorpay-config.js`, `create-razorpay-plans.js`.

Scripts that write take `--apply` and dry-run by default. Keep it that way.

## Money

`src/config/pricing.js` is the single source of truth for prices, and
`src/config/plan-limits.js` for limits. Razorpay **plan amounts are immutable
and plans cannot be deleted**, so a price change means creating new plans
(`scripts/create-razorpay-plans.js`) and repointing the six `RAZORPAY_PLAN_*`
env vars — never editing an existing plan. `scripts/check-razorpay-config.js`
verifies the vars resolve to real plans of the right period.

Comped agency orgs are expressed as a provider-less ACTIVE subscription at the
`CUSTOM` tier (`scripts/grant-agency-access.js`), not as a special case in the
paywall.

## Plan limits: counted is not enforced

`PLAN_LIMITS_MODE=strict` is on in production, but only the fields with an
`enforcePlanLimit(...)` call site are actually gated — `imagesOptimized`,
`reportsGenerated`, `listingsOptimized`, `bulkOperations`, `apiCalls`, and
`llmTokens` via `services/llm.js`. **`profiles` and `seats` are counted and
reported by `scripts/plan-limit-audit.js` but enforced nowhere**, so an org
listed as "over a limit" is not necessarily being refused anything.

## Tenancy

Queries are tenant-scoped by `src/db/tenant-guard.js` in strict mode. Workers
have no request context and are wrapped by `asSystem()` in
`src/workers/start.js` — the wrapping is at the registration site, not inside
each `*.worker.js`, so a worker file on its own looks unscoped and is not.
