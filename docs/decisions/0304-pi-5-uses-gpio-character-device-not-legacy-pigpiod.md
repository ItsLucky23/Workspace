---
id: 0304
title: Pi 5 uses the GPIO character-device stack, not legacy pigpiod
status: accepted
date: 2026-07-28
tags: [production, raspberry-pi, gpio, systemd, operations]
supersedes: []
---

# 0304 — Pi 5 uses the GPIO character-device stack, not legacy pigpiod

## Context

The production Pi 5 had carried a failed `pigpiod.service` since boot. Debian's packaged pigpio 1.79 rejected the
Pi 5 revision `e04171` as “not a raspberry pi” because legacy pigpio does not support the RP1 GPIO architecture.
Nothing in Workspaces, its deployment units, cron configuration or reverse systemd dependencies consumes pigpiod.
The supported `libgpiod`/`lgpio` character-device stack is installed, and `gpioinfo gpiochip0` successfully
enumerates the Pi 5 GPIO lines.

## Decision

- Disable and mask `pigpiod.service` on the production Pi so an incompatible, unused daemon no longer leaves the
  host degraded after each boot.
- Keep the installed packages for compatibility; do not purge them as part of an application deployment.
- Use the existing `libgpiod`/`lgpio` character-device interfaces if Workspaces ever gains a real GPIO feature.
- Do not spoof a Raspberry Pi revision or patch pigpio's hardware check merely to make an unused daemon start.

## Rejected alternatives

- **Force or patch pigpiod to accept the Pi 5 revision:** rejected because passing the model check does not make its
  legacy peripheral implementation compatible with RP1 and risks unsafe GPIO access.
- **Purge every pigpio package:** rejected because masking the unused unit resolves boot health without an
  unnecessary package-removal blast radius.
- **Leave the failed service as harmless noise:** rejected because failed systemd units hide real production faults
  and repeatedly misreport host health.

## Consequences

- `pigpiod.service` is intentionally `masked` and `inactive`, not failed.
- `systemctl --failed` no longer lists pigpiod.
- GPIO remains available through the supported character-device tooling (`gpioinfo` verified).
- A future feature that truly requires the pigpio network protocol must choose a Pi-5-compatible implementation
  explicitly rather than unmasking this legacy daemon.
