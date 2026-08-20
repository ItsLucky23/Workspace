# One AI for everything, or a new AI per pipeline stage?

> **Status: analysis only — nothing here is built.** Written 2026-08-20 at the owner's request, right
> after per-stage skill selection landed. It answers the question as asked and corrects one premise
> that turns out to be about a different mechanism than it sounds like.
>
> The owner's framing: *"meeste AIs hebben nu toch een 1M context window en anders kunnen we altijd
> compacten, en dat zorgt ervoor dat de handover layer eruit kan wat extra configuratie weg haalt."*

---

## 0. TL;DR

**Keep a session per stage.** Not because of context size — the owner is right that 1M windows and
compaction make "it won't fit" a weak argument — but because three things that are *not* context are
currently scoped by the session boundary:

| What | Where it lives today | What one shared session does to it |
|---|---|---|
| Tool/command permissions | `settings.json` written into the container **per stage**, read by the CLI **at session start** | The plan stage inherits the implement stage's write + Bash access. Security regression. |
| Model + effort per stage | `--model` on the spawn, `MAX_THINKING_TOKENS` in the same `settings.json` | A cheap review stage can no longer be cheap; the whole ticket runs at the most expensive stage's tier. |
| Skills per stage (`aiSkillIds`, new) | Rendered into `CLAUDE.md` per stage | The stage-level skill switch the owner just asked for stops meaning anything. |

And the premise correction: **removing the handover layer does not follow from using one AI, because
"handover" here is two different mechanisms and only one of them is about stages.**

---

## 1. The premise: there are two "handovers", not one

They are easy to conflate — both are "write down what you know so the next you can continue" — but
they solve unrelated problems and only one is a consequence of the stage split.

### 1a. `CarryOver` — the stage→stage envelope

`server/orchestrator/stageRunner.ts` reads the previous stage's envelope addressed to this stage and
renders it into the prompt. The envelope is the structured `{ summary, changedFiles, openQuestions,
commitHash }` shape the stage is told to emit.

This one **is** a consequence of the stage split. One shared session would not need it.

### 1b. `Handoff` — the within-session context reset

`server/orchestrator/handoff.ts`: when a session crosses its token budget, the Conductor asks the AI
to write a thorough handoff, stores it, sends `/clear`, and the next turn opens with that handoff as
its context. Same `claudeSessionId`, lean again.

This one is **not** about stages at all. It exists because a single long interactive session fills
its window. Merging every stage into one session makes it fire **more** often, not less — it is the
mechanism that *implements* "anders kunnen we altijd compacten". So the configuration the owner wants
to remove is the configuration that the one-AI model depends on most.

> Net effect on config surface: one-AI removes the carry-over template per stage (1 field), and makes
> the handoff instruction — currently a single global default with a TODO for per-stage override —
> more load-bearing. That is close to a wash, not a simplification.

---

## 2. Where the real cost sits

### 2.1 Permissions are the blocking objection

`renderStage.ts` derives `settings.json` `permissions: { allow, ask, deny }` from **that stage's**
command list. A refine or review stage can be given read-only Bash and no write tools; an implement
stage gets the write patterns it needs.

The CLI reads that file when the session starts. There is no supported way to narrow a running
session's permissions mid-conversation. So "one AI for everything" means one permission set for
everything, which in practice means the widest one — the implement stage's.

That is not a configuration-count trade. It converts a stage boundary that is currently a real
capability boundary into a comment.

### 2.2 Per-stage model choice becomes moot

`resolveModelChoice(cfg.modelCfg, carryOver?.complexityScore)` picks a model per stage, and the spawn
passes `--model`. A shared session can technically vary `--model` per turn, but the effort budget and
the settings-level model backstop are in the same per-session `settings.json`, and the value of
picking a cheap model for a cheap stage largely disappears once the whole ticket's transcript is in
every turn's input.

### 2.3 It undoes the change made today

The whole point of `PipelineStage.aiSkillIds` is that a plan stage and a review stage run with
different instructions. That distinction is expressed by *composing a different prompt per stage*. If
there is one session, there is one composed prompt, and the per-stage skill picker becomes a way of
adding skills to a shared pile.

### 2.4 Context isn't the argument, but it isn't free either

The owner is right that 1M windows change the arithmetic. Worth stating honestly, though:

- **Cost.** Input tokens are re-read every turn. A stage-scoped session re-reads only its own
  transcript; a ticket-wide session re-reads all previous stages' transcripts too, for the rest of
  the ticket. Under a subscription this shows up as rate limiting rather than a bill, but it shows up.
- **Quality.** A review stage that has watched itself write the code is a worse reviewer than one that
  is handed the diff and the intent. This is the argument the ADR-0018 MR-review path already leans on.
- **Recovery.** `--resume <id>` currently recovers *one stage*. Ticket-wide, a poisoned session is a
  poisoned ticket.

---

## 3. What the owner is actually right about

The complaint underneath the question is real: **there is too much per-stage configuration, and most
of it is empty on a fresh project.** That is worth fixing — but the fix is defaults and inheritance,
not merging the sessions. Concretely, and in rough order of payoff:

1. **Inherit, don't repeat.** Let a stage field fall back to a pipeline-level default and show the
   inherited value greyed in the input, rather than an empty box that silently means "nothing". The
   `UseDefault` affordance already does half of this for prompts — the missing half is that an unset
   field should *stay* linked to the default instead of being copied once.
2. **Carry-over template should almost never be per stage.** It is the same envelope shape every time.
   Make it a pipeline-level field with a per-stage override that is hidden until used.
3. **One handoff instruction, workspace-level.** The per-stage override in `handoff.ts` is a TODO;
   deleting the TODO is cheaper than building it.
4. **Group the stage tabs by "who ever touches this".** General/Context/Model are the everyone-tabs
   already; Commands/Network/Hooks are the ones that make the page feel enormous, and on most projects
   they are set once for the whole pipeline.

Every one of those removes configuration without removing a capability boundary.

---

## 4. The one shape worth considering later

If the goal is fewer cold starts rather than fewer settings, there is a middle option that keeps the
boundaries: **one container per ticket (already true) + one session per _permission class_ rather than
per stage.** Stages that share a permission set and a model — typically refine + plan, and often
review + fix — could share a session and skip one carry-over hop, while implement stays isolated.

That is a real saving with a real risk (a shared session between review and fix is exactly the
"reviewer watched itself write it" problem), so it belongs behind a per-pipeline setting, not as a
default. Not proposed for now; recorded so the option is not lost.

---

## 5. Recommendation

Keep a session per stage. Spend the effort on defaults, inheritance and tab grouping — that is what
makes the pipeline page feel smaller, and it costs no capability.

If the owner wants the one-AI model anyway, the honest minimum before it would be safe:

- a way to narrow permissions on a live session (does not exist in the CLI today), **or**
- accepting that every stage runs with implement-level permissions, stated explicitly in the UI.

That second option is a product decision the owner may legitimately make — but it should be made out
loud, not arrived at by merging sessions to remove a config field.
