# Running the API and the workers as two services

## Why

Today one Railway service runs both: `PROCESS_ROLE` is unset, which means
`all`, so the Express app and all nine BullMQ workers share one event loop and
one deployment. Two consequences, both real:

- **A deploy of the API restarts every worker mid-job.** An agent run that is
  four minutes into waiting for an Amazon report is killed and starts again
  tomorrow. Shipping a copy change to the billing page costs a day of agent
  runs.
- **A slow Amazon call adds latency to customer requests.** Same event loop.

Splitting them is an environment change. The code has supported it since the
`PROCESS_ROLE` helpers were added: `src/worker.js` is the workers-only
entrypoint and `npm run start:worker` is its command.

## Doing it

1. **Existing service** (the one serving `optimizer.hivemindnestor.com`):
   set `PROCESS_ROLE=api`. It keeps its start command, its domain and its
   healthcheck. It stops running workers.

2. **New service**, same repo and branch:
   - Start command: `npm run start:worker`
   - Variables: `PROCESS_ROLE=worker`, plus everything the workers need —
     `DATABASE_URL`, `REDIS_URL`, `ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`,
     `GOOGLE_AI_API_KEY`, `RESEND_API_KEY`, `MAIL_FROM`, `FRONTEND_URL`,
     `RAZORPAY_*`, `AMAZON_*`, `SENTRY_DSN`. Simplest is to copy the API
     service's variables and change `PROCESS_ROLE`.
   - Healthcheck path: `/ready`. No public domain needed.
   - **Do not** give it `preDeployCommand`. Migrations run once, from the API
     service; two services racing `prisma migrate deploy` is pointless even
     though Prisma's advisory lock makes it safe.

3. **Order matters, briefly.** Deploy the worker service first, then flip the
   API service to `api`. The other order leaves a window with no workers at
   all. The reverse — both running workers for a few minutes — is harmless:
   every scheduled job carries a fixed `jobId`, so BullMQ deduplicates the
   crons, and per-run work claims its slot in the database
   (`AgentRun.slotKey`, `RuleExecution.slotKey`) before doing anything.

## Confirming it took

`/ready` reports the role, and the worker service reports its concurrency:

```bash
curl -s https://optimizer.hivemindnestor.com/ready | jq '.process'
# { "role": "api", "workers": null }
```

```bash
# from the worker service's Railway shell
curl -s localhost:$PORT/ready | jq '.process'
# { "role": "worker", "workers": { "agent": 8, "reporting": 4, ... } }
```

If the API service still reports `"role": "all"`, `PROCESS_ROLE` did not
reach it — check for a typo, and remember that Railway variable changes need
a redeploy.

## Scaling afterwards

The worker service is the one to scale for throughput. Replicas are safe:
crons deduplicate by `jobId`, per-profile Amazon calls are paced by a shared
Redis bucket rather than a per-process counter, and every per-run job claims
a database slot before acting. `WORKER_CONCURRENCY_*` tunes how many jobs one
replica runs at once — see `.env.example`.

## Rolling back

Set `PROCESS_ROLE=all` on the API service and delete (or pause) the worker
service. Nothing else changes; that is the configuration today.
