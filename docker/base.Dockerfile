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
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg git build-essential python3 \
      postgresql-client default-mysql-client redis-tools \
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

#? Non-root agent (07b §7): baked uid/gid; everything below runs as this user.
RUN useradd --create-home --uid 10001 --shell /bin/bash agent
USER agent
WORKDIR /work

#? Default: stay alive so the orchestrator can exec/attach PTYs per stage. Replaced by the
#? pty-agent entrypoint once that program is baked in (07b §9).
CMD ["sleep", "infinity"]
