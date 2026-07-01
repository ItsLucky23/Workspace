export const meta = {
  name: 'workspaces-build-plans',
  description: 'Author grounded build plans for the shared tool-framework + 4 core Workspaces tools',
  phases: [{ title: 'Author' }],
}

const OUT = 'workspaces-brainstorm-14-06/build-plans'
const DOCS = 'workspaces-handoff/src/workspaces/_docs'

const LOCKED = `LOCKED DECISIONS (from the user's three answer rounds — treat as given, build to these):
GENERAL TOOL MODEL:
- Tools (Designer, Marketing, Document, Interviewer) are NOT pipeline steps. They are standalone PAGES, extra items in the SAME sidebar as board/backlog/pipeline/terminals, toggled on/off per workspace in settings. Human takes the first step; tools are never auto-triggered from inside a ticket (one opt-in exception: a ticket MAY ask the Interviewer, per-workspace, default OFF).
- One SHARED tool-page framework: free folder tree + skills + a generate action + an artifact store. Build it once; each tool fills in only its "what do I generate" logic.
- Enable/disable is per-workspace only (V1). One SKILL model with a 'surface' field (design/marketing/document); skills live centrally in the existing skills tab, filtered by type.
- Pipeline is the CORE runtime (always on, shown as core: true), tools are optional FeatureModules.
COUPLING (tool output -> tickets):
- Output is saved as artifacts in folders. On the board you reference "design 5 in folder X"; at TICKET CREATION the AI finds the artifact (manual picker + semantic search) and links it. Link = LIVE REFERENCE (ticket shows current version). The Stage-Agent that builds the ticket gets the linked artifact as REFERENCE/context.
INTERVIEWER (build #1): own tool-page; output = questions + idea-cards (mixed list, type-labelled per card); reads full pipeline-context (code+tickets+docs+graph); scope picker = fixed options + free field; "make ticket" opens the ticket-create form PREFILLED; full session history per folder; subtle non-blocking "this starts an AI session" notice; ALWAYS stepper (one question per screen, phone-first); on-demand only.
DESIGNER: saved design = PREVIEW + CODE; never writes the repo directly (artifacts only); 1 design per selected skill; free placement; compare on the page + final pick at the ticket; FULL BREADTH at once (pages + components + design-system); preview via headless-browser SCREENSHOT (user idea: keep an always-on preview server on 'main' so there's always a live preview; Playwright MCP / Vercel agent-browser capture from it); generate AGAINST the real components+tokens (codebase-aware); refine-loop per variant; save result + ingredients (skills, prompt, codebase version); streaming results (one by one); design-system output = DIFF on existing tokens.
MARKETING (V1 = SETUP ONLY, no generation): build page + folders + skill-config + the request-form skeleton (type, subject/feature, skill, context-selection) with a disabled/"V2" generate action; marketing skill = tone + format/dimensions + style direction (a skill with surface:marketing); REUSE the pipeline-editor context selector; frame-capture reuses the pipeline TERMINAL config (point at an already-configured server terminal) for Playwright; reserve ONE generic "media-API" integration key slot.
DOCUMENT (first batch): same tool-page model, uploads live in the folder; AI writes content/structure -> a DETERMINISTIC converter (LibreOffice/pandoc, plus ffmpeg available) in a container renders the real file; all four formats (PDF/Word/Excel/PowerPoint) + round-trip (upload .docx -> edit -> export same format) from V1; document skill = template + tone (+ optional reference doc); upload handling = user picks knowledge(RAG) vs attachment per upload; grounding + optional citations; untrusted uploads parsed in the sandbox container (no network, size caps); writing-LEVEL + tone controls (e.g. first-year-student vs professional) + clean natural output (no AI boilerplate/placeholder tells).
DOCUMENT — HARD BOUNDARY (must respect): DO NOT design, include, or recommend any feature whose PURPOSE is to evade AI-detection for academic work submitted as the user's own (no "make undetectable" toggle, no detector-targeted tuning, no detector feedback loop, no such marketing). The legitimate level/tone/clean-output controls are in scope; an anti-AI-detection mode is explicitly OUT. State this boundary briefly in the plan.`

