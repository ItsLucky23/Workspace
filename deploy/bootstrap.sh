#!/usr/bin/env bash
# Workspaces from-scratch self-host installer (#7). Idempotent: checks prerequisites, generates the
# secrets into deploy/.env (only the missing ones — never overwrites an existing secret), builds +
# brings up the compose stack, and waits until the app reports ready. Re-runnable safely.
#
# Usage:  cd deploy && ./bootstrap.sh
# Backup/restore + disaster recovery: docs/DR_RUNBOOK.md
set -euo pipefail

cd "$(dirname "$0")"
ENV_FILE=".env"
EXAMPLE=".env.example"

log() { printf '\033[36m[bootstrap]\033[0m %s\n' "$1"; }
die() { printf '\033[31m[bootstrap] ERROR:\033[0m %s\n' "$1" >&2; exit 1; }

# --- 1. prerequisites ---
command -v docker >/dev/null 2>&1 || die "docker is not installed or not on PATH"
docker compose version >/dev/null 2>&1 || die "docker compose v2 is required (got none)"
docker info >/dev/null 2>&1 || die "the Docker daemon is not reachable (is it running? do you have permission?)"

# --- 2. .env: create from example, then fill any MISSING secret (never clobber an existing one) ---
[ -f "$ENV_FILE" ] || { cp "$EXAMPLE" "$ENV_FILE"; log "created $ENV_FILE from $EXAMPLE"; }

gen_secret() { openssl rand -base64 36 | tr -d '\n/+=' | cut -c1-40; }

set_if_empty() {
  # $1 = key. If the key's value in .env is empty, fill it with a generated secret.
  local key="$1" current
  current="$(grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2-)"
  if [ -z "$current" ]; then
    local val; val="$(gen_secret)"
    # portable in-place edit (BSD + GNU sed differ on -i; use a temp file)
    grep -v -E "^${key}=" "$ENV_FILE" > "$ENV_FILE.tmp"
    printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE.tmp"
    mv "$ENV_FILE.tmp" "$ENV_FILE"
    log "generated $key"
  else
    log "$key already set — keeping it"
  fi
}

command -v openssl >/dev/null 2>&1 || die "openssl is required to generate secrets"
set_if_empty REDIS_PASSWORD
set_if_empty WORKSPACES_ENC_KEY
set_if_empty WS_WEBHOOK_SECRET

# --- 2b. VAPID keypair for web push (phone-first: without it push silently no-ops on a fresh install).
# An ECDSA P-256 pair in the base64url shapes web-push expects: public = the 65-byte uncompressed
# point, private = the JWK `d`. Uses host node when present, else a throwaway node container.
set_env_value() {
  local key="$1" val="$2"
  grep -v -E "^${key}=" "$ENV_FILE" > "$ENV_FILE.tmp"
  printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
}

vapid_current() { grep -E "^WS_VAPID_PUBLIC=" "$ENV_FILE" | head -1 | cut -d= -f2-; }

if [ -z "$(vapid_current)" ]; then
  VAPID_JS='const{generateKeyPairSync}=require("crypto");const{publicKey,privateKey}=generateKeyPairSync("ec",{namedCurve:"prime256v1"});const spki=publicKey.export({type:"spki",format:"der"});const raw=spki.subarray(spki.length-65);console.log(Buffer.from(raw).toString("base64url"));console.log(privateKey.export({format:"jwk"}).d);'
  if command -v node >/dev/null 2>&1; then
    VAPID_OUT="$(node -e "$VAPID_JS")"
  else
    VAPID_OUT="$(docker run --rm node:22-alpine node -e "$VAPID_JS")" || die "VAPID key generation failed (need host node or docker)"
  fi
  VAPID_PUB="$(printf '%s\n' "$VAPID_OUT" | sed -n 1p)"
  VAPID_PRIV="$(printf '%s\n' "$VAPID_OUT" | sed -n 2p)"
  [ -n "$VAPID_PUB" ] && [ -n "$VAPID_PRIV" ] || die "VAPID key generation produced no keys"
  set_env_value WS_VAPID_PUBLIC "$VAPID_PUB"
  set_env_value WS_VAPID_PRIVATE "$VAPID_PRIV"
  # subject falls back to PUBLIC_URL's admin mailto shape; override in .env for a real contact.
  CUR_SUBJECT="$(grep -E "^WS_VAPID_SUBJECT=" "$ENV_FILE" | head -1 | cut -d= -f2-)"
  [ -n "$CUR_SUBJECT" ] || set_env_value WS_VAPID_SUBJECT "mailto:admin@localhost"
  log "generated WS_VAPID_PUBLIC/WS_VAPID_PRIVATE (web push enabled out of the box)"
else
  log "WS_VAPID_PUBLIC already set — keeping it"
fi

# --- 3. build the base image the app uses for ticket containers (if the Dockerfile is present) ---
if [ -f "../docker/base.Dockerfile" ]; then
  log "building the ticket base image (workspaces/base:0.1.0)…"
  case "$(docker version --format '{{.Server.Arch}}')" in
    amd64) OVS_ARCH=x64 ;;
    arm64) OVS_ARCH=arm64 ;;
    *) die "unsupported openvscode-server architecture: $(docker version --format '{{.Server.Arch}}')" ;;
  esac
  docker build --build-arg "OVS_ARCH=${OVS_ARCH}" -f ../docker/base.Dockerfile -t "${WS_BASE_IMAGE:-workspaces/base:0.1.0}" .. || die "base image build failed"
fi

# --- 4. the shared ticket-container network (external in compose; the app + ticket containers use it) ---
if docker network inspect workspaces-net >/dev/null 2>&1; then
  [ "$(docker network inspect -f '{{.Internal}}' workspaces-net)" = "true" ] || die "workspaces-net exists but is not internal; recreate it with: docker network rm workspaces-net && docker network create --internal workspaces-net"
else
  log "creating the internal workspaces-net network"
  docker network create --internal workspaces-net >/dev/null
fi

# --- 5. bring up the stack ---
log "building + starting the stack (this can take a few minutes on first run)…"
docker compose up -d --build

# --- 6. wait for readiness ---
log "waiting for the app to become ready…"
for i in $(seq 1 60); do
  if docker compose exec -T app node -e "fetch('http://127.0.0.1:80/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    log "app is READY. Open http://localhost (or your PUBLIC_URL)."
    exit 0
  fi
  sleep 5
done
die "app did not become ready in time — check: docker compose logs app"
