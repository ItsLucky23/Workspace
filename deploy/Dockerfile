# Workspaces app image (#7). Builds the frontend, then runs the LuckyStack server which serves the
# built client + the API/sync on port 80. The Docker CLI is installed so the app can launch per-ticket
# containers against the mounted host socket. Data (repos, encrypted profiles, auth) lives on the
# app-data volume mounted at /app/data.

FROM node:22-bookworm-slim

# Docker CLI (the app shells out to it via WS_DOCKER_BIN to launch ticket containers) + git + curl.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg git \
  && install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
  && chmod a+r /etc/apt/keyrings/docker.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends docker-ce-cli \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (layer-cached on unchanged lockfile).
COPY package.json package-lock.json ./
RUN npm ci

# App source + build the frontend bundle the server serves.
COPY . .
RUN npm run build

# Prisma client for the runtime DB.
RUN npx prisma generate

EXPOSE 80
# Runs the server directly (tsx) on SERVER_PORT (80, set in compose). generateArtifacts refreshes the
# type maps + server request table at boot so a fresh checkout serves correctly.
CMD ["sh", "-c", "npm run generateArtifacts && npm run server:once"]
