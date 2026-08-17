---
name: deduplicate-equivalent-functions-across-composed-presets
title: Deduplicate equivalent functions across composed presets
status: accepted
date: 2026-07-27
deciders: [mathijs]
tags: [runtime-maps, presets, functions, multi-instance]
relates: [0037]
---

## Context

Phase-1 service-scoped generation intentionally includes the complete resolved function registry in every preset for runtime safety. A process may compose several non-overlapping atomic presets, but the v0.8.1 runtime loader rejected the repeated function keys before any API could execute. API and sync ownership was disjoint; only the deliberately shared function registry collided.

Generated presets import the same function modules. ESM module caching therefore gives equivalent entries the same exported values, although each generated map creates a fresh wrapper object.

## Decision

Runtime-map composition keeps API and sync collision checks strict. Repeated function keys are accepted only when both generated entries have the same keys and each exported value is reference- or value-identical through `Object.is`. The first equivalent wrapper remains in the merged registry.

A repeated function key whose implementation differs still fails closed as a collision. This detects stale or inconsistent generated artifacts instead of silently selecting one by preset order.

## Rejected alternatives

- **Reject every repeated function key.** Contradicts the documented phase-1 full-registry generation model and makes multi-preset processes unusable.
- **Silently keep the first function entry.** Would hide inconsistent builds and make behavior depend on preset order.
- **Prune functions per service now.** Requires a reliable import graph and was explicitly deferred to phase 2.
- **Replace atomic presets with overlapping role presets.** Violates one-preset-per-service validation and prevents safe local fallback composition.

## Consequences

- Monolith and split-role processes can compose atomic presets while retaining the complete injected function registry.
- Duplicate API or sync ownership remains a hard failure.
- Different function implementations under one key remain a hard failure.
- Future function pruning can optimize artifact size without changing this safety contract.
