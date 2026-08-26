//? D55 — the CLIENT half of "timezone moet overal gebruikt worden" (owner 2026-08-26). The server anchors
//? its windows to `Workspace.timezone` (server/util/dateTz.ts); this hook is what stops the browser from
//? re-labelling those same moments in the reader's own zone. A scheduled post that the queue will publish
//? at 09:00 workspace-time must not read "08:00" for a colleague one country over — everyone on the team
//? has to be able to say the same time out loud and mean the same instant.
//?
//? Returns `undefined` rather than a zone when the workspace has none yet (the loading placeholder) or
//? when the stored value is one `Intl` cannot resolve. `undefined` is exactly what `toLocale*` wants for
//? "use the device zone", so every call site degrades to today's behaviour instead of throwing mid-render.

import { useMemo } from 'react';

import { tryCatchSync } from '@luckystack/core/client';

import { useWorkspaces } from '../_shell/WorkspacesContext';

export function useWorkspaceTimeZone(): string | undefined {
  const { activeWorkspace } = useWorkspaces();
  const zone = activeWorkspace.timezone ?? '';
  return useMemo(() => {
    const [error] = tryCatchSync(() => new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date(0)));
    return zone.length === 0 || error ? undefined : zone;
  }, [zone]);
}
