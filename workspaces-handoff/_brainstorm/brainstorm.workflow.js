export const meta = {
  name: 'workspaces-modules-brainstorm',
  description: 'Read the Workspaces design corpus, form opinion + new ideas per proposed module, build an interactive interview HTML page',
  phases: [
    { title: 'Understand' },
    { title: 'Ideate' },
    { title: 'Assemble' },
  ],
}

const OUT = 'workspaces-brainstorm-14-06'
const DOCS = 'workspaces-handoff/src/workspaces/_docs'

// The user's verbatim vision (Dutch) — the source of truth for what they want to explore.
const VISION = `De gebruiker wil bovenop LuckyStack een nieuw product bouwen: een mix van Jira + volledig AI vibe-coding modes, maar stack-agnostisch (elke gewenste stack). Voorbeelden/eisen:
- Je kan zeggen "ik maak een docker image waar ik een C# project kan runnen met MySQL" en dan zelf-hosten en alles werkt gewoon. Zelfs het MAKEN van docker images zou met AI moeten kunnen, zodat je hele applicaties kan bouwen.
- Je kan meteen alle live tickets van andere apparaten inzien — de reverse proxy moet hier goed voor opgezet zijn.
- MODULES: de pipeline-flow wordt een module, en je kan modules toevoegen. Voorbeelden van modules die de gebruiker noemt:
  1. Een geavanceerde "Designer Studio" om heel makkelijk met AI UIs te ontwerpen: je krijgt een template/bibliotheek aan "design skills" en kan zelf toevoegen; je kan zeggen "maak pagina X met iedere design skill" om ze te vergelijken en te kiezen wat bij je project past.
  2. Een "Interviewer module": je zegt tegen de AI "ga over mijn project en kom met toevoegingen/ideeën" en je krijgt een fijne UI waar je alle vragen/ideeën van de AI ziet uitgewerkt, vaak als a/b/c/d of meerkeuzevragen (zoals in de Claude CLI maar dan direct in de browser). Elke vraag/idee heeft een title, een summary, en een detailed summary — de detailed summary is begrijpelijk zelfs voor iemand die alleen een globale samenvatting van het project weet en niks van code.
  3. Een "Marketing module": videos/thumbnails/posters maken, volledig met AI, met codebase-context; misschien zelf frames maken met een MCP zoals Playwright en dan zelf editen met verschillende edit-styles/skills (zoals bij de designer tool).
- Betere AI-management in het project: je kan per module kiezen welke provider/API-key je gebruikt (bv. voor de design-tool API-key van X, en bij de pipeline- en video-modules Claude CLI instances).
De gebruiker wil mijn mening + extra ideeën die ik zelf bedenk, en alle vragen netjes uitgewerkt zodat hij ze later kan beantwoorden.`

// ---- Phase 1: understand the existing corpus (Sonnet readers) --------------
phase('Understand')

const UNDERSTAND_SCHEMA = {
  type: 'object',
  required: ['key', 'existingCapabilities', 'lockedDecisions', 'gapsForNewModules'],
  properties: {
    key: { type: 'string' },
    existingCapabilities: {
      type: 'array', description: 'what the corpus ALREADY designs that is relevant to the new modules',
      items: { type: 'object', required: ['what', 'where'], properties: {
        what: { type: 'string' }, where: { type: 'string', description: 'doc file(s)' } } },
    },
    lockedDecisions: {
      type: 'array', description: 'decisions already settled that a new idea must NOT re-litigate (cite the code/doc)',
      items: { type: 'string' },
    },
    gapsForNewModules: {
      type: 'array', description: 'where the new modules (designer studio, interviewer, marketing, modules-system, AI-management, AI-built docker) are NOT yet covered or only partially',
      items: { type: 'string' },
    },
    notes: { type: 'string' },
  },
}

