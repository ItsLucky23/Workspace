# TESTING_STRATEGY — the hardest code (orchestrator / Conductor / event-log)

> The test contract for the code the framework's auto-sweep **cannot reach**: the deterministic Conductor, the engine driver (interactive `claude` PTY), the append-only event-log, and the frozen verb surface. The framework's two test systems (`docs/ARCHITECTURE_TESTING.md`) cover **API/sync routes**; this doc covers everything that runs *outside* the `_api`/`_sync` lifecycle — the orchestrator process, its background workers, and the protocol invariants.
>
> **Authority.** Realizes `Q-INF-TESTING` (LOCKED 2026-06-04: "deterministic-Conductor unit tests · a fake/record-replay EngineDriver · a regression test pinning the event-log subscribe-before-fetch ordering as the FIRST vertical slice · the P0 spike as a gate"). Carries `Q-ENG-VERB-CONFORMANCE`, `Q-ENG-SPIKE`, `Q-ENG-CARRYOVER-ENFORCE`, `Q-ENG-TURNEND`. Architecture cites: [01 §3.3] (Conductor = the only writer, deterministic, no LLM), [01 §4] (SessionManager / `resumeAll`), [02 §1] (state machine), [02 §2] (frozen verb surface), [02 §3] (hooks). Data shapes: [04b §6] (TicketEvent + `seq`), [04b §7] (canonical AgentSession). Codes via [REFERENCE_CODES → B-23, B-O6, B-35, G2, G8/G16, B-22].
>
> **No new verbs.** This doc adds test scaffolding only; it introduces no protocol surface, no persistence, and no verb. The `VERB_REGISTRY` it pins is the *existing* frozen surface (02 §2: 7 worker + 6 assistant verbs, all read|propose, none write) rendered as an executable fixture.

---

## 0. Why the framework's test systems are necessary but not sufficient

The framework (`docs/ARCHITECTURE_TESTING.md`) ships two independent systems:

| System | Reaches | What it proves for Workspaces |
|---|---|---|
| **vitest unit** (`*.test.ts`, no server, ~1s) | pure functions, DI-mocked logic | the layer this doc builds on — Conductor rules, the verb registry, the event-log merge, the engine driver are all pure-or-DI-mockable |
| **`@luckystack/test-runner` integration** — auto-sweep + per-route (`*.tests.ts`, live server) | every `_api`/`_sync` route: contract / auth-enforcement / rate-limit / fuzz | the **`[control-API]`** route family (the only WRITE surface the web-app calls — `Q-ENG-CONTROL-API`) |

**The gap.** The hard code is **not** an API route:

- The **Conductor** ([01 §3.3]) is plain TypeScript in a single-instance orchestrator process — *the only actor that writes* `Ticket.status` / `TicketEvent` / `CarryOver` / promotions. The auto-sweep never calls it; it is invoked by hook-ingress, the signal loop, and `[control-API]`-enqueued actions.
- The **EngineDriver** (the single-spawn wrapper around `cmd:'claude'`, `Q-MP-SEAM`) drives an interactive PTY billed to the Max subscription ([01 §1]). Exercising it for real **burns subscription turns** and is non-deterministic.
- The **event-log** ([04b §6]) is an append-only Mongo stream with a Redis-`INCR` `seq`; its correctness is an *ordering* property (subscribe-before-fetch, merge-on-`seq`), not a route contract.
- The **verb surface** ([02 §2]) is a *frozen* invariant (B-23: no write verb). Prose can't enforce it; a builder can silently add one.

So Workspaces layers a **third tier — orchestrator unit + contract tests** — on top of the framework's two. It lives in the orchestrator package and runs under the same `vitest` runner the framework already configures (`packages/*/src/**/*.test.ts`, `npx vitest run`, ~1s, no infrastructure). Nothing here needs a live server; everything seams on DI mocks — which is exactly why the engine, Conductor, and event-log were designed around injectable boundaries.

