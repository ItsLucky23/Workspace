import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/repoIntrospect/v1` — showing the user what is in their repo (ADR 0313).
//? The auto-sweep covers contract validation, auth enforcement, rate-limit clamp and fuzz.
//? These cover what it cannot infer:
//?  [1] NO REPO is the normal state on a fresh workspace, not an error. This route is called on mount
//?      by a settings panel, so returning an error here would put a red toast in front of every new
//?      user. It must answer `linked: false` with empty lists and a well-formed shape.
//?  [2] The shape is stable enough for the UI to render without guards — every array present, the
//?      package manager one of the known values. The panel maps over these directly.
//?  [3] It discloses repository contents, so it is workspaceSettings-gated: a logged-in user who is
//?      not a member of the workspace gets `auth.forbidden`, not an empty result. An empty result
//?      would be a silent leak of "this workspace exists and has no repo".

interface IntrospectInput { workspaceId: string; projectId?: string }
interface IntrospectOk {
  status: 'success';
  result: {
    linked: boolean;
    packageManager: string;
    scripts: { file: string; name: string; command: string }[];
    dockerfiles: string[];
    composeFiles: string[];
    units: string[];
    truncated: boolean;
  };
}
interface IntrospectErr { status: 'error'; errorCode: string }
type IntrospectResponse = IntrospectOk | IntrospectErr;

const PACKAGE_MANAGERS = new Set(['npm', 'yarn', 'pnpm', 'bun', 'unknown']);

export const customTests: CustomTestCase[] = [
  {
    name: 'a workspace with no linked repo answers linked:false instead of erroring',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'repointrospect_c1');
      try {
        const res = await ctx.callApi<IntrospectInput, IntrospectResponse>({ workspaceId });
        ctx.expect.eq(res.status, 'success', 'no repo is a normal state, not an error — this runs on mount for every new user');
        if (res.status !== 'success') return;
        ctx.expect.eq(res.result.linked, false, 'and it says so plainly, so the panel can render "link a repository first"');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'the result shape is complete, so the panel can render it without guards',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'repointrospect_c2');
      try {
        const res = await ctx.callApi<IntrospectInput, IntrospectResponse>({ workspaceId });
        ctx.expect.eq(res.status, 'success', 'call succeeds');
        if (res.status !== 'success') return;
        //? The UI maps over each of these directly. A missing array would crash the settings tab, and
        //? the empty-repo path is exactly the one a new user hits first.
        ctx.expect.ok(Array.isArray(res.result.scripts), 'scripts is always an array');
        ctx.expect.ok(Array.isArray(res.result.dockerfiles), 'dockerfiles is always an array');
        ctx.expect.ok(Array.isArray(res.result.composeFiles), 'composeFiles is always an array');
        ctx.expect.ok(Array.isArray(res.result.units), 'units is always an array');
        ctx.expect.eq(res.result.truncated, false, 'an empty scan is not truncated');
        ctx.expect.ok(PACKAGE_MANAGERS.has(res.result.packageManager), 'packageManager is one of the known values (it drives the "npm run"/"pnpm run" prefix shown to the user)');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a non-member is refused — repository contents are workspaceSettings-gated',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'repointrospect_c3');
      const outsider = await createRealUser(ctx.prisma, 'repointrospect_c3_outsider');
      try {
        //? Re-login AS the outsider: a real, valid user with no membership of this workspace.
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        const res = await ctx.callApi<IntrospectInput, IntrospectResponse>({ workspaceId });
        ctx.expect.eq(res.status, 'error', 'an outsider is rejected');
        if (res.status !== 'error') return;
        //? Deliberately an ERROR rather than an empty result: an empty result would still confirm the
        //? workspace exists and quietly disclose that it has no repository linked.
        ctx.expect.eq(res.errorCode, 'auth.forbidden', 'with the capability error, not a silent empty answer');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
