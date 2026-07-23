---
id: 0018
title: A shorter reverse-proxy timeout can report failed provisioning while the runner is still creating the VM
severity: high
area: compose-runner, nginx, incus, operations
date: 2026-07-23
---

# 0018 — the clone that kept succeeding after the client saw 504

## What happened

Repeated two-workspace Incus acceptance runs appeared to exceed progressively larger controller deadlines. The
public request always failed while the VM later became healthy, and test cleanup then raced the controller still
working on that VM. Raising only the app/controller values did not help.

## Root cause

The public nginx vhost still had `proxy_read_timeout 700s`. It returned 504 after 11m40s regardless of the
20–29-minute inner timeout ladder, while the loopback controller continued provisioning. In addition,
`IncusSandboxProvider` intentionally serializes new-address/full-VM allocation under one host-allocation lock, so
two simultaneous cold requests do not imply two simultaneous clone operations.

## How to avoid

- Keep every layered deadline strictly outside its callee: VM provision < controller request < app request < public
  reverse proxy. Verify the deployed proxy file, not only application env.
- For long acceptance work, monitor the hypervisor/agent independently from the public HTTP client. A 504 proves
  only that one outer layer stopped waiting.
- Do not trigger destructive cleanup immediately after an outer timeout until the controller request has settled;
  otherwise cleanup races a still-running provision operation.
- Treat host-allocation serialization as intentional safety when calculating a multi-workspace test budget.
