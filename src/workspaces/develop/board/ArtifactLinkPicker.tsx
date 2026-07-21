//? Shared ticket-artifact picker. menuHandler renders outside WorkspacesProvider, so the
//? already-resolved workspace context is passed in explicitly (lesson 0011).

import { useTranslator } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';

import Icon from '../../_components/Icon';
import { WsButton } from '../../_components/primitives';
import { useWorkspaces } from '../../_shell/WorkspacesContext';

export function ArtifactLinkPicker({ ticketKey, ctx }: { ticketKey: string; ctx: ReturnType<typeof useWorkspaces> }) {
  const translate = useTranslator();
  const items: { id: string; kind: string; label: string }[] = [
    ...ctx.studioArtifacts.map((artifact) => ({ id: artifact.id, kind: artifact.kind, label: artifact.title })),
    ...ctx.designArtifacts.map((artifact) => ({ id: artifact.id, kind: artifact.kind, label: artifact.name })),
  ];
  return (
    <div className={`w-full flex flex-col gap-2 p-5`}>
      <div className={`text-base font-semibold text-title`}>{translate({ key: 'workspaces.board.addReferenceTitle', params: [{ key: 'id', value: ticketKey }] })}</div>
      {items.length === 0 && <div className={`text-sm text-muted py-4 text-center`}>{translate({ key: 'workspaces.board.noArtifacts' })}</div>}
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