const READERS = [
  { key: 'container-stack-proxy', label: 'containers / stack-agnostic / reverse-proxy / deploy',
    files: `${DOCS}/01_ARCHITECTURE.md, ${DOCS}/07_ORCHESTRATOR.md, ${DOCS}/07b_CONTAINER_RUNTIME.md, ${DOCS}/08_DEPLOYMENT.md, ${DOCS}/SELF_HOST_INSTALLER.md, ${DOCS}/PORT_MANIFEST.md`,
    focus: 'How are containers, stack-agnostic runtimes (any language/DB), the Caddy reverse-proxy + per-ticket routing, self-hosting, and image building handled today? Could AI itself author docker images / whole-app stacks here?' },
  { key: 'forge-ci-git', label: 'forge / CI / MR / git mechanics',
    files: `${DOCS}/FORGE_ABSTRACTION.md, ${DOCS}/BUILTIN_CI_PIPELINES.md, ${DOCS}/BUILTIN_MR_REVIEW.md, ${DOCS}/GIT_STRATEGY.md`,
    focus: 'How is the "pipeline" + CI + MR + git modelled? Is there already a notion of pluggable runners/providers that a "modules" system would generalise?' },
  { key: 'roles-plugins-design', label: 'AgentRole plugin model + the future Design feature',
    files: `${DOCS}/03_AUTOMATION_AND_PLUGINS.md, ${DOCS}/design-reference/CLAUDE_DESIGN_FEATURE_COMPLETION.md, ${DOCS}/design-reference/SCREEN_INVENTORY.md, ${DOCS}/design-reference/DESIGN_TOKENS.md, ${DOCS}/AI_QUALITY_AND_EVALS.md, ${DOCS}/features/02_PIPELINE_PRESETS.md, ${DOCS}/features/10_AUTOMATIONS_SCREEN.md`,
    focus: 'The AgentRole/plugin model + the "add a Design stage" walkthrough + the already-designed Design feature. This is the backbone the Designer Studio + Marketing module would plug into. What exists, what is the extension contract?' },
  { key: 'protocol-questions-ui', label: 'protocol / QuestionSet / intake co-pilot / AI panel',
    files: `${DOCS}/02_PROTOCOL_AND_FLOW.md, ${DOCS}/02b_PROTOCOL_ADDENDA.md, ${DOCS}/additions/01_intake_copilot.md, ${DOCS}/additions/05_answer_queue.md, ${DOCS}/features/09_QUESTIONS_IN_TICKETS.md, ${DOCS}/features/11_WORKSPACE_AI_PANEL.md, ${DOCS}/features/21_SEARCH_AND_COMMAND_PALETTE.md`,
    focus: 'The QuestionSet / multiple-choice / answer-queue / intake co-pilot machinery — the EXACT primitives the "Interviewer module" would build on. How are AI questions modelled + answered today (incl. mobile)?' },
  { key: 'providers-ai-mgmt', label: 'multi-provider seam / billing / budget / token-opt',
    files: `${DOCS}/MULTI_PROVIDER_SEAM.md, ${DOCS}/P0_CLI_SPIKE.md, ${DOCS}/GOLDEN_PLAN_STAGE.md, ${DOCS}/features/19_USAGE_AND_BUDGET.md, ${DOCS}/06_TOKEN_OPTIMIZATION.md, ${DOCS}/additions/13_quota_probe.md, ${DOCS}/additions/14_predictive_budget.md`,
    focus: 'How is the AI provider/engine abstracted (interactive-PTY-subscription vs metered API keys), how is billing/budget/quota tracked, and what would per-module provider/key selection require? This grounds the "AI management" module.' },
  { key: 'scope-decisions-locked', label: 'scope + locked decisions + new-ideas round',
    files: `${DOCS}/BUILD_HANDOFF.md, ${DOCS}/V1_SCOPE.md, ${DOCS}/BUILD_ORDER.md, ${DOCS}/additions/00_INDEX.md, ${DOCS}/additions/00_DECISIONS_LEDGER.md, ${DOCS}/00_SPEC_RECONCILIATION.md`,
    focus: 'What is V1 scope vs deferred/HORIZON, and which decisions are LOCKED (subscription-only PTY engine, Conductor-as-sole-writer, GitLab-first, etc.)? A new module idea must respect these or consciously flag the deviation. Also: is there already an "interviewer/sparring" process here that the Interviewer MODULE would productise?' },
]

