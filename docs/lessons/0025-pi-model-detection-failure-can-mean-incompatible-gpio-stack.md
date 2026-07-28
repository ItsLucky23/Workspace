---
id: 0025
title: Pi model-detection failure can mean an incompatible GPIO stack
severity: medium
area: production, raspberry-pi, systemd
date: 2026-07-28
---

# 0025 — do not bypass hardware detection before proving compatibility

## What happened

`pigpiod.service` failed on a real Raspberry Pi 5 with `unknown rev code (e04171)` followed by “this system does
not appear to be a raspberry pi”. The message looked like a bad VM/container detection check, but the daemon was
running directly on the host.

## Root cause

The installed pigpio 1.79 stack predates/does not support the Pi 5 RP1 GPIO architecture. Its revision rejection is
a compatibility warning, not merely an overly strict permission check. The service was enabled transitively by an
installed package even though Workspaces never uses it.

## How to avoid

- Confirm the hardware revision, package version, consumers and reverse systemd dependencies before patching a
  model check.
- On Pi 5, prefer the kernel GPIO character-device stack (`libgpiod`/`lgpio`) and prove it with `gpioinfo`.
- If no product feature consumes an incompatible daemon, disable and mask it instead of spoofing hardware support.
- Keep intentionally masked units documented so a future operator does not “repair” them back into a boot failure.
