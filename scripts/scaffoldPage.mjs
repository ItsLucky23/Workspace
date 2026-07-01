// scripts/scaffoldPage.mjs
//
// Creates a new `src/<path>/page.tsx` with a sensible template. Refuses to
// overwrite. Validates the target path against the framework's routing
// convention BEFORE writing — files that wouldn't be routeable (e.g. a
// page placed directly inside an `_<folder>`, or inside a reserved framework
// folder like `_api`) hard-fail with the same reason the dev console
// would log.
//
// Usage:
//   npm run scaffold:page housing/renting
//   npm run scaffold:page _marketing/landing        # _marketing is invisible-parent
//   npm run scaffold:page admin/users/list
//
// Pure-Node ESM, zero runtime deps. Templates are inlined below so the
// script works both in the framework monorepo AND in a scaffolded consumer
// project (where `packages/devkit/src/templates/` isn't available).
//
// Keep the inlined templates in sync with
// `packages/devkit/src/templates/page_plain.template.ts` and
// `packages/devkit/src/templates/page_dashboard.template.ts` — if you edit
// one, mirror to the other. The framework's hot-reload template injector
// reads the package source; this script writes the same content.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const SRC_DIR = path.join(REPO_ROOT, 'src');

const safe = async (promise) => {
  try { return [null, await promise]; } catch (error) { return [error, null]; }
};

const fail = (message) => {
  console.error(`[scaffold:page] ${message}`);
  process.exit(1);
};

const arg = process.argv[2];
if (!arg) {
  fail(`Usage: npm run scaffold:page <relative-path>
Examples:
  npm run scaffold:page housing/renting       -> src/housing/renting/page.tsx (route: /housing/renting)
  npm run scaffold:page _marketing/landing    -> src/_marketing/landing/page.tsx (route: /landing)
  npm run scaffold:page admin/users/list      -> src/admin/users/list/page.tsx (route: /admin/users/list)

Pages placed directly inside an _<folder> (e.g. _marketing/page.tsx) are
invalid because no URL segment is left after stripping the invisible parent.`);
}

const normalizedArg = arg.replaceAll('\\', '/').replace(/^\/+/, '').replace(/\/+$/, '');
const argSegments = normalizedArg.split('/').filter((s) => s.length > 0);
if (argSegments.length === 0) {
  fail(`Invalid path "${arg}". Provide at least one folder segment.`);
}

const lastIsPage = argSegments.at(-1) === 'page.tsx' || argSegments.at(-1) === 'page.jsx';
const folderSegments = lastIsPage ? argSegments.slice(0, -1) : argSegments;
const srcRelativePath = `${folderSegments.join('/')}/page.tsx`;
const absoluteTargetPath = path.join(SRC_DIR, ...folderSegments, 'page.tsx');

// ---------------------------------------------------------------------------
// Validate the target path against the framework's routing convention.
// Mirrors `validatePagePath` in `@luckystack/core/pageRouteValidation.ts`.
// Keep the two in sync — if you add a private folder prefix or reserved
// folder there, mirror it here.
// ---------------------------------------------------------------------------

const PRIVATE_FOLDER_PREFIX = '_';
const SCAFFOLD_IGNORED_FOLDERS = new Set([
  '_api',
  '_sync',
  '_function',
  '_functions',
  '_component',
  '_components',
  '_provider',
  '_providers',
  '_locale',
  '_locales',
  '_socket',
  '_sockets',
  '_shared',
  '_server',
]);

const validatePagePath = (segments) => {
  for (const reserved of SCAFFOLD_IGNORED_FOLDERS) {
    if (segments.includes(reserved)) {
      return { valid: false, reason: `page.tsx cannot live inside reserved folder ${reserved}` };
    }
  }
  const visible = segments.filter((s) => !s.startsWith(PRIVATE_FOLDER_PREFIX));
  if (segments.length > 0 && visible.length === 0) {
    return { valid: false, reason: 'no URL segment left after stripping underscore folders' };
  }
  const route = visible.length === 0 ? '/' : `/${visible.join('/')}`;
  return { valid: true, route };
};

const validation = validatePagePath(folderSegments);
if (!validation.valid) {
  fail(`Cannot scaffold ${srcRelativePath}: ${validation.reason}`);
}

// ---------------------------------------------------------------------------
// Refuse to overwrite
// ---------------------------------------------------------------------------

