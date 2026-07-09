//? S1 — the per-stack base-image CATALOG (any-stack unlock). Every stack base extends the ONE agent base
//? (`workspaces/base` = node + the pinned claude CLI + node-pty + openvscode + the pty-agent + DB clients), because
//? the coding agent + editor are Node-based and must run in EVERY container; a stack base just adds that stack's
//? toolchain on top (python/go/rust/jdk). So "clean per-stack images" = the agent base + the stack layer, and the
//? Dockerfile-trust guard is relaxed from a single image to this catalog FAMILY (all `workspaces/base*`). The
//? catalog + guard + resolver are pure + unit-tested; the images themselves are built from `docker/base-*.Dockerfile`.

//? The default agent base tag (the Node stack) — env-overridable, kept in sync with the other modules' default.
const BASE_TAG = (process.env.WS_BASE_IMAGE ?? 'workspaces/base:0.1.0').trim();

export const BASE_STACKS = ['node', 'python', 'go', 'rust', 'java'] as const;
export type BaseStack = (typeof BASE_STACKS)[number];

export function isBaseStack(s: string | null | undefined): s is BaseStack {
  return typeof s === 'string' && (BASE_STACKS as readonly string[]).includes(s);
}

//? The pre-built L1 image for a stack. `node` IS the agent base; the others are `workspaces/base-<stack>` (built
//? FROM the agent base + the toolchain — see docker/base-<stack>.Dockerfile). All env-overridable per stack.
export function baseImageFor(stack: string | null | undefined): string {
  const s: BaseStack = isBaseStack(stack) ? stack : 'node';
  if (s === 'node') return BASE_TAG;
  const override = (process.env[`WS_BASE_IMAGE_${s.toUpperCase()}`] ?? '').trim();
  return override.length > 0 ? override : `workspaces/base-${s}:${BASE_TAG.split(':')[1] ?? '0.1.0'}`;
}

//? The launch image for a project: its built L2 image (`baseImageRef`) if present, else the L1 base for its stack.
export function resolveProjectBaseImage(project: { baseImageRef?: string | null; stack?: string | null } | null): string {
  const ref = (project?.baseImageRef ?? '').trim();
  return ref.length > 0 ? ref : baseImageFor(project?.stack);
}

//? S3 — the default dev-server command per stack (used when a LINKED project has no explicit `devCommand`; a
//? greenfield project already carries one from its template). All bind 0.0.0.0:<WS_PREVIEW_PORT> so the proxy can
//? dial the container. `PORT`/`HOST` env are set by the preview launcher for the servers that read them.
const DEV_COMMANDS: Record<BaseStack, string> = {
  node: 'npm run dev',
  python: 'uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-5173}',
  go: 'go run .',
  rust: 'cargo run',
  java: './mvnw spring-boot:run || mvn spring-boot:run',
};
export function defaultDevCommand(stack: string | null | undefined): string {
  return DEV_COMMANDS[isBaseStack(stack) ? stack : 'node'];
}

//? S3 — resolve a project's dev command: its explicit `devCommand`, else the stack default.
export function resolveDevCommand(project: { devCommand?: string | null; stack?: string | null } | null): string {
  const explicit = (project?.devCommand ?? '').trim();
  return explicit.length > 0 ? explicit : defaultDevCommand(project?.stack);
}

//? S1 — the Dockerfile-trust guard, RELAXED to the base FAMILY: the first `FROM` must be a `workspaces/base*`
//? image (the agent base or any stack variant), not an arbitrary upstream (still a supply-chain gate). A
//? `# syntax=` directive before the FROM is fine. Replaces the three triplicated `extendsBase` copies.
export function extendsAllowedBase(dockerfile: string): boolean {
  const firstFrom = dockerfile.split('\n').map((l) => l.trim()).find((l) => /^FROM\s/i.test(l));
  if (firstFrom === undefined) return false;
  const image = firstFrom.replace(/^FROM\s+/i, '').trim().toLowerCase();
  return image.startsWith('workspaces/base');
}
