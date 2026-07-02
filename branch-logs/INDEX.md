# Branch logs — INDEX

| Branch | Log | Last updated | Entries | Status |
|---|---|---|---|---|
| `main` | [main.md](./main.md) | 2026-07-02 03:10 | 26 | **/loop realtime-fan-out (lopend, groen, niet gepusht):** milestone 1 = per-actie `_sync`-events die de delta broadcasten, client MERGET (geen refetch). Infra: `mappers` (`ticketListDelta`/`sprintDelta`/`noteDelta`) + gedeelde `dispatchSync` + conductor geeft delta's terug. Gemigreerd: quick-add, **archive, ticket-edit** (`_api` verwijderd). Vorige /loop: Fase 1 + item 10 + Fase 0 (write-path → getypte `_api`, ADR 0005) + Fase 3 (activity/ticket-edit/notify/comments). front/server tsc 0, lint 0, build groen, integration **12/12**. Nog: bulk-* + add-comment/sprint-create + members/settings → `_sync`; register-flow; container-runtime. |
