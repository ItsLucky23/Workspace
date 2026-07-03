//? Workspaces — per-workspace GIT config + branch-strategy resolver + DNS-safe host slug.
//?
//? One source of truth for two consumers (hosting-proxy plan): the strategy turns a ticket
//? into its durable branch name, and the SAME branch derives the preview subdomain label —
//? so `feature/DEV-1240-login` → host `feature-dev-1240-login.<baseDomain>`. This module is
//? PURE (no I/O): `resolveBranchName` is called ONCE when a ticket's branch is first created
//? (the result is persisted on `Ticket.branch` and reused thereafter, so changing the
//? strategy never renames an in-flight ticket's branch), and `deriveHostSlug` is called by
//? the container/proxy layer to build a valid RFC-1123 DNS label.

//? The config type + its enums are the shared, client-visible shape (types.ts is the single
//? home so the settings UI + the snapshot agree); THIS module owns the runtime const + logic.
//? Strategies — `ticket-prefix`: bare key `DEV-1240` (the legacy hardcode); `typed`:
//? `<type>/<KEY>-<slug>` e.g. `feature/DEV-1240-add-login`; `custom`: `branchTemplate` filled.
import type { BranchStrategyKind, GitConfig, PushPolicy } from '../../src/workspaces/_data/types';

export type { BranchStrategyKind, GitConfig, PushPolicy } from '../../src/workspaces/_data/types';

//? The safe default: identical to the pre-config behaviour (branch == ticket key, no push).
export const DEFAULT_GIT_CONFIG: GitConfig = {
  branchStrategy: 'ticket-prefix',
  defaultBranchType: 'feature',
  branchTemplate: '{{type}}/{{key}}-{{slug}}',
  pushPolicy: 'local-only',
  targetBranch: 'main',
  protectedBranches: ['main', 'master'],
  commitSigning: false,
};

//? A stored git config may be partial (older workspace, or a UI that only sets some fields).
//? Merge onto the default so callers always get a complete, valid config.
export function normalizeGitConfig(raw: unknown): GitConfig {
  if (raw === null || typeof raw !== 'object') return { ...DEFAULT_GIT_CONFIG };
  const r = raw as Partial<GitConfig>;
  const kind: BranchStrategyKind =
    r.branchStrategy === 'typed' || r.branchStrategy === 'custom' ? r.branchStrategy : 'ticket-prefix';
  const policy: PushPolicy =
    r.pushPolicy === 'push' || r.pushPolicy === 'merge-request' ? r.pushPolicy : 'local-only';
  return {
    branchStrategy: kind,
    defaultBranchType: typeof r.defaultBranchType === 'string' && r.defaultBranchType ? r.defaultBranchType : DEFAULT_GIT_CONFIG.defaultBranchType,
    branchTemplate: typeof r.branchTemplate === 'string' && r.branchTemplate ? r.branchTemplate : DEFAULT_GIT_CONFIG.branchTemplate,
    pushPolicy: policy,
    targetBranch: typeof r.targetBranch === 'string' && r.targetBranch ? r.targetBranch : DEFAULT_GIT_CONFIG.targetBranch,
    protectedBranches: Array.isArray(r.protectedBranches) ? r.protectedBranches.filter((b): b is string => typeof b === 'string') : [...DEFAULT_GIT_CONFIG.protectedBranches],
    commitSigning: r.commitSigning === true,
  };
}

//? The ticket fields the resolver reads. Kept minimal + structural so callers can pass a
//? Prisma Ticket row or a lighter shape.
export interface TicketRef {
  key: string;
  title?: string | null;
  number?: number | null;
  labels?: string[];
  //? Explicit override (e.g. chosen at activation); wins over labels/default.
  branchType?: string | null;
}

//? A short, kebab-cased, ascii slug from free text (a ticket title), bounded to `max` chars
//? on a word boundary. Empty input → ''. Used for the `{{slug}}` token.
function textSlug(text: string, max = 32): string {
  const kebab = text
    .toLowerCase()
    .normalize('NFKD')
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
  if (kebab.length <= max) return kebab;
  //? Truncate at the last '-' before `max` so we don't cut a word mid-way.
  const cut = kebab.slice(0, max);
  const lastDash = cut.lastIndexOf('-');
  return (lastDash > 8 ? cut.slice(0, lastDash) : cut).replaceAll(/-+$/g, '');
}

//? The branch TYPE for a ticket: explicit `branchType` → a recognised label → the config default.
function branchTypeFor(cfg: GitConfig, ticket: TicketRef): string {
  const known = new Set(['feature', 'fix', 'hotfix', 'chore', 'bugfix', 'refactor', 'docs']);
  if (ticket.branchType?.trim()) return textSlug(ticket.branchType);
  const fromLabel = (ticket.labels ?? []).map((l) => l.toLowerCase()).find((l) => known.has(l));
  return fromLabel ?? cfg.defaultBranchType;
}

//? Resolve the durable branch name for a ticket per the workspace strategy. Deterministic and
//? side-effect-free; call ONCE at branch creation and persist the result.
export function resolveBranchName(cfg: GitConfig, ticket: TicketRef): string {
  const key = ticket.key;
  if (cfg.branchStrategy === 'ticket-prefix') return key;

  const type = branchTypeFor(cfg, ticket);
  const slug = textSlug(ticket.title ?? '');
  if (cfg.branchStrategy === 'typed') {
    return slug ? `${type}/${key}-${slug}` : `${type}/${key}`;
  }
  //? 'custom' — fill the template, then clean up any empty-token artefacts.
  const prefix = key.split('-')[0] ?? key; //? e.g. 'DEV' from 'DEV-1240'
  const filled = cfg.branchTemplate
    .replaceAll('{{type}}', type)
    .replaceAll('{{prefix}}', prefix)
    .replaceAll('{{key}}', key)
    .replaceAll('{{number}}', String(ticket.number ?? key.split('-')[1] ?? ''))
    .replaceAll('{{slug}}', slug);
  //? Collapse artefacts from empty tokens ('feature/-DEV' , trailing '-/') into a clean ref.
  const cleaned = filled.replaceAll(/-{2,}/g, '-').replaceAll(/\/-|-\//g, '/').replaceAll(/^[-/]+|[-/]+$/g, '');
  return cleaned || key;
}

//? Derive a valid RFC-1123 DNS label (the preview subdomain) from a branch name. Lowercases,
//? maps every non-alnum run (incl. '/') to '-', trims to start/end alnum, and truncates ≤63.
//? Guaranteed non-empty for a non-empty branch. Two branches that differ only in punctuation
//? CAN collide — callers that need global uniqueness scope the host by the (unique) ticket key.
export function deriveHostSlug(branch: string): string {
  const label = branch
    .toLowerCase()
    .normalize('NFKD')
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 63)
    .replaceAll(/-+$/g, '');
  return label || 'ticket';
}

//? The full preview host for a ticket: `<slug>.<baseDomain>`. `baseDomain` is host-level
//? (server config, e.g. `workspace.keetlerop.nl`), the slug is per-ticket (branch-derived).
export function previewHost(branch: string, baseDomain: string): string {
  return `${deriveHostSlug(branch)}.${baseDomain}`;
}
