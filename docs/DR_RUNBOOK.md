# Workspaces — Disaster Recovery runbook

Backup, restore, and disaster recovery for a self-hosted Workspaces install (the `deploy/`
docker-compose stack, #7). Read `docs/HOSTING.md` for the hosting model and `deploy/bootstrap.sh` for
the installer.

> **The one rule that matters most:** `WORKSPACES_ENC_KEY` encrypts every secret at rest (forge
> tokens, editor profiles). **If you lose it, those secrets are unrecoverable** — a data restore
> without the matching key leaves you with undecryptable blobs. Back the key up **separately** from
> the data (a password manager / a sealed secret), never only inside the same volume snapshot.

---

## 1. What state exists (and where)

| State | Lives in | Matters because |
|---|---|---|
| Board/tickets/pipeline/users/config | **MongoDB** (`mongo-data` volume) | the authoritative app data |
| Sessions, seq counters, leases, rate-limits | **Redis** (`redis-data` volume) | mostly ephemeral; safe to lose (sessions re-login) |
| Git repos, editor profiles (encrypted), `_auth`, encrypted secrets | **app-data** volume (`/app/data`) | per-workspace working state + credentials |
| Secrets (enc key, redis pw, webhook secret, OAuth) | **`deploy/.env`** | the keys to everything; the enc key is irreplaceable |
| TLS certs / proxy state | **caddy-data** / **caddy-config** volumes | re-issuable; not critical |

Redis is recoverable state (it rebuilds); the **critical trio is MongoDB + app-data + `.env`**.

---

## 2. Backup

Run on a schedule (cron / a systemd timer). All commands from the `deploy/` directory.

```bash
# 2.1 MongoDB — a consistent dump (replica set makes this point-in-time-safe).
docker compose exec -T mongo mongodump --archive --db=workspaces > backups/mongo-$(date +%F).archive

# 2.2 app-data — repos, encrypted editor profiles, _auth, encrypted secrets.
docker run --rm -v workspaces_app-data:/data -v "$PWD/backups:/backup" alpine \
  tar czf "/backup/app-data-$(date +%F).tar.gz" -C /data .

# 2.3 Redis (optional — it appendonly-persists; include for a faster warm restore).
docker compose exec -T redis sh -c 'redis-cli -a "$REDIS_PASSWORD" SAVE' >/dev/null
docker run --rm -v workspaces_redis-data:/data -v "$PWD/backups:/backup" alpine \
  tar czf "/backup/redis-$(date +%F).tar.gz" -C /data .

# 2.4 The secrets — SEPARATELY, encrypted/off-host. NOT in the same bucket as the data.
#     (Store deploy/.env — above all WORKSPACES_ENC_KEY — in a password manager / sealed secret.)
```

Keep ≥7 daily + ≥4 weekly copies **off the host** (a bucket / another machine). Test a restore
quarterly — an untested backup is a hope, not a backup.

For a source-checkout/dev installation, the equivalent pre-migration command is:

```bash
npm run db:backup
```

It writes the compressed Mongo dump plus available media/repository archives under `data/backups/`,
with SHA-256 checksums and the `WORKSPACES_ENC_KEY` fingerprint in `snapshot-*/manifest.json`. The key
itself is never copied; back it up separately as required above. After an additive `prisma db push`, run
`npm run db:upgrade` for watermarked data backfills and verified pre/post counts.

---

## 3. Restore (same host or a rebuild)

```bash
# 3.1 Stand up the stack WITHOUT starting the app yet (so nothing writes mid-restore).
cp /secure/backup/.env deploy/.env        # the SAME .env — incl. the original WORKSPACES_ENC_KEY
docker compose up -d mongo redis

# 3.2 MongoDB.
cat backups/mongo-YYYY-MM-DD.archive | docker compose exec -T mongo mongorestore --archive --drop

# 3.3 app-data.
docker run --rm -v workspaces_app-data:/data -v "$PWD/backups:/backup" alpine \
  sh -c 'cd /data && tar xzf /backup/app-data-YYYY-MM-DD.tar.gz'

# 3.4 Start the app + proxy.
docker compose up -d
```

Verify: `curl -f http://localhost/readyz` (200), then log in and confirm the boards + that a forge
token still works (proves the enc key matched). A 401/undecryptable-secret symptom means the `.env`
`WORKSPACES_ENC_KEY` does not match the data — restore the correct key.

---

## 4. Disaster recovery — full host loss

1. **Provision a new host** with Docker + docker compose v2.
2. **Clone the repo** (or copy the `deploy/` dir + the app source) to the new host.
3. **Restore `deploy/.env`** from your off-host secret store (the enc key is the linchpin).
4. **Restore the data** (§3.2–3.3) into fresh volumes.
5. `cd deploy && ./bootstrap.sh` — it sees the existing `.env` (keeps the secrets), rebuilds the
   images, and brings the stack up.
6. **Re-point DNS** (the main host + the `*.preview` wildcard) at the new host; Caddy re-issues TLS.
7. Verify `/readyz`, a login, a board, and a per-ticket preview.

**RPO** = your backup interval (daily ⇒ ≤24 h data loss; tighten with more frequent mongodump).
**RTO** = provision + restore time (typically well under an hour for a modest install).

---

## 5. Operational notes

- **Redis loss alone** is survivable: sessions drop (users re-login), leases/seq rebuild. You do not
  need to restore Redis to be functional — it's a warm-cache convenience.
- **Ticket containers are disposable**: the app relaunches them from git + the base image; they are
  not part of the backup set. Only the repos under app-data matter.
- **Never** restore a data snapshot with a *different* `WORKSPACES_ENC_KEY` than the one that wrote
  it — the encrypted secrets won't decrypt (by design; that's the at-rest protection working).
- **Multi-instance** (ADR 0031): if you run N app instances, they share the same Mongo/Redis, so the
  backup/restore procedure is unchanged — back up the shared stores once.
