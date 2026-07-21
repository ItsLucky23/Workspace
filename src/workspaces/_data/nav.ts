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
