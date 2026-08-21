---
title: An integration test reports what it verified, not that it passed
status: accepted
date: 2026-08-21
tags: [integrations, settings, ux, security]
supersedes: []
---

## Context

Workspace settings lets you declare an integration — MongoDB, Postgres, Redis, Kafka, an HTTP API — by
picking a type and pointing each of its fields at an env var. Nothing ever connected to it. The first
time a wrong host or a stale password was discovered was inside a pipeline run, in an agent's container,
where the error surfaces as a stage failure rather than as "your connection string is wrong".

The owner: *"bij workspace/integrations wil ik graag iets maken dat voor alle pre defined tools zoals
mongodb dat waar mogelijk we een ping call toevoegen of iets om de integration daadwerkelijk te testen."*

The hard part is "waar mogelijk". Of the nine predefined types, exactly one (Redis) has a client library
already in this project. Adding `mongodb`, `pg`, `mysql2`, `kafkajs` and `amqplib` for the sake of a
settings-page button is a real dependency decision, not an implementation detail.

## Decision

**A test reports the strongest thing it actually verified, in its own word.**

| Verdict | Means | How it is reached |
|---|---|---|
| `ok` | The protocol answered and the credentials were accepted | Redis `PING` (real, via `ioredis`); an HTTP/Elasticsearch `GET` returning 2xx/3xx |
| `reachable` | The host resolves and the port accepts a connection. **Credentials not verified.** | A TCP dial to the host+port parsed out of the connection string |
| `failed` | It did not work | Refused/timed-out connection, or an HTTP 401/403 |
| `unsupported` | There was nothing to test | No env var mapped, or no host and port could be read from the value |

`reachable` is deliberately a separate word with its own (amber) colour. Collapsing it into `ok` would
recreate exactly the problem this feature exists to remove — a green tick that a wrong password passes.

The result is **persisted** on the `IntegrationTool` row (`lastTestAt/Status/Detail`) rather than shown
once. The list then answers "does this work?" on arrival, for everyone, not only for whoever clicked.

It runs as a control op (`integration-test`) through the Conductor even though its only write is that
verdict, because the Conductor is the one place that decrypts an integration's credentials: the route
passes an id, the plaintext is read, used and dropped inside the op. The op is `EXCLUDED` from the
assistant's propose catalog — it makes this server open an outbound connection to a user-supplied
address, which is not something a chat turn should be able to trigger (same reasoning as
`ai-connection-test`).

## Rejected alternatives

- **Ping everything for real by adding the five client libraries.** The honest full answer, and a real
  option — but five dependencies is the owner's call, and shipping the honest partial version now beats
  waiting. The file is structured so adding one later is a per-type function and nothing else.
- **Validate the connection string instead of connecting.** A parser tells you the string is
  well-formed. Every failure mode the user actually hits — wrong host, closed port, dead container,
  rotated password — passes that check.
- **Report `ok` for a successful TCP dial.** Simpler UI, one word instead of two. It would also be a lie
  for every type except Redis and HTTP, and the lie is precisely "your credentials work".
- **Return the verdict without storing it.** Then the answer belongs to one browser tab for a few
  seconds, and the list is exactly as uninformative as before on the next visit.

## Consequences

- Nine predefined types are testable, one of them (Redis) with real authentication, two (HTTP,
  Elasticsearch) with a real request, the rest as an honest reachability dial.
- `IntegrationTool` gains three nullable columns; a row that has never been tested simply shows no chip.
- The detail line is redacted at the point it is produced (`redact()`), so a password embedded in a
  connection string cannot reach the UI, the stored row, or the audit entry.
- A custom (non-predefined) type still works: it falls through to the TCP dial when its first field
  parses as a host, and reports `unsupported` when it does not — never a false `failed`.
- Adding a real driver later changes one function and the verdict it returns; nothing else moves.