const readerPrompt = (r) => `You are a senior architect reading the existing design corpus for "Workspaces" — a self-hosted, AI-driven dev-orchestration product (a Jira/AI-vibe-coding hybrid) built on the LuckyStack framework. Working dir is the repo root.

The user now wants to extend it with NEW modules. Their vision:
${VISION}

YOUR SLICE: ${r.label}
READ these docs in full: ${r.files}
FOCUS: ${r.focus}

Your job is NOT to design the new modules — it is to map what ALREADY exists so the ideation agents don't reinvent or contradict it. Return:
- existingCapabilities: concrete things already designed that the new modules can build on (with doc citations).
- lockedDecisions: settled decisions a new idea must respect (or consciously flag if it deviates).
- gapsForNewModules: where the new modules are genuinely net-new / uncovered.
Be concrete and cite doc filenames. Precision over volume.`

const understandResults = []
const RCHUNK = 3
for (let i = 0; i < READERS.length; i += RCHUNK) {
  const batch = READERS.slice(i, i + RCHUNK)
  const part = await parallel(batch.map(r => () =>
    agent(readerPrompt(r), { label: `read:${r.key}`, phase: 'Understand', schema: UNDERSTAND_SCHEMA, model: 'sonnet' })
  ))
  understandResults.push(...part.filter(Boolean))
  log(`Understand wave ${Math.floor(i / RCHUNK) + 1}/${Math.ceil(READERS.length / RCHUNK)} — ${understandResults.length} slices digested`)
}

// Build a compact digest for the ideation agents.
const digest = understandResults.map(u => {
  const caps = (u.existingCapabilities || []).map(c => `    - ${c.what} (${c.where})`).join('\n')
  const locked = (u.lockedDecisions || []).map(d => `    - ${d}`).join('\n')
  const gaps = (u.gapsForNewModules || []).map(g => `    - ${g}`).join('\n')
  return `### ${u.key}\n  EXISTING:\n${caps || '    (none)'}\n  LOCKED:\n${locked || '    (none)'}\n  GAPS:\n${gaps || '    (none)'}`
}).join('\n\n')

// ---- Phase 2: ideate per proposed module (Sonnet) --------------------------
phase('Ideate')

const QUESTION_ITEM = {
  type: 'object', required: ['id', 'title', 'summary', 'detailedSummary', 'type'],
  properties: {
    id: { type: 'string', description: 'stable id e.g. designer-3' },
    title: { type: 'string', description: 'short question/idea title' },
    summary: { type: 'string', description: 'one-line summary of the question/decision' },
    detailedSummary: { type: 'string', description: 'a few sentences a NON-CODER who only knows the project at a high level can fully understand — explain the tradeoff in plain language, no jargon' },
    type: { type: 'string', enum: ['choice', 'open'] },
    options: {
      type: 'array', description: 'for type=choice: 2-5 labelled options (a/b/c/d). Each is a real, distinct path.',
      items: { type: 'object', required: ['label', 'detail'], properties: {
        label: { type: 'string' }, detail: { type: 'string', description: 'what choosing this means + its tradeoff' },
        recommended: { type: 'boolean', description: 'true if this is my recommended default' } } },
    },
  },
}

const IDEATE_SCHEMA = {
  type: 'object',
  required: ['moduleKey', 'title', 'myOpinion', 'fitWithExisting', 'questions'],
  properties: {
    moduleKey: { type: 'string' },
    title: { type: 'string' },
    myOpinion: { type: 'string', description: 'my candid take: is this a good idea, how strong, what would make it shine, what to be careful of' },
    fitWithExisting: { type: 'string', description: 'how it plugs into / extends / tensions-with the existing corpus (cite docs)' },
    risksAndTensions: { type: 'array', items: { type: 'string' } },
    additionalIdeas: {
      type: 'array', description: 'extra ideas I came up with for THIS module that the user did not mention',
      items: { type: 'object', required: ['idea', 'why'], properties: { idea: { type: 'string' }, why: { type: 'string' } } },
    },
    questions: { type: 'array', description: '5-12 well-formed questions/decisions for the user to answer', items: QUESTION_ITEM },
  },
}

