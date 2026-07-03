//? Unit test — the per-workspace branch-strategy resolver + DNS-safe host slug + git-config
//? normalizer (server/git/branchStrategy). Pure, no DB. This is the load-bearing logic that
//? turns a ticket into its branch name AND its preview subdomain, so a regression here
//? mis-names branches/routes silently. Run: `npx tsx tests/unit/branchStrategy.test.mts`.

import { DEFAULT_GIT_CONFIG, normalizeGitConfig, resolveBranchName, deriveHostSlug, previewHost } from '../../server/git/branchStrategy';
import { assert, eq, report } from '../_helpers.mts';

const ticket = { key: 'DEV-1240', title: 'Add login flow', number: 1240, labels: [] };

// --- 1. resolveBranchName per strategy ---------------------------------------
eq(resolveBranchName(DEFAULT_GIT_CONFIG, ticket), 'DEV-1240', 'ticket-prefix → bare ticket key');

const typed = normalizeGitConfig({ branchStrategy: 'typed', defaultBranchType: 'feature' });
eq(resolveBranchName(typed, ticket), 'feature/DEV-1240-add-login-flow', 'typed → type/key-slug');
eq(resolveBranchName(typed, { key: 'DEV-1', title: '' }), 'feature/DEV-1', 'typed without a title → type/key');
eq(resolveBranchName(typed, { ...ticket, labels: ['hotfix'] }), 'hotfix/DEV-1240-add-login-flow', 'a known label overrides the branch type');

const custom = normalizeGitConfig({ branchStrategy: 'custom', branchTemplate: '{{prefix}}/{{number}}-{{slug}}' });
eq(resolveBranchName(custom, ticket), 'DEV/1240-add-login-flow', 'custom template tokens filled');
const customEmpty = normalizeGitConfig({ branchStrategy: 'custom', branchTemplate: '{{type}}/{{key}}-{{slug}}' });
eq(resolveBranchName(customEmpty, { key: 'DEV-7', title: '' }), 'feature/DEV-7', 'custom collapses an empty {{slug}} artefact');

// --- 2. deriveHostSlug → valid RFC-1123 DNS label ----------------------------
eq(deriveHostSlug('feature/DEV-1240-add-login-flow'), 'feature-dev-1240-add-login-flow', 'slashes + case → dns label');
eq(deriveHostSlug('DEV-1240'), 'dev-1240', 'slug lowercases');
assert(deriveHostSlug('___').length > 0, 'slug is never empty (falls back to "ticket")');
assert(deriveHostSlug('x'.repeat(100)).length <= 63, 'slug truncated to ≤63 chars');
assert(!/^-|-$/.test(deriveHostSlug('-weird-/-')), 'slug never starts/ends with a dash');
eq(previewHost('DEV-1240', 'workspace.keetlerop.nl'), 'dev-1240.workspace.keetlerop.nl', 'previewHost = <slug>.<baseDomain>');

// --- 3. normalizeGitConfig fills + guards -------------------------------------
const dflt = normalizeGitConfig(null);
eq(dflt.branchStrategy, 'ticket-prefix', 'null → default strategy');
eq(dflt.pushPolicy, 'local-only', 'null → default push policy');
eq(normalizeGitConfig({ branchStrategy: 'bogus', pushPolicy: 'nope' }).branchStrategy, 'ticket-prefix', 'bogus strategy → default');
eq(normalizeGitConfig({ branchStrategy: 'bogus' }).pushPolicy, 'local-only', 'bogus push policy → default');
eq(normalizeGitConfig({ protectedBranches: ['dev', 42, 'main'] }).protectedBranches.length, 2, 'non-string protected branches dropped');
eq(normalizeGitConfig({ commitSigning: true }).commitSigning, true, 'commitSigning passthrough');

report('tests/unit/branchStrategy.test.mts');
