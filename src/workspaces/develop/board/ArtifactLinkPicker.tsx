//? Shared ticket-artifact picker. menuHandler renders outside WorkspacesProvider, so the
//? already-resolved workspace context is passed in explicitly (lesson 0011).

import { useTranslator } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';

import Icon from '../../_components/Icon';
import { EmptyPicker, type SetupFix } from '../../_components/SetupNotice';
import { WsButton } from '../../_components/primitives';
import { useWorkspaces, WorkspacesContextProvider } from '../../_shell/WorkspacesContext';
import { isSectionEnabled } from '../../_data/modules';

export function ArtifactLinkPicker({ ticketKey, ctx }: { ticketKey: string; ctx: ReturnType<typeof useWorkspaces> }) {
  const translate = useTranslator();
  const items: { id: string; kind: string; label: string }[] = [
    ...ctx.studioArtifacts.map((artifact) => ({ id: artifact.id, kind: artifact.kind, label: artifact.title })),
    ...ctx.designArtifacts.map((artifact) => ({ id: artifact.id, kind: artifact.kind, label: artifact.name })),
  ];
  //? Both source collections live in the design/content modules, which a Development-only workspace does
  //? not have (modules.ts:39-40) — so "generate one first" pointed at a page that isn't even in the nav.
  const designerOn = isSectionEnabled(ctx.activeWorkspace.enabledSections, 'designer');
  const studioOn = isSectionEnabled(ctx.activeWorkspace.enabledSections, 'studio');
  let fix: SetupFix;
  if (designerOn) fix = { cap: 'workTickets', view: 'designer', cta: translate({ key: 'workspaces.tips.board.artifactsCtaDesigner' }) };
  else if (studioOn) fix = { cap: 'workTickets', view: 'studio', cta: translate({ key: 'workspaces.tips.board.artifactsCtaStudio' }) };
  else fix = { cap: 'workspaceSettings', view: 'workspace', tab: 'modules', cta: translate({ key: 'workspaces.tips.board.artifactsCtaModules' }) };
  //? menuHandler renders this dialog outside WorkspacesProvider (lesson 0011), so EmptyPicker's own
  //? useWorkspaces() needs the passed-in ctx re-provided — and leaving for the fix must close the dialog.
  const pickerCtx = { ...ctx, focusSetup: (target: Parameters<typeof ctx.focusSetup>[0]) => { void menuHandler.close(); ctx.focusSetup(target); } };
  return (
    <div className={`w-full flex flex-col gap-2 p-5`}>
      <div className={`text-base font-semibold text-title`}>{translate({ key: 'workspaces.board.addReferenceTitle', params: [{ key: 'id', value: ticketKey }] })}</div>
      {items.length === 0 && (
        <WorkspacesContextProvider value={pickerCtx}>
          <EmptyPicker
            icon="image"
            label={translate({ key: designerOn || studioOn ? 'workspaces.tips.board.artifactsEmpty' : 'workspaces.tips.board.artifactsModulesOff' })}
            fix={fix}
          />
        </WorkspacesContextProvider>
      )}
      <div className={`max-h-80 overflow-y-auto flex flex-col gap-1`}>
        {items.map((artifact) => (
          <button key={`${artifact.kind}-${artifact.id}`} type="button" onClick={() => { ctx.linkArtifact(ticketKey, artifact.id, artifact.kind, artifact.label); void menuHandler.close(); }} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-container2 cursor-pointer`}>
            <Icon name="link" className={`text-muted`} />
            <span className={`text-sm text-title truncate`}>{artifact.label}</span>
            <span className={`text-xs text-muted ml-auto shrink-0`}>{artifact.kind}</span>
          </button>
        ))}
      </div>
      <div className={`flex justify-end`}><WsButton variant="ghost" onClick={() => void menuHandler.close()}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton></div>
    </div>
  );
}
