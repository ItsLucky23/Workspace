---
id: 0022
title: A project-aware Conductor still fails if the route drops projectId
severity: critical
area: multi-project, realtime, repository, forge
date: 2026-07-27
---

# 0022 — project scoping must survive every transport hop

## What happened

A second project in one workspace was connected to GitLab and its Repository screen submitted a private clone.
The UI stayed on project 2, but the clone landed in project 1's disk slot and replaced project 1's persisted
`gitUrl`. The Conductor and repo store already supported per-project isolation, so direct integration tests were
green.

## Root cause

The client/provider and `linkRepo` `_sync` route omitted `projectId`. The Conductor accepted an optional project id
for backward compatibility and otherwise resolved the workspace's first project. Tests called the Conductor
directly with `projectId`, bypassing the broken production transport chain.

## How to avoid

- Require `projectId` at project-scoped public route boundaries; never silently default a write to project 1.
- Forward the identity through UI context → generated request type → `_sync` route → Conductor payload.
- Add route-level tests for missing project identity as well as direct writer tests for correct isolation.
- For multi-project acceptance, use two real repositories and verify both the persisted URL and physical bare-repo
  path after each link.