const PLAN_SCHEMA = {
  type: 'object', required: ['file', 'oneLineSummary', 'v1Cut', 'openRisks'],
  properties: {
    file: { type: 'string' },
    oneLineSummary: { type: 'string' },
    v1Cut: { type: 'string', description: 'what ships in V1 vs deferred, one short paragraph' },
    openRisks: { type: 'array', items: { type: 'string' } },
  },
}

const PLANS = [
  { key: '00-framework', label: 'Shared tool-page framework',
    read: `${DOCS}/03_AUTOMATION_AND_PLUGINS.md (AgentRole/registry/ArtifactViewer), ${DOCS}/04b_DATA_MODEL_ADDENDA.md, ${DOCS}/CONTROL_API.md, ${DOCS}/features/15_SOURCES_MANAGEMENT.md (skills), ${DOCS}/features/12_BOARD_AND_KANBAN.md + ${DOCS}/features/16_MEMBERS_AND_RBAC.md (shell/nav/RBAC). Also read workspaces-brainstorm-14-06/modules/modules-system.md (the earlier analysis: ModuleManifest, WorkspaceModule, ModuleArtifact).`,
    brief: 'The reusable framework every tool plugs into: ModuleManifest + registerModule, per-workspace WorkspaceModule on/off, the free folder tree, the shared Skill model (surface field) in the existing skills tab, the ModuleArtifact store, and the artifact->ticket link (picker + semantic search, live reference). This is the foundation the other 4 plans depend on.' },
  { key: '01-interviewer', label: 'Interviewer (build #1)',
    read: `${DOCS}/02_PROTOCOL_AND_FLOW.md (QuestionSet §5, suggestions §6), ${DOCS}/features/09_QUESTIONS_IN_TICKETS.md, ${DOCS}/features/11_WORKSPACE_AI_PANEL.md, ${DOCS}/additions/01_intake_copilot.md, ${DOCS}/additions/05_answer_queue.md, ${DOCS}/03_AUTOMATION_AND_PLUGINS.md (§1.5 invoke-workspace-ai), ${DOCS}/07_ORCHESTRATOR.md (§D RAG), ${DOCS}/AI_QUALITY_AND_EVALS.md. Also workspaces-brainstorm-14-06/modules/interviewer-module.md.`,
    brief: 'The FIRST tool to build. A one-shot reasoner reads the project, produces a batch of questions + idea-cards, persisted (no standing LLM, no new verbs) and answered async via a phone-first stepper. Make this the most detailed, most build-ready plan: concrete data model, the session lifecycle, the stepper UX, make-ticket-prefilled flow, history, dedup via answer-history context.' },
  { key: '02-designer', label: 'Designer Studio',
    read: `${DOCS}/03_AUTOMATION_AND_PLUGINS.md (§3 + §7 design-stage walkthrough), ${DOCS}/design-reference/CLAUDE_DESIGN_FEATURE_COMPLETION.md, ${DOCS}/design-reference/DESIGN_TOKENS.md, ${DOCS}/features/23_PREVIEW_DEPLOYMENT.md, ${DOCS}/07b_CONTAINER_RUNTIME.md (§8 capacity), ${DOCS}/features/15_SOURCES_MANAGEMENT.md. Also workspaces-brainstorm-14-06/modules/designer-studio.md.`,
    brief: 'Preview+code design generation against the real codebase tokens/components, full breadth (pages+components+design-system), screenshot previews from an always-on main preview server, streaming N variants, refine-loop, design-system output as a token-diff, saved as artifacts (never touches repo) that get linked to tickets. Note the capacity tension (N variants = N sessions) and propose an internal phasing even though full breadth is the target.' },
  { key: '03-marketing', label: 'Marketing (V1 = setup only)',
    read: `${DOCS}/features/14_TERMINALS.md, ${DOCS}/features/23_PREVIEW_DEPLOYMENT.md, ${DOCS}/features/15_SOURCES_MANAGEMENT.md, ${DOCS}/07b_CONTAINER_RUNTIME.md. Also workspaces-brainstorm-14-06/modules/marketing-module.md.`,
    brief: 'V1 builds ONLY the setup/skeleton: page, folders, marketing-skill config (tone+format+style, surface:marketing), the asset-request form skeleton with a disabled generate action, reuse of the pipeline-editor context selector, the Playwright-capture pointing at a pipeline terminal server, and one generic media-API integration slot. Clearly mark what is V2 (actual generation). Keep it lean.' },
  { key: '04-document', label: 'Document Studio',
    read: `${DOCS}/07b_CONTAINER_RUNTIME.md (sandbox + tooling), ${DOCS}/features/15_SOURCES_MANAGEMENT.md (uploads/skills), ${DOCS}/07_ORCHESTRATOR.md (§D RAG). Also workspaces-brainstorm-14-06/modules/document-studio.md.`,
    brief: 'Upload + generate real PDF/Word/Excel/PowerPoint via a deterministic converter (LibreOffice/pandoc/ffmpeg) in a sandbox container; round-trip from V1; document skills (template+tone+optional reference); per-upload knowledge-vs-attachment; grounding + optional citations; writing level + tone controls + clean natural output. RESPECT THE HARD BOUNDARY: no AI-detection-evasion feature for submitted academic work — state the boundary in the plan and design only the legitimate quality/level/tone controls.' },
]

