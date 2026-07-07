---
title: An outbound webhook automation action (X2, outbound half)
status: accepted
date: 2026-07-07
tags: [automation, webhooks, extensibility, freedom-program]
---

## Context

FREEDOM_PROGRAM item **X2**. The automation `ActionExecutor` could only notify / emit-signal / start-stage /
invoke-agent-role — all internal. There was no way for a workspace event to reach the user's OWN systems (post
to their URL). Extensibility "plug the AI into the user's world" needs an egress.

## Decision

- A `webhook` `TriggerActionKind`: `executeTriggerAction` POSTs a compact event envelope
  (`{ event, ticketKey, payload, workspaceId }`) to a user-configured `params.url`. Requires `http(s)`; a
  non-2xx or a thrown request is an `error` outcome (best-effort — a bad webhook never wedges the pipeline,
  consistent with every other action). The poster is module-injectable (`__setWebhookPoster`) so it's tested
  offline. Surfaced in the AutomationPanel with a URL field.

## Rejected alternatives

- **A per-workspace webhook registry model.** A trigger already carries `params`; the URL lives there like every
  other action's config — no new model needed for the outbound half.
- **Signing / SSRF-blocking now.** The URL is the workspace-owner's own configured endpoint on a self-hosted
  tool; request signing (HMAC) + blocking internal targets are a hardening follow-up, called out in-code.
- **A synchronous, retried delivery.** Best-effort single POST matches the other fire-and-forget actions; a
  durable delivery queue is a larger, separate concern.

## Consequences

- A workspace event can now POST to any user endpoint (Zapier/n8n/their own service), tested via the injectable
  poster (`webhookAction` 12/12). The INBOUND half of X2 (a user-configurable signed webhook that fires a
  `WorkspaceTrigger`) + request signing + SSRF hardening are documented follow-ups.
