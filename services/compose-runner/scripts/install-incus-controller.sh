#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
dist="${root}/services/compose-runner/dist"

if [[ "${EUID}" -ne 0 ]]; then
  echo "run as root on the Incus host" >&2
  exit 1
fi
if [[ ! -f "${dist}/controller.js" || ! -f "${dist}/incusFirewallHelper.js" ]]; then
  echo "build first: npm run compose-runner:build" >&2
  exit 1
fi
command -v incus >/dev/null || { echo "Incus is required" >&2; exit 1; }

id workspaces-runner >/dev/null 2>&1 || useradd --system --home-dir /var/lib/workspaces-compose-runner --create-home --shell /usr/sbin/nologin workspaces-runner
install -d -m 0755 /opt/workspaces-compose-runner
install -m 0644 "${dist}"/*.js "${dist}"/*.js.map /opt/workspaces-compose-runner/
install -m 0644 "${root}/services/compose-runner/systemd/workspaces-incus-firewall.service" /etc/systemd/system/workspaces-incus-firewall.service
install -m 0644 "${root}/services/compose-runner/systemd/workspaces-compose-runner.service" /etc/systemd/system/workspaces-compose-runner.service
install -d -o workspaces-runner -g workspaces-runner -m 0750 /var/lib/workspaces-compose-runner
install -d -o root -g root -m 0700 /var/lib/workspaces-compose-runner/firewall
systemctl daemon-reload
systemctl enable workspaces-incus-firewall.service workspaces-compose-runner.service

echo "Controller installed. Add its restricted Incus remote and both /etc/workspaces-compose-runner*.env files before starting it."