**The four pillars** (each a section below):

1. **Deterministic-Conductor unit tests** — no live LLM, no PTY (§2).
2. **Fake / record-replay EngineDriver** — test engine logic without burning subscription turns (§3).
3. **Event-log subscribe-before-fetch regression** — the FIRST vertical slice, pinned (§4).
4. **`VERB_REGISTRY` conformance + the `types.ts`↔DATAMODEL drift script** (§5).

Plus the **P0 CLI spike as a scheduled gate** (§6) and how it all layers (§7).

---

## 1. Test layering map (where each kind of test lives)

```
                         npx vitest run                      npm run test (live server)
  ┌───────────────────────────────────────────────┐   ┌──────────────────────────────────┐
  │  TIER 3 — orchestrator unit + contract (THIS)  │   │  TIER 1/2 — framework integration │
  │  ───────────────────────────────────────────  │   │  ───────────────────────────────  │
  │  • Conductor rules (§2)        deterministic   │   │  • auto-sweep: contract / auth /  │
  │  • EngineDriver replay (§3)    no subscription │   │    rate-limit / fuzz — every route│
  │  • event-log merge (§4)        the 1st slice   │   │  • per-route .tests.ts for the    │
  │  • VERB_REGISTRY conformance (§5)              │   │    [control-API] family            │
  │  • types↔DATAMODEL drift script (§5)           │   │                                    │
  └───────────────────────────────────────────────┘   └──────────────────────────────────┘
          fast · no server · DI-mocked seams                  live server · Redis · Prisma

  SCHEDULED GATE (not in the unit run): P0 CLI spike (§6) — blocks P1 lanes B/C/F until green.
```

