# LOOP & GRAPH — design capture (NOT yet built)

> Status: **captured, not scheduled.** The owner raised these on 2026-08-18 as the two new ways of
> working they want the pipeline to support, explicitly *"nu nog niet maken maar wel alvast mee
> gegeven"*. This file exists so the shape is written down while the reasoning is fresh, and so the
> work that IS being done now (ADR 0315 presets, ADR 0311 prompt layers) does not accidentally design
> them out. Nothing here is decided; there is no ADR yet.

---

## 1. What was asked

**Loop.** Repeat a span of stages until a condition holds. The owner's example: *review → fix →
review → fix …* until the review comes back with nothing wrong.

**Graph.** Split one problem across several agents that work in parallel, then bring the results back
together.

Both are the same missing primitive seen from two angles: today a pipeline is a **strictly ordered
list**, and the only movement is one step forward.

---

## 2. What exists today (the honest baseline)

| Piece | Where | What it gives us |
|---|---|---|
| Ordered stages | `PipelineStage.order`, `Ticket.stageId` (a free-string stage KEY) | one column per stage, forward movement only |
| Carry-over envelope | `{summary, changedFiles, openQuestions, commitHash}` | how one stage hands work to the next |
| `visibleStageIds` | per stage | a stage can read EARLIER stages' output |
| `WorkspaceTrigger` | `on: stage.on_complete`, `action: start-stage` | already an event → action edge, with `requiresApproval`, `dedupeKey`, `debounceMs` |
| Findings | review stages produce them; `finding-to-ticket` exists | a machine-readable "what is still wrong" |
| Capacity + leader lease | `server/orchestrator/capacity.ts`, ADR 0015 | concurrency is already bounded and multi-instance safe |

Two things are worth noticing before designing anything:

- **A back-edge is nearly expressible already.** `WorkspaceTrigger(on: stage.on_complete, match:
  {stageIds:['review']}, action: start-stage, params:{targetStageId:'impl'})` is a loop — an
  unconditional, unbounded one. What is missing is a *condition* and a *bound*, not an edge.
- **There is no sub-ticket.** `Ticket` has no parent/child relation. Graph fan-out has nowhere to put
  the branches, which makes it a data-model change, not a UI change. This is the single biggest
  difference in cost between the two features.

---

## 3. Loop — the smaller of the two

### Sketch

A stage gains an optional **repeat rule**: *when this stage completes, if `<condition>`, go back to
`<stage>`; at most `<n>` times.*

- **Condition.** Must be evaluated from data the run already produces, not from an LLM's opinion of
  its own work. The obvious candidates, cheapest first: review findings count > 0 · the stage's
  `definitionOfDone` self-report · CI red · open questions present. The first one is real today.
- **Bound.** A hard `maxIterations`, plus the existing spend caps. An unbounded review↔fix loop on a
  paid model is the failure mode that matters; it must be impossible to configure, not merely
  discouraged.
- **State.** An iteration counter per ticket per loop. `Ticket` has no field for it; the cheapest
  honest home is a `TicketEvent` count or a small `loopState` JSON, decided when it is built.
- **Exit.** Condition false → forward as normal. Bound hit → the ticket parks with a
  `needs-input`-shaped reason naming the loop, never a silent forward.

### Why it is not free

- The board renders a ticket in one column. A ticket that has been through Review three times must
  read as *iteration 3*, not as a ticket that mysteriously went backwards — the current UI would
  simply show it moving left, which looks like a bug.
- Carry-over is written for a forward hand-off. Loop iteration N needs iteration N-1's findings *and*
  the original scope, or the fix agent re-derives the ticket every pass.
- Cost becomes non-deterministic per ticket. Budgets, the spend estimator and the "what will this
  cost" surfaces all currently assume one pass.

---

## 4. Graph — the larger one

### Sketch

A stage gains an optional **fan-out**: it produces N work items, each of which runs the same (or a
named) stage independently, and a **join** stage that receives all N carry-overs.

- **Fan-out source.** The plan stage already produces an ordered plan. The natural split is *per plan
  step* or *per file group* — decided by the planning agent, executed by the Conductor.
- **Isolation.** Parallel code agents in one repo conflict. Each branch needs its own worktree +
  container (the runtime already cuts worktrees per ticket) and its own branch, or the fan-out is a
  race with extra steps.
- **Join.** Merge N branches, then run one integration pass. This is the hard half: N green branches
  do not make a green merge, so the join stage must be able to fail and re-fan-out.
- **Data model.** Needs a parent/child ticket relation (or an explicit `TicketBranch` entity) — see
  §2. Everything scoped by `Ticket` today (events, carry-over, MR, CI, preview, spend) has to answer
  "which branch?".

### Why it is bigger than it looks

The pipeline, the board, the ticket page, carry-over, MR/CI and the spend accounting are all
one-ticket-one-lane. Graph is not a pipeline feature; it is a change to what a ticket *is*.

---

## 5. Constraints any design must respect

1. **B-23.** The Conductor stays the only writer of board/git/status. A loop back-edge and a fan-out
   are Conductor decisions, never something an agent writes for itself.
2. **No new verbs on the frozen structured channel.** Whatever this becomes, the assistant reaches it
   through existing verbs + `WorkspaceTrigger` + control-API ops.
3. **Leader-elected, multi-instance safe** (ADR 0015). Fan-out multiplies concurrent work; it must go
   through the existing capacity reservation, not around it.
4. **Every run costs money.** Loops and fan-outs multiply spend. Both need a bound that is enforced by
   the engine, and both need the cost to be visible *before* the user turns them on.
5. **PTY billing invariant.** Parallel branches are still interactive `claude` in a node-pty PTY —
   fan-out means N PTYs, which is a real resource question, not a config flag.

---

## 6. If/when this is picked up

A plausible order, cheapest real value first:

1. **Loop, conditioned on review findings only, bounded, single stage-pair.** Reuses the existing
   trigger edge; adds a condition, a bound and an iteration counter. Ships the owner's actual example.
2. **Loop UI.** Iteration badge on the board card + the loop's own row in the pipeline editor.
3. **Generalised loop conditions** (CI red, open questions, definition-of-done).
4. **Sub-tickets** as a data-model change on their own, useful independently of graph.
5. **Graph fan-out/join** on top of sub-tickets.

Steps 1–3 are pipeline work. Steps 4–5 are a product change and deserve their own ADR before any code.
