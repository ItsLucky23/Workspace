//? @adr 0280
//? Workspaces — nav CATEGORY model (module-based IA). The three top-level categories mirror the
//? folder structure under src/workspaces/ (develop / content / insights) AND the URL space
//? (/workspaces/<category>/<view>), so nav, folders and URLs tell one story. Pure constants (no
//? React / no server deps): imported by the Shell (rail grouping) and the provider (URL mapping).
export type NavCategory = 'develop' | 'content' | 'insights';

export const NAV_CATEGORIES: NavCategory[] = ['develop', 'content', 'insights'];

//? view id → category. Views absent here (ai, settings, workspace, ticket ids) are category-less:
//? they keep flat /workspaces/<view> URLs. 'content' doubles as its category's index page
//? (/workspaces/content), so the overview keeps its short URL.
//? ADR 0312 — views whose SUB-navigation lives in the URL as extra path segments
//? (/workspaces/<category>/<view>/<tab>[/<section>]). Until now a page's tab and section were React
//? state: /workspaces/workspace always landed on the default tab, "Repository → Runtime" could not be
//? linked or bookmarked, the back button did nothing inside a page, and a refresh lost your place.
//? The deep-link affordance elsewhere in the app ("fix it over there") therefore had to navigate AND
//? push a separate focus request through context — two mechanisms for one idea.
//?
//? An ALLOWLIST rather than "any view": several paths after a view are already real routes with their
//? own meaning — /develop/board/<ticketId>[/editor], /content/<pieceId>, /content/settings — and
//? treating those segments as sub-navigation would break them. A view opts in here when its
//? sub-structure is genuinely navigational.
//? PATH prefixes (relative to /workspaces), not view ids: `/workspaces/content/settings` resolves to
//? the view `content` so the rail keeps highlighting Content, yet it is its own page with its own
//? tabs. Matching on the path keeps those two concerns apart instead of forcing one to bend.
export const TRAIL_ROOTS: readonly string[] = ['workspace', 'settings', 'develop/pipeline', 'content/settings', 'insights/usage'];

export const VIEW_CATEGORY: Record<string, NavCategory> = {
  board: 'develop',
  answers: 'develop',
  backlog: 'develop',
  pipeline: 'develop',
  automations: 'develop',
  scheduled: 'develop',
  code: 'develop',
  terminals: 'develop',
  designer: 'develop',
  components: 'develop',
  interviewer: 'develop',
  sources: 'develop',
  content: 'content',
  documents: 'content',
  marketing: 'content',
  'scheduled-posts': 'content',
  studio: 'content',
  activity: 'insights',
  usage: 'insights',
  knowledge: 'insights',
};
