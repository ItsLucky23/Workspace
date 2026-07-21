---
id: 0291
title: Budgeted capability-aware Workspace-AI tools
status: accepted
date: 2026-07-21
tags: [ai, context, rbac, reliability]
summary: Keep the frozen action catalog but expose at most 36 request-relevant, context-valid and RBAC-permitted actions per chat turn under one central prompt budget.
---

## Context

The Workspace-AI catalog had 148 nominally enabled actions and injected all enabled-module hints into every turn. This consumed context, advertised actions the caller could not authorize, and encouraged semantically weak tool selection. Workspace instructions and enabled skills had no aggregate hard ceiling, so user-managed context could crowd out the feature contract and current request.

## Decision

The catalog remains exhaustive for validation and client dispatch; no verb is added or removed from the frozen surface. For a real chat request, the server filters actions by enabled module, the caller's effective capability vector and availability of every required entity reference. It then ranks the remaining hints against the request and exposes at most 36.

Every one-shot AI feature passes through a provider-independent 64,000-character central budget at `runAiCompletion`: 20,000 current-prompt characters, 32,000 feature-system characters, 4,000 workspace instruction characters, 6,000 skill characters and 2,000 product-capability characters. Truncation is explicit and preserves both the beginning and end of a section.

## Rejected alternatives

- **Delete most catalog actions:** loses useful capability and creates server/client parity churn without improving dispatch correctness.
- **Keep all 148 hints and rely on the model:** wastes context and ignores caller authorization.
- **Apply limits independently at each feature:** duplicated limits drift and miss centrally injected skills/instructions.
- **Budget by one provider's tokenizer:** couples feature code to provider-specific accounting.

## Consequences

- Typical chat turns receive a much smaller, request-shaped tool surface.
- Validation independently rejects disabled or unauthorized generic proposals even if a model invents one.
- Long custom instructions and skill sets are bounded for every AI feature at one choke point.
- Character budgeting is conservative, deterministic and testable, but not an exact provider token count.
