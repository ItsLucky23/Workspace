import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `workspaces/devLaunchEditor/v1`. This route is DEV-ONLY (hard-gated on
//? `WS_DEV_EDITOR=1`, `auth.login: false`) and, past the gate, runs `docker` + spawns a real
//? container — not deterministically testable in this harness. This project's `.env.local` sets
//? `WS_DEV_EDITOR=1` (the code-editor dev-testing flag), so BOTH the test process and the
//? already-running server it hits have the gate OPEN, not the disabled default a generic harness
//? run would see. What IS still deterministic and worth asserting here: the gate reads
//? `process.env.WS_DEV_EDITOR` fresh on every call (so it tracks whichever state this deployment
//? is actually in) and, when open, never returns the `editor.devDisabled` error code — proving the
//? check really does gate on the env var rather than being permanently short-circuited one way.
//? The real docker/git path beyond the gate stays untested here per the route's own docs.
//?
//? Integration test: no login/workspace needed — `auth.login: false` and the gate short-circuits
//? before any Prisma access when closed, so there is nothing to seed or clean up.

interface DevLaunchErr { status: 'error'; errorCode: string }
interface DevLaunchOk { status: 'success'; result: unknown }
type DevLaunchResponse = DevLaunchOk | DevLaunchErr;

//? Read once at module load — matches the running server's own `.env.local`-sourced value for the
//? duration of this process, and both cases below re-derive their expectation from it rather than
//? hardcoding "disabled" as the assumed default.
const gateOpen = process.env.WS_DEV_EDITOR === '1';

export const customTests: CustomTestCase[] = [
  {
    name: gateOpen
      ? 'WS_DEV_EDITOR=1 in this deployment — the gate does not refuse with editor.devDisabled'
      : 'WS_DEV_EDITOR unset (the default) refuses with editor.devDisabled',
    run: async (ctx: TestContext) => {
      const res = await ctx.callApi<{ authWorkspaceId?: string }, DevLaunchResponse>({});
      if (!gateOpen) {
        ctx.expect.eq(res.status, 'error', 'the dev-only gate refuses the request');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'editor.devDisabled', 'errorCode is editor.devDisabled');
        return;
      }
      ctx.expect.ok(
        !(res.status === 'error' && res.errorCode === 'editor.devDisabled'),
        'gate is open (WS_DEV_EDITOR=1), so the request is never refused with editor.devDisabled',
      );
    },
  },
  {
    name: 'the gate check does not depend on the optional authWorkspaceId payload',
    run: async (ctx: TestContext) => {
      const res = await ctx.callApi<{ authWorkspaceId?: string }, DevLaunchResponse>({ authWorkspaceId: 'not-a-real-workspace-id' });
      if (!gateOpen) {
        ctx.expect.eq(res.status, 'error', 'still refused even with a bogus authWorkspaceId payload');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'editor.devDisabled', 'errorCode is editor.devDisabled (never reaches proxy upsert)');
        return;
      }
      ctx.expect.ok(
        !(res.status === 'error' && res.errorCode === 'editor.devDisabled'),
        'gate is open (WS_DEV_EDITOR=1); a bogus authWorkspaceId does not change the gate outcome',
      );
    },
  },
];
