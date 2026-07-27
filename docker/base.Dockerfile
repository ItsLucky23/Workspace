# syntax=docker/dockerfile:1
#? Workspaces L1 base image (07b §1.1). glibc (node:22-bookworm-slim, NOT alpine): needed
#? for node-pty's native build (the in-container pty-agent) AND the glibc DB clients (D24).
#? The Claude CLI is pinned to the EXACT version the P0.5 spike verified (Q-CT-CLIPIN) —
#? never @latest; the pin is recorded into org.workspaces.cli-version. CLI upgrades gate
#? behind a semver bump + a --resume/hook smoke test. Tag: workspaces/base:<semver>.
FROM node:22-bookworm-slim

ARG CLAUDE_CLI_VERSION=2.1.198
LABEL org.workspaces.cli-version="${CLAUDE_CLI_VERSION}"

ENV DEBIAN_FRONTEND=noninteractive

#? node-gyp toolchain (node-pty native build at IMAGE time, never at container start) +
#? git/gh clone/MR tooling + curl/ca-certs + the glibc DB clients (psql/mysql/redis).
#? `procps` (ps/pgrep/pkill) is REQUIRED: the engine's kill (`pkill claude`) is a no-op without
#? it (claude leaks per turn), and it aids editor process management. `tar` for profile streaming.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg git build-essential python3 \
      postgresql-client default-mysql-client redis-tools \
      procps tar \
    && rm -rf /var/lib/apt/lists/*

#? gh (GitHub CLI) + mongosh via their signed apt repos, in one layer.
RUN install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && curl -fsSL https://pgp.mongodb.com/server-7.0.asc | gpg --dearmor -o /etc/apt/keyrings/mongodb.gpg \
    && echo "deb [ signed-by=/etc/apt/keyrings/mongodb.gpg ] https://repo.mongodb.org/apt/debian bookworm/mongodb-org/7.0 main" > /etc/apt/sources.list.d/mongodb-org-7.0.list \
    && apt-get update && apt-get install -y --no-install-recommends gh mongodb-mongosh \
    && rm -rf /var/lib/apt/lists/*

#? The pinned Claude CLI + node-pty, prebuilt ONCE at image build. NODE_PATH lets a
#? container-local script (the pty-agent, added later) resolve the global node-pty.
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CLI_VERSION} node-pty
ENV NODE_PATH=/usr/local/lib/node_modules

#? Trust any mounted checkout: the worktree volume + the RO /mirror are host-uid-owned,
#? so git's dubious-ownership guard would refuse them. `safe.directory=*` is ONLY honored
#? from system/global config (NOT `-c` — git ignores that by design), so it must be baked.
RUN git config --system --add safe.directory '*'

#? openvscode-server (real browser VS Code) baked in (Track B1 / ADR 0010) so the per-ticket
#? editor starts instantly — no on-demand download. Pinned version; open-vsx marketplace.
ARG OVS_VERSION=openvscode-server-v1.109.5
# Docker's architecture is amd64 while the upstream asset calls it x64; ARM64 is named arm64.
ARG OVS_ARCH=x64
RUN curl -fsSL "https://github.com/gitpod-io/openvscode-server/releases/download/${OVS_VERSION}/${OVS_VERSION}-linux-${OVS_ARCH}.tar.gz" -o /tmp/ovs.tar.gz \
    && mkdir -p /opt/openvscode \
    && tar -xzf /tmp/ovs.tar.gz -C /opt/openvscode --strip-components=1 \
    && rm -f /tmp/ovs.tar.gz \
    && ln -s /opt/openvscode/bin/openvscode-server /usr/local/bin/openvscode-server
LABEL org.workspaces.openvscode-version="${OVS_VERSION}" org.workspaces.openvscode-arch="${OVS_ARCH}"

#? The in-container pty-agent (07b §9, #11): owns a shell PTY + a DURABLE scrollback ring persisted
#? to the /work volume, so a terminal survives an orchestrator restart + reseeds on reconnect. Baked
#? here (node-pty is the global install above, resolved via NODE_PATH). BUILD CONTEXT = REPO ROOT:
#?   docker build -f docker/base.Dockerfile -t workspaces/base:0.1.0 .
COPY docker/pty-agent/agent.mjs /opt/pty-agent/agent.mjs
#? K4 — the integration MCP servers (e.g. cli-proxy.mjs: query an attached DB via the baked CLI + injected env).
COPY docker/pty-agent/mcp/ /opt/pty-agent/mcp/

#? Non-root agent (07b §7): baked uid/gid; everything below runs as this user. Create /work
#? while still root and hand it to uid 10001 BEFORE declaring the volume mountpoint. A fresh named
#? volume copies this ownership from the image; otherwise git clone fails on /work/.git as non-root.
RUN useradd --create-home --uid 10001 --shell /bin/bash agent \
    && install -d -o agent -g agent /work
USER agent
WORKDIR /work

#? Start the pty-agent in the background (it publishes its port; the orchestrator relays it), and
#? keep the container alive with sleep so `docker exec` (claude turns, stage config) still works.
#? The agent reloads its scrollback from /work/.pty on a container `--restart`. Env PTY_AGENT_PORT
#? (default 7681) is published to the host loopback by `docker run -p 127.0.0.1::7681` (runtime.ts).
CMD ["sh", "-c", "node /opt/pty-agent/agent.mjs & exec sleep infinity"]
