# Deployment Runbook

## Architecture

```
Internet → Caddy (443/TLS, auto Let's Encrypt) → app:3000 (Node.js)
                                                → postgres:5432
                                                → redis:6379
```

CI pipeline (GitHub Actions):
1. `test-backend` — runs Jest against a real Postgres service container
2. `build-frontend` — Vite build check
3. `build-push` — builds Docker image, pushes to GHCR (`ghcr.io/OWNER/REPO:sha-SHA`)
4. `deploy` — SSHes to server, pulls image, runs migrations, restarts app

---

## GitHub secrets required

Add these under **Settings → Secrets → Actions**:

| Secret | Description |
|---|---|
| `DEPLOY_HOST` | Server IP or hostname |
| `DEPLOY_USER` | SSH login user (e.g. `ubuntu`) |
| `DEPLOY_KEY` | SSH private key (paste the full PEM, including headers) |
| `GHCR_PAT` | GitHub PAT with **`read:packages`** scope — used by server to `docker pull` |

The `GITHUB_TOKEN` (auto-injected) handles pushing to GHCR from CI. The `GHCR_PAT` is only needed on the server side for pulling.

---

## First deploy (manual, run once on the server)

```bash
# 1. SSH into the server
ssh user@your-server

# 2. Install Docker + Compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker

# 3. Clone the repo
git clone https://github.com/OWNER/REPO.git ~/amaiop && cd ~/amaiop

# 4. Fill in environment variables
cp .env.example .env
vi .env   # set SESSION_SECRET, ENCRYPTION_KEY, POSTGRES_PASSWORD, RAZORPAY_*, SMTP_*, etc.

# 5. Set your domain
echo "DOMAIN=app.yourdomain.com" >> .env

# 6. Log in to GHCR (use your GHCR_PAT)
echo "YOUR_GHCR_PAT" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin

# 7. Pull and tag the latest image
docker pull ghcr.io/OWNER/REPO:latest
docker tag  ghcr.io/OWNER/REPO:latest amaiop:latest

# 8. Start infrastructure, run migrations, start app + Caddy
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d postgres redis
sleep 5
docker run --rm --env-file .env amaiop:latest npx prisma migrate deploy
DOMAIN=app.yourdomain.com docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Verify:
```bash
curl https://app.yourdomain.com/health
# → {"status":"ok"}
```

---

## Subsequent deploys

Merging to `main` triggers the full CI → build → deploy pipeline automatically.
Nothing to run manually.

To deploy a specific SHA manually:

```bash
cd ~/amaiop
IMAGE="ghcr.io/OWNER/REPO:sha-FULL_SHA"
docker pull "$IMAGE" && docker tag "$IMAGE" amaiop:latest
docker run --rm --env-file .env amaiop:latest npx prisma migrate deploy
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps --pull never app
```

---

## Environment variables (required in production)

| Variable | Description |
|---|---|
| `DATABASE_URL` | Set automatically by compose from `POSTGRES_PASSWORD` |
| `POSTGRES_PASSWORD` | PostgreSQL password — pick something strong |
| `REDIS_URL` | Set automatically by compose (`redis://redis:6379`) |
| `DOMAIN` | Your public domain (e.g. `app.yourdomain.com`) |
| `SESSION_SECRET` | JWT signing secret — min 32 random chars |
| `ENCRYPTION_KEY` | AES-256 key for stored Amazon tokens — exactly 64 hex chars |
| `FRONTEND_URL` | Full origin of the frontend for CORS (same as `https://$DOMAIN`) |
| `RAZORPAY_KEY_ID` | Razorpay key ID (`rzp_live_…`) |
| `RAZORPAY_KEY_SECRET` | Razorpay key secret |
| `RAZORPAY_WEBHOOK_SECRET` | From Razorpay Dashboard → Webhooks → Secret |
| `RAZORPAY_PLAN_BASIC` | Razorpay Plan ID for Basic tier (`plan_…`) |
| `RAZORPAY_PLAN_PRO` | Razorpay Plan ID for Pro tier (`plan_…`) |
| `RAZORPAY_PLAN_ENTERPRISE` | Razorpay Plan ID for Enterprise tier (`plan_…`) |
| `SMTP_HOST` | SMTP server hostname |
| `SMTP_PORT` | SMTP port (usually 587) |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password / API key |
| `SMTP_FROM` | From address (`AMAIOP <noreply@yourdomain.com>`) |
| `ANTHROPIC_API_KEY` | Claude API key |
| `GOOGLE_AI_API_KEY` | Gemini API key |

Optional (fall back to env if not set per-org):

| Variable | Description |
|---|---|
| `AMAZON_CLIENT_ID` | SP-API / Ads client ID |
| `AMAZON_CLIENT_SECRET` | SP-API / Ads client secret |
| `SP_API_SELLER_ID` | Default seller ID |

---

## Migrations

Migrations run automatically during the CI deploy step before the new container starts.
To run manually:

```bash
# Check pending migrations
docker run --rm --env-file .env amaiop:latest npx prisma migrate status

# Apply pending migrations
docker run --rm --env-file .env amaiop:latest npx prisma migrate deploy
```

`prisma migrate deploy` is idempotent — safe to run on every deploy.
Never run `prisma migrate dev` in production.

---

## Rollback

```bash
cd ~/amaiop

# Re-tag a known-good SHA
docker pull ghcr.io/OWNER/REPO:sha-GOOD_SHA
docker tag  ghcr.io/OWNER/REPO:sha-GOOD_SHA amaiop:latest

# Restart from the old image (no migration rollback needed unless destructive schema change)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps --pull never app
```

---

## TLS / Caddy

Caddy fetches and renews TLS certificates from Let's Encrypt automatically.
Certificates are stored in the `caddy_data` Docker volume — they persist across restarts.

Requirements:
- Ports **80** and **443** open on the server
- Domain A record pointing to the server IP before first start

To force-renew certificates:
```bash
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

---

## Logs

```bash
docker compose logs -f app      # live app logs
docker compose logs -f caddy    # access + TLS logs
docker compose logs -f postgres # DB logs
docker compose logs -f redis    # Redis logs
```

---

## Health check

```bash
curl https://app.yourdomain.com/health
# → {"status":"ok"}
```

The Docker `HEALTHCHECK` polls `http://localhost:3000/health` every 30s inside the container. If it fails 3 times, compose marks it `unhealthy`. Caddy only routes to the `app` service after it is healthy (`depends_on: condition: service_healthy`).
