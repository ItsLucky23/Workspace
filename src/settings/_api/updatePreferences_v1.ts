import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { enqueueGlobalRouteWrite } from '../../../server/orchestrator/conductor';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
//? Workaround for a @luckystack/core@0.3.0 bug: the string `validateType` infinite-recurses on a
//? nested union, and the generator renders each optional boolean here as `?: undefined | false | true`
//? (a union nested in the object), so the default validator always fails with a depth-64 error and the
//? save never lands. `relaxed` skips that validator; `main` below already allow-lists every field to a
//? boolean, so this is safe. Remove once core is fixed (see docs/reports/LUCKYSTACK_CORE_VALIDATETYPE_BUG.md).
export const validation = 'relaxed' as const;

export const auth: AuthProps = {
  login: true,
  additional: [],
};

export interface UserPreferences {
  notifyOnNewSignIn?: boolean;
  notifyOnPasswordChange?: boolean;
  notifyOnAssignment?: boolean; // Workspaces in-app assignment bell (#13) — opt-out, default on
  pushOnAssignment?: boolean;   // A3 — per-type web-push opt-out (default on)
  pushOnAutomation?: boolean;
  pushOnAiSuggestion?: boolean;
}

export interface ApiParams {
  data: { preferences: UserPreferences };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const incoming = data.preferences;
  // Allow-list to prevent arbitrary keys from being saved. Skip undefined values
  // entirely so the Prisma JSON column never receives a non-JSON-serializable value.
  const sanitized: Record<string, boolean> = {};
  if (typeof incoming.notifyOnNewSignIn === 'boolean') sanitized.notifyOnNewSignIn = incoming.notifyOnNewSignIn;
  if (typeof incoming.notifyOnPasswordChange === 'boolean') sanitized.notifyOnPasswordChange = incoming.notifyOnPasswordChange;
  if (typeof incoming.notifyOnAssignment === 'boolean') sanitized.notifyOnAssignment = incoming.notifyOnAssignment;
  if (typeof incoming.pushOnAssignment === 'boolean') sanitized.pushOnAssignment = incoming.pushOnAssignment;
  if (typeof incoming.pushOnAutomation === 'boolean') sanitized.pushOnAutomation = incoming.pushOnAutomation;
  if (typeof incoming.pushOnAiSuggestion === 'boolean') sanitized.pushOnAiSuggestion = incoming.pushOnAiSuggestion;

  const [writeError, updated] = await functions.tryCatch.tryCatch(() => enqueueGlobalRouteWrite(
    { kind: 'account.preferences', userId: user.id },
    async () => {
      const saved = await functions.db.prisma.user.update({ where: { id: user.id }, data: { preferences: sanitized } });
      if (user.token) {
        //? Bind to a local first so the object literal isn't subject to excess property checks against
        //? `BaseSessionLayout` — `preferences` lives on the project's extended `SessionLayout`.
        const merged = { ...user, preferences: saved.preferences };
        await functions.session.saveSession(user.token, merged);
      }
      return saved;
    },
  ));

  if (writeError || !updated) return { status: 'error', errorCode: 'common.500' };

  return { status: 'success', result: { preferences: sanitized } };
};
