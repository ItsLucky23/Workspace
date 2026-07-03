---
id: 0026
title: Observability — structured logging, metrics, health probes, flow insights
status: accepted
date: 2026-07-03
tags: [workspaces, observability, metrics, logging, health, insights]
supersedes: []
---

# 0026 — Observability

## Context

Goal-item #5: structured logging + metrics + /healthz + /readyz + an insights read
(cycle-time / throughput / cost-per-ticket). The engine logged free-text, exposed no scrapeable
metrics, and had no flow analytics.

## Decision

- **Structured logging** (`server/obs/logger.ts`): a `LogContext` that emits ONE JSON object per
  line (`ts`, `level`, `msg`, + inherited context fields) through the framework logger, so logs are
  grep-/ship-able. `.child()` adds fields for a request/turn trail. `formatLogLine` is pure + tested.
- **Metrics** (`server/obs/metrics.ts` + `/metrics`): the runtime gauges in Prometheus
  text-exposition format — active/queued turns vs the cap (from the CapacityManager #12), busy
  worker sessions, resident containers, and this instance's leader state (#1/ADR 0015). Scrapeable
  by Prometheus/Grafana. `gatherMetrics` is best-effort (a down probe → 0, never throws).
- **Health probes** (`server/obs/endpoints.ts`): READINESS is ALREADY a framework endpoint —
  `config.http.readyEndpoint` (/readyz) checks bootUuid + Redis + Prisma, and `liveEndpoint`
  (/livez) is liveness. We DON'T duplicate them; we add **/healthz** (the liveness path the goal +
  most k8s charts expect, aliasing the framework's /livez) and **/metrics**. Registered pre-params
  so a probe needs no session.
- **Flow insights** (`server/obs/insights.ts`): a pure aggregate over tickets + usage → cycle time
  (mean createdAt→done for done tickets), 7-day throughput (tickets completed), and cost-per-ticket
  (mean tokens across tickets that ran turns). The snapshot emits `insights`; the Usage page renders
  three stat cards. Advisory — never gates anything.
- **Server lib bump** `tsconfig.server.json` ES2022 → ES2023 (node 22 supports it; matches the
  frontend). Fixes a LATENT #16 break — `record.ts` used `Array#toSorted` which ES2022's lib doesn't
  type (caught here; #16's eslint pass hadn't re-run server-tsc).

## Rejected alternatives

- **A JSON /metrics.** Prometheus text is the scraping standard; a JSON blob would need a custom
  exporter.
- **Duplicate /healthz + /readyz handlers.** The framework's /readyz (bootUuid+Redis+Prisma) is more
  complete than a hand-rolled one; adding a redundant readiness route was dead code (the framework's
  ran first). Only /healthz (a named alias) + /metrics fill real gaps.
- **A metrics agent / OpenTelemetry SDK.** Heavy for V1; a text endpoint + structured logs cover the
  operator's needs and a collector can scrape both.
- **Persist insights.** They're cheap to recompute per snapshot from rows already fetched; a
  materialized table would drift.

## Consequences

- Operators get scrapeable metrics + JSON logs + a liveness probe; the framework readiness stays.
- The Usage page shows real cycle time / throughput / cost-per-ticket.
- Verified: `observability.test.mts` (18/18) — log-line format, insights (cycle/throughput/cost),
  Prometheus render, and gatherMetrics against real Redis+Mongo. Full suite 28/28. Curl: /healthz
  200, /readyz (framework) 200 with checks, /metrics 6 gauges. Browser: the Usage insight cards
  render real values (4h cycle, 2 throughput).