const planPrompt = (p) => `You are a senior software architect writing an ACTIONABLE build plan for "Workspaces" — a self-hosted AI dev-orchestration product built on the LuckyStack framework. The plan will be handed to a builder-AI to implement. Working dir is the repo root.

${LOCKED}

YOUR PLAN: ${p.label}
SCOPE OF THIS PLAN: ${p.brief}
READ THESE DOCS FIRST (ground every claim in them, cite filenames): ${p.read}

Write a build plan to '${OUT}/${p.key}.md' with these sections:
## Doel & V1-scope — what this delivers, what is explicitly deferred.
## Past op de bestaande corpus — how it reuses/extends existing pieces, with doc citations (don't reinvent what exists; respect the locked "no new verbs", "Conductor is the only writer / B-23 propose-only", single-instance orchestrator, subscription-PTY engine constraints).
## Datamodel — concrete new entities/fields (Prisma-ish), tied to the prototype types.ts where relevant.
## UX & flows — the screens, the key user flows step by step, phone where relevant.
## Bouwstappen (geordend) — a sequenced, checkable build sequence (phases/milestones a builder can follow).
## Risico's & open punten — real risks, capacity/security concerns, and anything still genuinely open.

Be concrete and grounded — cite real doc sections, reuse real component/registry names. Respect every locked decision above. Dutch prose is fine; keep code/paths/identifiers verbatim. Do not pad.

Then return the structured summary.`

const results = []
const CHUNK = 3
for (let i = 0; i < PLANS.length; i += CHUNK) {
  const batch = PLANS.slice(i, i + CHUNK)
  const part = await parallel(batch.map(p => () =>
    agent(planPrompt(p), { label: `plan:${p.key}`, phase: 'Author', schema: PLAN_SCHEMA, model: 'sonnet' })
  ))
  results.push(...part.filter(Boolean))
  log(`Wave ${Math.floor(i / CHUNK) + 1}/${Math.ceil(PLANS.length / CHUNK)} — ${results.length}/${PLANS.length} plans`)
}

return {
  plansWritten: results.length,
  files: results.map(r => r.file),
  summaries: results.map(r => ({ file: r.file, summary: r.oneLineSummary, v1: r.v1Cut, risks: r.openRisks })),
}