const MODULES = [
  { key: 'modules-system', title: 'Modules-systeem (pipeline-flow als module + uitbreidbaar)',
    ask: 'The user wants the pipeline-flow to become one MODULE among many, with a system to add modules (designer studio, interviewer, marketing, …). Design opinion + open questions on the MODULE SYSTEM itself: what is a "module" (vs the existing AgentRole/plugin + stage model)? install/registry/manifest, per-workspace enable, permissions/sandboxing, how modules surface UI + their own routes, how they reuse the Conductor/structured-channel, marketplace vs built-in. Reconcile with the existing AgentRole plugin model + pipeline presets — is "module" a superset, or a new layer?' },
  { key: 'designer-studio', title: 'Designer Studio (AI UI-ontwerp + design-skills bibliotheek + vergelijken)',
    ask: 'A studio to design UIs with AI: a library of swappable "design skills" (style systems), user can add their own, and can render "page X in every design skill" to compare side-by-side and pick. Opinion + questions: what is a "design skill" concretely (prompt + tokens + component conventions + reference images?), how does compare-N-variants work (cost, parallel Stage-Agents, preview deploys per variant?), how does it tie into the existing Design feature / design-reference tokens, how do chosen designs flow back into the real codebase, live-edit loop, mobile.' },
  { key: 'interviewer-module', title: 'Interviewer-module (AI bevraagt je project → a/b/c/d in de browser)',
    ask: 'A module where the AI reviews your project and surfaces additions/ideas as a nice browser UI of questions — often multiple-choice (a/b/c/d) like the Claude CLI but in-browser — each with title + summary + detailed-summary (the detailed summary understandable by a non-coder who only knows the project globally). Opinion + questions: how does it differ from / reuse the existing intake-copilot + QuestionSet + answer-queue? trigger cadence (on-demand vs scheduled background reasoner), how ideas become tickets, dedup vs already-asked, the title/summary/detailed-summary contract, async answering from phone, how answers feed back to the AI. NOTE: this very task (me building an interview HTML) is a manual instance of exactly this module — use that as a design reference.' },
  { key: 'marketing-module', title: 'Marketing-module (video/thumbnails/posters met codebase-context)',
    ask: 'A module to produce videos / thumbnails / posters fully with AI, WITH codebase context; possibly capture real frames via a Playwright-style MCP and then edit with swappable edit-styles/skills (like the designer tool). Opinion + questions: realistic scope (static posters easy; full video hard) — what is V1 vs horizon? which generation backends (image/video models = metered API, not the Claude subscription — implications for AI-management), the Playwright-frame-capture pipeline, asset storage, brand-kit reuse from Designer Studio, where rendered assets live + approval flow, the edit-skill model shared with Designer.' },
  { key: 'ai-management', title: 'AI-management (per-module provider/API-key keuze)',
    ask: 'Per-module choice of AI provider/key: e.g. Designer Studio uses provider X API key, pipeline + video modules use Claude CLI (interactive subscription) instances. Opinion + questions: this directly touches the LOCKED "everything on the Max subscription / interactive-PTY-only" decision and the PARKED multi-provider seam — flag that tension explicitly. How to model a provider registry + per-module/per-stage binding, secret storage (LuckyStack secret-manager?), billing/budget split per provider, the subscription-PTY vs metered-API duality, fallback/quota routing, who is allowed to set keys (RBAC).' },
  { key: 'stack-agnostic-docker', title: 'Stack-agnostic Docker + AI-bouwt-images + cross-device live tickets',
    ask: 'The user wants: declare "a docker image running a C# project + MySQL", self-host, and it just works; AI itself authoring docker images / whole-app stacks; and seeing live tickets from any device via a well-set-up reverse proxy. Opinion + questions: how far beyond the existing stack-agnostic container runtime + Caddy proxy does this go? AI-generated Dockerfiles/compose (validation, security, build sandbox, registry), arbitrary runtime stacks (C#/.NET, Go, etc.) vs the Claude-CLI-in-container assumption, the "it just works" self-host bootstrap, multi-device live-ticket access + the reverse-proxy/auth/exposure model (LAN vs internet, TLS, tunnels).' },
  { key: 'proposed-new-modules', title: 'EXTRA modules die ik (de AI) voorstel',
    ask: 'Propose 4-7 NET-NEW modules the user did NOT mention but that fit this product and the existing architecture, each genuinely earning a module slot (reusable, cross-cutting). Examples of the BAR (do not just copy these — reason from the corpus + the gaps): a QA/test-author module, a docs/changelog/release-notes module, an observability/cost-insight module, a data/seed/migration module, an integrations/webhook module, an onboarding/codebase-explainer module, a security-review module. For each: opinion + the same structured questions so the user can decide whether they want it.' },
  { key: 'overall-strategy', title: 'Overall: mijn mening, samenhang & volgorde',
    ask: 'Step back and give the BIG-PICTURE opinion: do these modules cohere into one product or sprawl? What is the strongest core, what is the biggest risk, what should be built FIRST vs deferred, what tensions exist (esp. subscription-billing vs metered creative models, scope explosion vs the locked lean V1). Provide a recommended sequencing. Questions here are higher-level strategic decisions (a/b/c/d) about direction, scope, and priorities.' },
]