**Suffix discipline** (inherits the framework's collision-free rule, `docs/ARCHITECTURE_TESTING.md`): orchestrator unit files end in **`.test.ts`** (singular — discovered by `vitest`); per-route integration files end in **`.tests.ts`** (plural — discovered by `test-runner`). The two never collide. The P0 spike is a **manual/CI gate**, not a `vitest` file (it spawns a real CLI and must not run in the ~1s sandbox).

---

## 2. Deterministic-Conductor unit tests (no live LLM)

The Conductor ([01 §3.3]) is the single highest-value test target because it is **the only writer** and it is **already deterministic** — given the same input event + the same DB state, it produces exactly one output transition. That property is the whole point of the no-LLM coordination design ([02 §6]); the tests *enforce* it.

### 2.1 The seam — inputs in, writes out

The Conductor is a pure reducer wrapped by DI-injected effects. Model it as:

```
conductor.apply(event, state) → { transitions: Transition[], writes: Write[], emits: SocketEmit[] }
```

where `event` is one of the inputs it serializes (a hook payload from [02 §3], a `WorkspaceSignal` row from the serial loop [02 §6], a `[control-API]`-enqueued user action, or a watchdog tick), and `state` is the relevant slice (ticket, open QuestionSet, AgentSession row). **The reducer never touches Prisma/Redis/PTY directly** — those are injected (`tenantDb`, `redisIncr`, `sessionManager`, `clock`) exactly like the framework's `registerPrismaClient`/`registerRedisClient` DI seams (`docs/ARCHITECTURE_TESTING.md` → "DI registries … precisely so their logic can be tested"). A test swaps each seam for a `vi.fn()` spy and asserts on `writes`/`emits`.

This makes every Conductor test a **pure unit test**: feed an event, assert the transition + the writes. No server, no Redis, no PTY.

### 2.2 The state-machine matrix (the core suite)

[02 §1] is a finite state machine over `{ stageId, statusKey }` with `statusKey ∈ idle|needs-input|busy|done|paused|stuck` and exactly **three user levers** (answer / promote / pause-resume). Every edge is a test case:

| From | Input | Expected transition | Expected writes | Citation |
|---|---|---|---|---|
| `(stage, idle)` | user `start`/promote into an `aiEnabled` stage | → `(stage, busy)` | spawn worker; `TicketEvent(status-change)` | [02 §1] |
| `(stage, busy)` | `request_input` verb / `Notification(permission_prompt)` hook | → `(stage, needs-input)` | persist `QuestionSet(open)`; `Notification`; emit `ws-ai:needs-input` | [02 §1,§5] |
| `(stage, needs-input)` | user answers QuestionSet | → `(stage, busy)` | stamp answers; `--resume` same `claudeSessionId`; no new container | [02 §1] |
| `(stage, busy)` | `emit_carryover` + Stop hook | → `(stage, done)` | validate envelope; persist `CarryOver`; mark `done`; **no auto-advance** | [02 §1,§4] |
| `(stage, done)` | user `promote→next` | → `(nextStage, busy)` | inject A→B carry-over; spawn next | [02 §1,§4] |
| `(stage, busy)` | heartbeat stale / `idle_prompt` / max-turns | → `(stage, stuck)` | watchdog verdict (§2.3) | [01 §4], B-35 |
| `(stage, *)` | user `pause` | → `(stage, paused)` | suspend session; `containerId` KEPT | [02 §1], [04b §7] |
| `(stage, paused)` | user `resume` | → `(stage, busy)` | `--resume` | [02 §1] |
| final `done` | user `promote` | → ticket terminal | tear down container; retain branch + TicketEvents | [02 §1] |

**Invariant assertions that must hold across the whole matrix** (each its own test, asserting on *every* output of `apply`):

- **Only the Conductor writes `Ticket.status`** — no input event with `actor !== 'conductor'` ever produces a status `Write` except via the reducer (B-23, [01 §3.3]).
- **`busy→done` never auto-advances** unless a `stage.on_complete → start-stage` trigger is present in `state` ([02 §1]); test both with and without the trigger.
- **`needs-input→busy` resumes the SAME session** (`--resume <claudeSessionId>`, never a fresh spawn) — assert the `sessionManager.resume` spy got the stored id, not `spawnWorker` ([02 §1]).
- **`approve` QuestionSet on a `done` stage == promote** — the same transition as the desktop button ([02 §5]).

### 2.3 The `stuck` / carry-over-enforcement loop (`Q-ENG-CARRYOVER-ENFORCE`, `Q-ENG-TURNEND`)

The deterministic backstop that forces a free-running PTY to emit `emit_carryover` is the hardest Conductor behavior and gets its own suite. The Stop hook is **both** the turn-end signal (slot release, `Q-ENG-TURNEND`) and the reconciliation trigger:

- **Stop with schema-valid carry-over** → `done`, release the active-turn slot ([01 §6] FIFO), offer promote.
- **Stop with NO schema-valid output** → `--resume` the SAME session with the hard templated demand; assert the resume spy fired with the enforcement prompt, status stays `busy`.
- **N consecutive failed Stops** (parametrize N) → Conductor marks `stuck` → forces `needs-input` with a **system-authored** question; assert the `QuestionSet` is persisted with `actor:'conductor'` and a `Notification` fires.
- **Schema-reject → retry** → an `emit_carryover` whose envelope fails validation triggers a retry, not a `done`; assert no `CarryOver` write on the rejected attempt.

Drive these with a **fake clock** (`vi.useFakeTimers()`): advance past the idle threshold to fire the watchdog's three `stuck` signals ([01 §4]: stale heartbeat / `idle_prompt` / max-turns) without real time. The watchdog is the one place where wall-clock would make a test flaky — inject `clock` and never use real `setInterval`.

### 2.4 The serial signal loop (B-O6, under-a-lease determinism)

The Conductor consumes `WorkspaceSignal` rows **serially, `seq`-ordered, under a Redis lease** ([02 §6], B-O6). Tests feed an ordered batch and assert:

- **Serial application** — given signals at `seq` 1..5, the reducer is called in `seq` order; a deliberately out-of-order feed is sorted before apply (reordering is a bug, gaps are tolerated — mirror the `seq` contract in [04b §6]).
- **Deterministic rules fire inline** — `observation` of two tickets touching the same file → a `link-tickets` `WorkspaceSuggestion(open)` with **no LLM call** (assert the `assistant`/`reasoner` spawn spy was never called).
- **LLM-judgement signals defer** — `config-observation` with no user online → the signal is left for the Assistant/optional reasoner, NOT acted on (assert no `WorkspaceSuggestion` write, `processedAt` stays null). With a connected Assistant, assert it routes to `propose_suggestion`.
- **`stopped` path** — `emit_signal('stopped', {reason, userQuestion?})` → `stuck` → `needs-input` + `Notification` ([02 §6]).
- **Idempotency under the lease** — re-feeding an already-`processedAt` signal is a no-op (the lease guarantees single-consumer; the test proves the reducer is also idempotent so a crash-replay can't double-apply).

### 2.5 RBAC / proposes-only at the Conductor boundary (B-23)

[02 §7] is a table of *who may execute what*. The Conductor enforces the *caller's* role on every user-approved proposal. Tests:

- A **Member** accepting a `config-review` patch → `{ ok:false, reason:'forbidden' }`, **no** config write (B-28: Member has no pipeline-edit).
- An **Admin** accepting the same → executes (the patch `Write` is emitted).
- **Single-Owner invariant** ([04b §11e], D77) — self-demotion of the sole Owner via a `[control-API]` membership action → blocked in the reducer, no write.

These mirror the framework auth-enforcement sweep, but at the *Conductor* layer (the sweep proves the `_api` route rejects anonymous callers; this proves the Conductor rejects an under-privileged authenticated caller after the route admitted them).

---

## 3. Fake / record-replay EngineDriver (no subscription turns)

The EngineDriver is the single internal wrapper around `cmd:'claude'` + the three `SessionManager` spawns (`Q-MP-SEAM`, [01 §4]). Real engine runs are non-deterministic *and* meter the Max subscription ([01 §1]) — untestable in CI. The driver exposes a narrow interface so a **fake** stands in:

```ts
interface EngineDriver {
  spawn(spec: SpawnSpec): Promise<EngineHandle>;   // renders the fixed claude invocation (never user-supplied, [01 §8])
  send(handle, text): void;                         // prompt + '\r'
  resume(handle, claudeSessionId): Promise<EngineHandle>;
  kill(handle): void;
  // events the orchestrator consumes — the NORMALIZED set (the conformance bar, Q-MP-SEAM):
  //   SessionStart · PostToolUse · PostToolUseFailure · Notification · Stop · PreCompact ([02 §3])
}
```

### 3.1 The fake driver (synthesize the normalized event set)

`FakeEngineDriver` emits a scripted sequence of the **normalized [02 §3] events** without launching a process. Because the orchestrator was built to consume *that* event set (not raw PTY bytes), the Conductor + SessionManager are fully exercisable against the fake. A test scripts, e.g.:

```
SessionStart → PostToolUse(Write) → Notification(permission_prompt) → [hold] → Stop(no carryover)
```

and asserts the Conductor walked `busy → needs-input → … → stuck`-enforcement (§2.3) — **zero subscription turns**.

This is also the **multi-provider conformance harness** (`Q-MP-SEAM`, the 3-point bar): any future adapter MUST (a) run a turn in the work context, (b) emit this normalized event set, (c) honor the carry-over JSON contract + expose the verbs as tool calls. The fake driver *is* the executable definition of that bar; a second driver passes the same suite or it isn't conformant. **The hard forward-compat constraint** — an adapter exposes ONLY the frozen read/propose verbs as tools, never a write tool — is checked by §5's registry test applied to the driver's declared tool set.

### 3.2 Record-replay (pin the ONE real CLI shape, deterministically)

The fake is hand-authored; record-replay captures the *real* CLI's hook/usage payload shapes once and replays them. During the **P0 spike** (§6) and any pinned-CLI-version bump, capture the literal `type:http` hook bodies (`SessionStart`/`PostToolUse`/`Stop`/`Notification`/`PreCompact`) and the per-turn usage payload (`Q-ENG-TOKENFEED`) into `_fixtures/engine/<cliVersion>/`. `ReplayEngineDriver` feeds those recorded payloads back. This pins driver-ingest logic — hook parsing, `claudeSessionId` capture, the `tokenEstimate` extraction (hook-payload-if-present-else-char-count, advisory per `Q-ENG-TOKENFEED`) — against **real** bytes without a live CLI, and **stamps the `cliVersion`** so a fixture is bound to the exact pinned CLI ([04b §7] `cliVersion`, `Q-CT-CLIPIN`). When the pinned CLI changes, re-record; a replay test failing after a bump is the signal that the CLI's hook shape drifted (the audit answer to "which CLI built this MR").

### 3.3 What the driver layer must NOT test in unit

The clean-env guard ([01 §1]: `ANTHROPIC_API_KEY`/`AUTH_TOKEN`/`apiKeyHelper` must be unset so the subscription is used) and the actual subscription-billing behavior are **only** verifiable against the live CLI — they belong to the P0 spike (§6), not the fake. The unit layer asserts the driver *constructs* a clean-env spawn spec; the spike asserts the env actually bills the subscription.

---

## 4. Event-log subscribe-before-fetch regression — the FIRST vertical slice

> **Build order (`Q-INF-TESTING`, locked):** this is the FIRST regression test written — before the Conductor matrix, before the engine fake. It pins the single ordering guarantee the whole real-time surface rests on; if it isn't pinned first, every later slice inherits a silent race.

### 4.1 The property under test (G2 / B-22 / [04b §6])

The event-log is append-only with a **monotonic per-ticket `seq`** from Redis `INCR` ([04b §6], G2). `seq` — **not `createdAt`** — is the merge/dedupe key (clock skew across instances makes timestamps unsafe; D83 dedupes by `seq`). Catch-up after reconnect is **subscribe-first → snapshot → merge-on-`seq`** (B-22, [01 §5]):

1. The client **subscribes** to the live event channel (the `/pty`-sibling channel, [04b §6]).
2. THEN **fetches** the snapshot up to the highest `seq` (`snapshotMax`).
3. THEN **merges** live events with `seq > snapshotMax`, discarding duplicates.

The race the test pins: **an event arriving between the snapshot read and the subscribe is lost** if the order is fetch-then-subscribe. Subscribe-first + merge-on-`seq` closes it (the in-flight event is buffered by the subscription and de-duped on merge).

### 4.2 The deterministic test (subscribe-before-fetch, no live server)

Build it as a pure merge unit + a fake transport that lets the test **inject an event at the exact dangerous interleaving**:

```ts
// pseudo — a controllable fake channel + a snapshot fn the test sequences by hand
it('does not drop an event that arrives between snapshot and subscribe-merge', async () => {
  const log = new EventLogClient({ channel: fakeChannel, fetchSnapshot });
  fakeChannel.onSubscribe(() => {
    //? an event lands AFTER subscribe but its seq is > snapshotMax — must survive
    fakeChannel.deliver({ ticketId, seq: 6, type: 'file-change' });
  });
  fetchSnapshot.mockResolvedValue({ events: upTo(seq <= 5), snapshotMax: 5 });

  await log.catchUp(ticketId);

  expect(log.events.map(e => e.seq)).toEqual([1,2,3,4,5,6]); // 6 not lost, not duplicated
});
```

Cases the suite pins:

- **No-drop at the boundary** — an event at `snapshotMax+1` delivered during the subscribe window survives (above).
- **De-dupe on overlap** — an event present in BOTH the snapshot AND the live buffer (same `seq`) appears once (D83 `seq` dedupe).
- **Gap detection** — receiving `N+2` after `N` (a burned/lost `seq`) triggers a re-fetch of the gap (G12: client-side seq-gap detection; gaps tolerated, reordering not).
- **Ordering, not timestamp** — two events with out-of-order `createdAt` but in-order `seq` merge in `seq` order ([04b §6]: clock skew is real across instances).
- **Subscribe-FIRST is mandatory** — a fetch-then-subscribe ordering FAILS the no-drop case (a negative test proving the order matters, so a refactor that flips it goes red).

### 4.3 Why this is the highest-leverage single test

The event-log is the truth source ([01 §5]: "the DB via the Conductor is the source of truth"); notifications (doc 18), board projections (doc 12), and the activity feed (doc 20) all derive from it. A dropped event is a **silent** data-loss bug that surfaces as "the board is wrong sometimes" — the worst kind. Pinning the merge ordering as the first slice means every downstream projection inherits a correct base. The Redis `INCR` itself is mocked (a counter spy); the test owns the *merge* logic, which is where the race lives.

---

## 5. VERB_REGISTRY conformance + types↔DATAMODEL drift (`Q-ENG-VERB-CONFORMANCE`)

The B-23 no-write-verb guarantee is **structural** — it must be an executable test, not prose ([02 §7] "guaranteed by the architecture, not by prompt discipline"). [REFERENCE_CODES → B-23] makes this the most-cited code (~40 sites); a single silently-added write verb breaks the whole autonomy contract.

### 5.1 The single source `VERB_REGISTRY`

One registry is the source of truth for the frozen surface ([02 §2]): **7 worker verbs** (`report_status`, `emit_event`, `request_input`, `emit_carryover`, `emit_signal`, `emit_handoff`, `query_context`) + **6 assistant verbs** (`get_ticket`, `list_tickets`, `read_pipeline`, `propose_suggestion`, `draft_questionset`, `refresh_docs`), each tagged `read | propose`, **none `write`**. The CLI/HTTP helper (and the optional MCP server, [02 §2]) is **generated FROM** this registry — so the registry and the wire surface cannot drift.

```ts
export const VERB_REGISTRY = [
  { name: 'report_status',     role: 'worker',    kind: 'read'    },
  { name: 'emit_event',        role: 'worker',    kind: 'propose' },
  { name: 'request_input',     role: 'worker',    kind: 'propose' },
  { name: 'emit_carryover',    role: 'worker',    kind: 'propose' },
  { name: 'emit_signal',       role: 'worker',    kind: 'propose' },
  { name: 'emit_handoff',      role: 'worker',    kind: 'propose' },
  { name: 'query_context',     role: 'worker',    kind: 'read'    },
  { name: 'get_ticket',        role: 'assistant', kind: 'read'    },
  { name: 'list_tickets',      role: 'assistant', kind: 'read'    },
  { name: 'read_pipeline',     role: 'assistant', kind: 'read'    },
  { name: 'propose_suggestion',role: 'assistant', kind: 'propose' },
  { name: 'draft_questionset', role: 'assistant', kind: 'propose' },
  { name: 'refresh_docs',      role: 'assistant', kind: 'propose' },
] as const;
```

### 5.2 The conformance test

```ts
describe('VERB_REGISTRY conformance (B-23, no-write-verb guarantee)', () => {
  it('contains NO write verb', () => {
    expect(VERB_REGISTRY.every(v => v.kind !== 'write')).toBe(true); // there is no 'write' kind
  });
  it('every AgentRole tool set is a subset of the registry', () => {
    for (const role of ALL_AGENT_ROLES)               // worker roles + the per-user Assistant
      for (const tool of role.tools)
        expect(REGISTRY_NAMES.has(tool)).toBe(true);   // no role exposes an off-registry tool
  });
  it('assistant sessions expose ONLY read|propose verbs', () => {
    const assistantTools = toolsFor('assistant');
    expect(assistantTools.every(v => v.kind === 'read' || v.kind === 'propose')).toBe(true);
  });
  it('emit_output is NOT a verb', () => {                // Q-ENG-VERB-EMITOUTPUT — collapsed into emit_carryover
    expect(REGISTRY_NAMES.has('emit_output')).toBe(false);
  });
  it('the generated CLI/MCP helper surface equals the registry', () => {
    expect(generatedHelperVerbs().sort()).toEqual(REGISTRY_NAMES.sorted()); // generator can't add a verb
  });
});
```

The last case is the load-bearing one: because the helper is **generated from** the registry, the test proves the wire surface and the registry are the same set — closing the "someone hand-added a verb to the helper" hole. The **multi-provider forward constraint** (`Q-MP-SEAM`) reuses this: a future adapter's declared model-tool set is run through the same subset check (§3.1), so B-23 becomes adapter conformance, not Claude-specific.

### 5.3 The `types.ts` ↔ DATAMODEL drift script

`types.ts` (prototype) historically claimed 1:1 parity with the data model it no longer has ([04b §15] backfill checklist). A script asserts the persisted shapes and the prototype types stay aligned:

- Every model in [04b §6–§13] has a corresponding `types.ts` mirror (or is on the explicit doc-only allow-list).
- The canonical `AgentSession.status` 4-set (`ready|busy|paused|stopped`, [04b §7]) matches the `types.ts` mirror — and is **distinct** from `TicketStatus` (the 6-value AI-owned lifecycle) and `StageStatusCfg` (the three state machines stay separate, `Q-DATA-STATUS`).
- `StageKind` ([04b §12]) is the typed union, not the dead 7-literal `StageId`; `WorkspaceSuggestion.type` is the 5-value set ([04b §8]); `WorkspaceBudget` is multi-row ([04b §9]).

Run it in the same `vitest` suite (it's a pure structural assertion over two type sources). A drift failure means a schema change landed without the `types.ts` backfill — a documentation-truth regression caught at test time, not review time.

---

## 6. The P0 CLI spike as a scheduled gate (`Q-ENG-SPIKE`)

The spike is **not** a `vitest` file — it launches a real interactive `claude` PTY and must run outside the ~1s sandbox. It is a **gating CI/manual job** that produces a committed `SPIKE_RESULTS.md` (the deliverable per the doc plan). It **blocks P1 lanes B (SessionManager) / C (structured channel) / F (containers)** until green ([05 §P1]).

### 6.1 The assumption→test→verdict table

Each row is an unverified CLI behavior the architecture depends on; the spike turns each into a pass/fail against the **pinned** CLI version (`Q-CT-CLIPIN`, stamped onto results):

| Assumption | Test | Why it gates | If it fails |
|---|---|---|---|
| Interactive PTY bills the **Max subscription** ([01 §1]) | run a turn with clean env (no `ANTHROPIC_API_KEY`), confirm via host usage it drew the subscription | the entire billing premise | **escalate — do NOT route to headless** (anti-rec; headless meters the Agent-SDK pool) |
| `type:http` hooks fire in **interactive** mode ([02 §3]) | register a hook, run a turn, confirm the POST lands | the event backbone (turn-end, events, needs-input) | re-architect ingest; block C |
| Per-turn **usage** is in the hook payload (`Q-ENG-TOKENFEED`) | inspect the Stop/usage payload for token counts | precise vs char-count-estimate budget | fall back to labeled char-count estimate (advisory) |
| `/clear` vs `/compact` **session-id** preservation (`Q-ENG-CLEAR`) | run `/clear`, check if `claudeSessionId` survives for `--resume` | the token-opt self-handoff (06) | default to `/compact`, or capture+update the new id |
| `--resume` after crash ([01 §4]) | kill mid-turn, `--resume <id>`, confirm context retained | `resumeAll()` crash-recovery | re-spawn-from-carryover fallback |
| **Stop hook = turn-end** (`Q-ENG-TURNEND`) | confirm Stop fires once per turn | the active-turn FIFO slot release | idle-timeout heuristic fallback |

### 6.2 How the spike feeds the unit layer

The spike is run-once-per-CLI-version; its captured hook/usage payloads become the **record-replay fixtures** (§3.2). So the spike both *gates* the build and *seeds* the deterministic engine tests — after it's green, the fast `vitest` layer replays its bytes without re-spawning the CLI. Re-run the spike on every pinned-CLI bump (gated behind a base-image semver change + a hook/`--resume` smoke test, `Q-CT-CLIPIN`); a changed payload shape re-records the fixtures and may flip a replay test red (the intended drift signal).

---

## 7. How this layers on the framework's auto-sweep + per-route tests

The three tiers compose; none duplicates another:

| Concern | Tier 1/2 (framework integration) | Tier 3 (this doc) |
|---|---|---|
| **`[control-API]` route admits / rejects, rate-limits, doesn't crash** | auto-sweep (contract/auth/rate-limit/fuzz) — free, every route | — |
| **The Conductor action a `[control-API]` route ENQUEUES is correct** | a per-route `.tests.ts` asserts the route *enqueues* the right action | the Conductor matrix (§2) asserts the enqueued action produces the right transition/writes |
| **Engine turn logic** | — (no route) | fake/replay EngineDriver (§3) |
| **Event-log ordering** | a per-route `.tests.ts` may assert the snapshot endpoint shape | the merge race (§4) — the ordering property |
| **No write verb / B-23** | — | VERB_REGISTRY conformance (§5) |
| **Subscription billing / hook delivery** | — | P0 spike gate (§6) |

**The hand-off point.** A user write enters as a `[control-API]` `_api` route (`Q-ENG-CONTROL-API`): the framework auto-sweep proves the route is contract-clean and RBAC-gated (`preApiExecute`); a per-route `.tests.ts` proves it *enqueues* a Conductor action (never writes directly — the route is not a writer, [01 §3.3]); then the §2 Conductor unit suite proves that enqueued action drives the correct deterministic transition. Three tiers, one continuous chain from HTTP edge to durable write, each tier testing exactly the seam the next one trusts.

**Verification gate (per the build-plan PoC and milestones, [05]):** the orchestrator package passes `npx vitest run` (Tier 3, 0 failures) alongside the framework's `npm run lint`/`npm run build` and the integration `npm run test` (Tier 1/2). The P0 spike's `SPIKE_RESULTS.md` is committed and green before P1 lanes B/C/F integrate. The event-log race test (§4) is the first slice merged; the VERB_REGISTRY conformance (§5) lands with P1 lane C (the structured channel) per `Q-ENG-VERB-CONFORMANCE`.

---

## 8. Build-order checklist (for the test lane)

1. **§4 event-log merge race** — FIRST vertical slice (`Q-INF-TESTING`), no server, pins ordering before anything derives from the log.
2. **§5 VERB_REGISTRY + conformance test** — lands with P1 lane C; the helper is generated from it (B-23 structural guarantee).
3. **§3 FakeEngineDriver** — unblocks the Conductor matrix without a live CLI; doubles as the multi-provider conformance harness (`Q-MP-SEAM`).
4. **§2 Conductor matrix** — every [02 §1] edge + the §2.3 enforcement loop + the §2.4 signal loop + the §2.5 RBAC boundary.
5. **§6 P0 spike** — scheduled gate, run before P1 B/C/F integrate; seeds the §3.2 replay fixtures.
6. **§5.3 drift script** — runs in the same `vitest` suite; guards the [04b §15] backfill from re-drifting.

**Self-check.** No new verbs. No write verb granted to any test fixture or driver. The `VERB_REGISTRY` pinned here is the existing frozen [02 §2] surface, rendered executable. Every "write" in a Conductor test is asserted to come from the Conductor reducer (B-23), never from an LLM-driven path. The fake/replay driver burns zero subscription turns; the only real-CLI contact is the gated P0 spike. This doc edits no existing file.
