---
id: 0298
title: Compose runner supports Incus QEMU sandboxes on ARM64
status: accepted
date: 2026-07-23
tags: [compose, incus, qemu, arm64, isolation, runner, self-hosting]
supersedes: [0297]
---

# 0298 — Compose runner supports Incus QEMU sandboxes on ARM64

## Context

ADR 0297 selected Proxmox VE as the first hypervisor implementation for ADR 0288's mandatory one-full-VM-per-workspace
boundary. The deployment host is a Raspberry Pi 5 with ARM64 and hardware KVM. Proxmox VE does not provide a
supported ARM64 distribution, so that implementation cannot run on the selected host. Falling back to containers,
a shared Docker daemon or guest-controlled firewalling would violate ADR 0288.

The Pi kernel also lacks `nf_conntrack_bridge`, so Incus bridge filtering cannot be the only external isolation
control. Cold full-VM creation on the Pi's directory storage can approach ten minutes.

## Decision

- Keep the provider boundary and the Proxmox implementation, and add **Incus full KVM VMs** as an equal controller
  backend selected with `RUNNER_PROVIDER=incus`.
- Use one restricted Incus project, one dedicated bridge/subnet and one full VM per workspace. Incus metadata is the
  durable ownership/last-used source; controller restarts reconstruct state from it.
- Enforce ingress, anti-spoofing, cross-workspace denial, private/LAN/metadata egress denial and explicit gateway
  ports outside the guest. On this host a minimal root-only nftables helper accepts bounded operations over a Unix
  socket; the non-root controller never receives nftables privileges.
- Preserve the same workspace-derived HMAC guest token and in-VM Compose agent contract used by Proxmox. Public
  bearer credentials never enter guest Compose interpolation.
- Run exactly one controller replica because allocation and workspace locks remain in-process.
- Build the ticket image architecture-aware (`amd64 → x64`, `arm64 → arm64`) so openvscode-server and native
  `node-pty` match the host.
- Size cold-provision timeouts from measured hardware. The Pi deployment uses 14 minutes for provisioning, 15
  minutes for the controller request and 16 minutes for the app client.

## Rejected alternatives

- **Unsupported Proxmox-on-ARM ports:** rejected because production isolation must not depend on an unofficial,
  unmaintained control plane.
- **Incus system containers:** rejected because unrestricted privileged Compose requires a separate kernel and
  Docker daemon per workspace.
- **Guest iptables only:** rejected because a compromised privileged stack can rewrite guest firewall rules.
- **Giving the Node controller root/CAP_NET_ADMIN:** rejected; the narrow root helper has a materially smaller
  command and parsing surface.
- **Keeping ten-minute timeouts after the live failure:** rejected because the VM and agent became healthy seconds
  after the deadline, creating false failures and leaked cleanup work.

## Consequences

- `services/compose-runner/` now ships both Proxmox and Incus providers; ADR 0288 remains unchanged and load-bearing.
- ARM64 operators need Incus, QEMU/KVM, a golden VM image and the root firewall helper/systemd unit.
- The controller remains non-root with `NoNewPrivileges=true`; compromise of a sandbox or controller does not grant
  arbitrary host firewall commands.
- The live Pi acceptance proved unrestricted Compose, gateway ingress, private/cross-workspace denial, quotas,
  teardown and controller-to-agent auth. Other hosts must repeat those checks for their own topology.
