# Secret Rotation Runbook

How to rotate every secret this app uses. Secrets live as **Railway environment
variables** (production) and in local `.env` files (development). Local `.env`
files are gitignored and must never be committed.

> **Why now:** the production secrets were duplicated across two local repo clones
> (`AMAIOP` and the retired `hive-mind-ad-optimizer`). Treat every key listed under
> "Immediate rotation" below as potentially exposed and rotate it.

## Principles

- **One source of truth:** Railway holds production secrets. Pull locally with the
  Railway CLI rather than copying values around by hand.
- **Never commit `.env`.** It is gitignored; keep it that way. Don't paste secrets
  into commits, issues, PRs, or chat.
- **Rotate on a schedule and on exposure.** Anything that ever sat in two places,
  a screenshot, or a log gets rotated.
- **`ENCRYPTION_KEY` is special** — rotating it requires re-encrypting stored data
  (see below). Every other key is a straight swap.

---

## Inventory

| Secret | Used for | Rotation type |
|---|---|---|
| `ENCRYPTION_KEY` | AES-256-GCM for Amazon tokens at rest | **Re-encrypt required** |
| `SESSION_SECRET` | JWT signing | Swap (logs everyone out) |
| `RESEND_API_KEY` | Transactional email | Swap |
| `ANTHROPIC_API_KEY` | Claude AI | Swap |
| `GOOGLE_AI_API_KEY` | Gemini | Swap |
| `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Image optimization | Swap |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Billing | Swap (regenerate in dashboard) |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook signature verification | Swap (update dashboard + Railway together) |
| `AMAZON_ADS_*` / `SP_API_*` | Amazon API access | Re-consent / regenerate in Amazon |
| `MARKETING_CLAIM_SECRET` | Marketing-site → app claim tokens | Swap (update both apps together) |
| `GOOGLE_CLIENT_SECRET` / `APPLE_PRIVATE_KEY` | SSO | Regenerate in provider console |

---

## Rotating `ENCRYPTION_KEY` (zero-downtime)

`ENCRYPTION_KEY` derives the AES key that protects Amazon refresh tokens
(`AmazonCredential.refreshToken`, `AmazonCredential.encryptedData`,
`SellerProfile.merchantToken`). If you just swap it, every stored token becomes
undecryptable and customers must reconnect Amazon. Instead, re-encrypt the data.

The app supports a dual-key window: `src/db/encryption.js` exposes
`encryptWithKey` / `decryptWithKey` / `canDecryptWithKey`, and
`scripts/rotate-encryption-key.js` walks every encrypted row, decrypting with the
old key and re-encrypting with the new one. The script is **idempotent** (rows
already on the new key are skipped) and **safe** (rows it can't decrypt with
either key are left untouched and reported, never destroyed).

### Procedure

1. **Generate a new key** (32 bytes → 64 hex chars):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. **Dry-run against production data** (no writes). Point `DATABASE_URL` at prod,
   set the current key as `ENCRYPTION_KEY_OLD` and the new key as `ENCRYPTION_KEY`:
   ```bash
   ENCRYPTION_KEY_OLD=<current_key> \
   ENCRYPTION_KEY=<new_key> \
   DATABASE_URL=<prod_url> \
   npm run rotate:encryption-key -- --dry-run
   ```
   Confirm `failed=0`. If any field fails to decrypt with the old key, stop and
   investigate before proceeding.

3. **Run for real** (same command without `--dry-run`). All rows move to the new
   key. Re-running is safe — already-rotated rows are skipped.

4. **Update Railway:** set `ENCRYPTION_KEY` to the new value and deploy. The app
   now reads/writes with the new key.

5. **Verify:** connect/refresh an Amazon account, trigger a report. Then retire
   `ENCRYPTION_KEY_OLD` (remove it from any shell history / scratch env).

> If the worker pool runs separately from the web process, deploy the new key to
> both before retiring the old one. Until step 4 completes, keep the old key live.

---

## Rotating a straight-swap secret

For everything except `ENCRYPTION_KEY`:

1. Generate/regenerate the new value in the provider's dashboard (Resend,
   Anthropic, Cloudinary, Razorpay, Google, Apple) or locally
   (`SESSION_SECRET`, `MARKETING_CLAIM_SECRET` — use the `randomBytes` command above).
2. Update the variable in **Railway** → redeploy.
3. For paired secrets, update both ends in the same window:
   - `RAZORPAY_WEBHOOK_SECRET` → Razorpay Dashboard → Webhooks **and** Railway.
   - `MARKETING_CLAIM_SECRET` → the marketing site **and** this app.
4. Revoke the old value in the provider dashboard once the new one is confirmed live.

**Side effects to expect:**
- `SESSION_SECRET` → all existing JWTs become invalid; users must log in again.
- `RAZORPAY_WEBHOOK_SECRET` → any in-flight webhooks signed with the old secret
  are rejected (Razorpay retries; the idempotent handler tolerates this).

---

## Immediate rotation (exposure from duplicate clones)

Rotate these now, in priority order:

1. `RESEND_API_KEY` — already flagged.
2. `ANTHROPIC_API_KEY`
3. `CLOUDINARY_API_SECRET`
4. `GOOGLE_AI_API_KEY`
5. `RAZORPAY_KEY_SECRET` (regenerate in dashboard; currently a test key)
6. `ENCRYPTION_KEY` — follow the re-encrypt procedure above; the value shipped in
   local `.env` was the example key, so production must already use a real one —
   confirm and rotate if it ever matched the example.
7. Amazon `*_REFRESH_TOKEN`s — regenerate via re-consent if there's any doubt.

---

## After any rotation

- Confirm the affected feature works end-to-end (send a test email, run an AI
  optimization, process a test payment, connect Amazon).
- Remove the secret from local shell history (`history -c` or edit `~/.zsh_history`).
- Record the rotation date so the next one is scheduled.