const ideatePrompt = (m) => `You are a sharp, opinionated product-architect helping the user shape NEW modules for "Workspaces" (self-hosted AI dev-orchestration on LuckyStack). Working dir is the repo root; you may open any doc under ${DOCS}/ for detail.

THE USER'S OVERALL VISION:
${VISION}

A digest of what the EXISTING corpus already covers (built by reader agents — respect locked decisions, build on existing capabilities, don't reinvent):
${digest}

YOUR MODULE / TOPIC: ${m.title}
SPECIFIC BRIEF: ${m.ask}

Deliver:
1. myOpinion — candid, specific. Where it's strong, where it's weak, what would make it excellent. Don't be a yes-man; if something is over-scoped or fights a locked decision, say so.
2. fitWithExisting — how it plugs into the existing design (cite docs), and any tension with locked decisions.
3. risksAndTensions.
4. additionalIdeas — concrete extra ideas I bring that the user didn't mention.
5. questions — 5-12 well-formed decisions for the user. Mostly type "choice" with 2-5 real labelled options (mark one recommended where you have a view); a few "open" where genuinely open. EVERY question needs: title, one-line summary, and a detailedSummary written so a NON-CODER who only knows the project globally fully understands the tradeoff (plain language, no jargon). Questions must be things only the USER can decide (direction, priority, scope, taste) — not things you could just look up.

ALSO write a readable markdown version of your full analysis to '${OUT}/modules/${m.key}.md' (sections: ## Mijn mening, ## Past op bestaande design, ## Risico's, ## Extra ideeën, ## Vragen — with each question's title/summary/detailed-summary/options). Dutch prose is fine; keep code/paths/identifiers verbatim.

Then return the structured object.`

const ideated = []
const ICHUNK = 3
for (let i = 0; i < MODULES.length; i += ICHUNK) {
  const batch = MODULES.slice(i, i + ICHUNK)
  const part = await parallel(batch.map(m => () =>
    agent(ideatePrompt(m), { label: `ideate:${m.key}`, phase: 'Ideate', schema: IDEATE_SCHEMA, model: 'sonnet' })
  ))
  ideated.push(...part.filter(Boolean))
  log(`Ideate wave ${Math.floor(i / ICHUNK) + 1}/${Math.ceil(MODULES.length / ICHUNK)} — ${ideated.length} modules done`)
}

// ---- Phase 3: return everything to the orchestrator (HTML built by main loop) ----
phase('Assemble')
log('Ideation complete — returning structured content for HTML assembly.')

return {
  modulesDone: ideated.length,
  totalModules: MODULES.length,
  understandSlices: understandResults.length,
  modules: ideated,
  markdownFiles: ideated.map(m => `${OUT}/modules/${m.moduleKey}.md`),
}