const [existsErr] = await safe(fs.access(absoluteTargetPath));
if (!existsErr) {
  fail(`Page already exists at \`${path.relative(REPO_ROOT, absoluteTargetPath)}\`. Delete it first if you want to regenerate.`);
}

// ---------------------------------------------------------------------------
// Pick a template: dashboard for admin-shaped paths, plain otherwise.
// Heuristic mirrors `templateInjector.ts:getTemplate` so an explicit scaffold
// and a hot-reload-driven injection produce the same result for a given path.
// ---------------------------------------------------------------------------

const lowerPath = folderSegments.join('/').toLowerCase();
const looksLikeDashboard = /(^|\/)(admin|dashboard|settings|billing|account|profile)(\/|$)/.test(lowerPath);
const flavor = looksLikeDashboard ? 'dashboard' : 'plain';

// `{{REL_PATH}}` placeholder = how many `../` to climb from the target file
// back to the project root so `'{{REL_PATH}}config'` etc. resolve.
const depth = folderSegments.length + 1; // +1 for the leading `src/`
const relPath = '../'.repeat(depth);

const PAGE_PLAIN_TEMPLATE = `//? intent: TODO — describe in one plain-language line what this page is FOR.

//? Plain page template — no UI chrome. Use for landing/public pages where
//? the default surrounding layout (\`'plain'\`) is what you want. Per-page
//? middleware is OPTIONAL — uncomment when this route needs a guard.

//@ts-ignore Relative import: '{{REL_PATH}}' is replaced at scaffold time.
// import type { PageMiddleware } from '@luckystack/core/client';
//@ts-ignore Relative import: '{{REL_PATH}}' is replaced at scaffold time.
// import type { SessionLayout } from '{{REL_PATH}}config';

export const template = 'plain';

// export const middleware: PageMiddleware<SessionLayout> = ({ session }) => {
//   if (!session) return { success: false, redirect: '/login' };
//   return { success: true };
// };

interface PageProps {
  params: Record<string, string | undefined>;
  searchParams: Record<string, string>;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- scaffold props; use or remove when you build the page out
export default function Page({ params, searchParams }: PageProps) {
  return (
    <div className='flex items-center justify-center w-full h-full text-title'>
      {/* TODO: replace with your page content (wrap any user-facing copy in useTranslator) */}
    </div>
  );
}
`;

const PAGE_DASHBOARD_TEMPLATE = `//? intent: TODO — describe in one plain-language line what this page is FOR.

//? Dashboard page template — wrapped in the \`'dashboard'\` template
//? (sidebar + main content). Includes a login-required middleware as a
//? sane default — adjust the role check or remove the middleware if this
//? page is public.

import type { PageMiddleware } from '@luckystack/core/client';
//@ts-ignore Relative import: '{{REL_PATH}}' is replaced at scaffold time.
import type { SessionLayout } from '{{REL_PATH}}config';

export const template = 'dashboard';

//? Default: require login. Customize for role checks
//? (e.g. \`if (!session.admin) return undefined;\` to bounce non-admins back).
export const middleware: PageMiddleware<SessionLayout> = ({ session }) => {
  if (!session) return { success: false, redirect: '/login' };
  return { success: true };
};

interface PageProps {
  params: Record<string, string | undefined>;
  searchParams: Record<string, string>;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- scaffold props; use or remove when you build the page out
export default function Page({ params, searchParams }: PageProps) {
  return (
    <div className='flex flex-col gap-4 p-6 w-full h-full'>
      <h1 className='text-2xl font-semibold text-title'>{/* TODO: page title */}</h1>
      <div className='text-common'>{/* TODO: page content */}</div>
    </div>
  );
}
`;

const rawTemplate = flavor === 'dashboard' ? PAGE_DASHBOARD_TEMPLATE : PAGE_PLAIN_TEMPLATE;
const rendered = rawTemplate.replaceAll('{{REL_PATH}}', relPath);

// ---------------------------------------------------------------------------
// Make parent dirs + write
// ---------------------------------------------------------------------------

await fs.mkdir(path.dirname(absoluteTargetPath), { recursive: true });
await fs.writeFile(absoluteTargetPath, rendered, 'utf8');

console.log(`[scaffold:page] created ${path.relative(REPO_ROOT, absoluteTargetPath)}`);
console.log(`[scaffold:page] route: ${validation.route} (template: ${flavor})`);
console.log(`[scaffold:page] next: open the file, replace the placeholder content, and the dev server will pick it up automatically.`);
