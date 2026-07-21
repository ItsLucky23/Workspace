# Workspaces app image (#7). Builds the frontend, then runs the LuckyStack server which serves the
# built client + the API/sync on port 80. The Docker CLI is installed so the app can launch per-ticket
# containers against the mounted host socket. Data (repos, encrypted profiles, auth) lives on the
# app-data volume mounted at /app/data.

FROM node:22-bookworm-slim

# Docker CLI (the app shells out to it via WS_DOCKER_BIN to launch ticket containers) + git + curl +
# build tools (python3/build-essential) so native deps like node-pty compile during install.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg git python3 build-essential \
  && install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
  && chmod a+r /etc/apt/keyrings/docker.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends docker-ce-cli \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Production is explicit, not inferred. Security gates must never treat an unset NODE_ENV as development
# in the self-host image (the historical terminal bridge did, exposing an app-container shell).
ENV NODE_ENV=production

# Install deps first (layer-cached on unchanged lockfile). Prefer the reproducible `npm ci`, but fall
# back to `npm install` when the lockfile is out of sync with the target platform — a package-lock.json
# generated on a different OS (e.g. a Windows dev box) can omit linux-only optional native deps
# (@emnapi/*, platform @rollup/* etc.), which `npm ci` refuses. `npm install` resolves them for linux.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund || (echo "lockfile out of sync for this platform — resolving with npm install" && npm install --no-audit --no-fund)

# App source + build the frontend bundle the server serves. Give V8 a bigger heap — the Vite/Rollup
# build OOMs (exit 134) under the default limit on a modest builder.
COPY . .
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN npm run build

# Prisma client for the runtime DB.
RUN npx prisma generate

EXPOSE 80
# Runs the server directly (tsx) on SERVER_PORT (80, set in compose). generateArtifacts refreshes the
# type maps + server request table at boot so a fresh checkout serves correctly.
CMD ["sh", "-c", "npm run generateArtifacts && npm run server:once"]
