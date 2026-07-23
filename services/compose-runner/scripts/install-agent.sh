#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
dist="${root}/services/compose-runner/dist"

if [[ "${EUID}" -ne 0 ]]; then
  echo "run as root inside the golden sandbox VM" >&2
  exit 1
fi
if [[ ! -f "${dist}/agent.js" ]]; then
  echo "build first: npm run compose-runner:build" >&2
  exit 1
fi
command -v node >/dev/null || { echo "Node.js 20+ is required" >&2; exit 1; }
command -v docker >/dev/null || { echo "Docker Engine + Compose v2 are required" >&2; exit 1; }
docker compose version >/dev/null

node_major="$(node -p 'process.versions.node.split(".")[0]')"
(( node_major >= 20 )) || { echo "Node.js 20+ is required" >&2; exit 1; }

id workspaces >/dev/null 2>&1 || useradd --create-home --shell /bin/bash workspaces
install -d -m 0755 /opt/workspaces-compose-agent
install -m 0644 "${dist}"/*.js "${dist}"/*.js.map /opt/workspaces-compose-agent/
install -m 0755 "${root}/services/compose-runner/systemd/workspaces-compose-agent-configure" /usr/local/sbin/workspaces-compose-agent-configure
install -m 0644 "${root}/services/compose-runner/systemd/workspaces-compose-agent.service" /etc/systemd/system/workspaces-compose-agent.service
printf 'workspaces ALL=(root) NOPASSWD: /usr/local/sbin/workspaces-compose-agent-configure\n' > /etc/sudoers.d/workspaces-compose-agent
chmod 0440 /etc/sudoers.d/workspaces-compose-agent
systemctl daemon-reload
systemctl enable workspaces-compose-agent.service

echo "Agent installed. Shut down this VM and publish/convert it as the selected hypervisor's golden image."
