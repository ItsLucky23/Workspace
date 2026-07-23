---
id: 0297
title: Compose runner uses one Proxmox QEMU sandbox per workspace
status: accepted
date: 2026-07-22
tags: [compose, proxmox, qemu, isolation, runner, self-hosting]
supersedes: []
---

# 0297 — Compose runner uses Proxmox QEMU sandboxes

## Context

ADR 0288 requires unrestricted user-supplied Docker Compose to leave the Workspaces application daemon and run
inside a dedicated VM/microVM/physical sandbox per workspace. The application-side HTTPS contract existed, but
there was no deployable control-plane, sandbox lifecycle or selected hypervisor. A Docker sidecar or shared remote
daemon would still give one tenant root-equivalent access to other tenants.

## Decision

- The first production runner backend is **Proxmox VE with a full-cloned QEMU VM per workspace**. Proxmox VM
  configuration is the durable identity/state source; the runner remains stateless and reconstructs ownership from
  a marker plus the exact workspace id in the VM description.
- A separately deployed HTTPS control-plane authenticates the Workspaces bearer token, verifies URL/body workspace
  equality, serializes operations per workspace, provisions/reuses the VM and forwards only to that VM's agent.
- A host-level systemd agent inside the disposable VM executes raw Compose. Its bearer token is HMAC-derived per
  workspace and injected after clone over a restricted cloud-init SSH principal; the public runner token is never
  forwarded into a sandbox.
- Isolation is enforced outside the guest by Proxmox firewall rules: deny-by-default ingress, agent access only from
  controller CIDRs, explicitly labelled gateway ports only from Workspaces app CIDRs, and private/metadata egress
  denial before public egress. A guest compromise may own its VM but not change hypervisor rules.
- CPU, RAM and disk quotas are VM limits. Compose command timeouts, request/response caps, project serialization,
  idle garbage collection and an explicit reset endpoint bound lifecycle/DoS impact.
- Cross-daemon service endpoints are opt-in Compose labels. The agent substitutes `{gatewayHost}`, returns bounded
  env values and the controller opens only the declared ports; Workspaces never assumes same-daemon DNS.

## Rejected alternatives

- **Runner container on the Workspaces Docker daemon:** rejected because Docker-socket access is host-root authority.
- **One shared remote Docker daemon:** rejected because unrestricted Compose can inspect or mount other tenants.
- **Incus as the first backend:** viable, but rejected for the first implementation because Proxmox provides the
  selected self-host control plane, template lifecycle, external firewall and operational UI in one system.
- **Firecracker directly:** stronger density, but rejected initially because image, jailer, networking and snapshot
  lifecycle would create a second infrastructure product before the runner contract is proven.
- **SSH-only execution without a guest agent:** rejected because typed bounded responses, health, active-project
  inventory and operation timeouts are harder to enforce safely over arbitrary shell output.

## Consequences

- Operators need Proxmox, a golden cloud-init VM template, a dedicated sandbox subnet/bridge, a restricted API token
  and a restricted SSH bootstrap key. `docs/COMPOSE_RUNNER_DEPLOYMENT.md` is the runbook.
- The control-plane may itself be containerized, but it must not mount a Docker socket and must reach Proxmox plus
  the private VM-agent subnet.
- Repository tests prove protocol, auth, metadata, firewall plans and a real Docker agent lifecycle. Host escape,
  cross-VM denial and quotas remain a required live acceptance test on the operator's actual Proxmox environment.
- A future hypervisor backend requires a new ADR; it must preserve the per-workspace VM and external-firewall
  boundary rather than weakening ADR 0288.
