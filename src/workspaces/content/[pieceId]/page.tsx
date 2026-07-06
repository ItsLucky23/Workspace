//? intent: a content piece's detail — its stage/status, the generation controls (write · voice · images ·
//? video · music · 3D · assemble) with a style + free-form direction, and an asset area — the place a
//? non-technical user turns a brief into finished media, each generation confirmed (it may cost money).

import { useMemo, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';
import { menuHandler } from 'src/_functions/menuHandler';

import Icon, { type IconName } from '../../_components/Icon';
import { EmptyState } from '../../_components/primitives';
import { useWorkspaces } from '../../_shell/WorkspacesContext';

export const template = 'workspaces';

//? A generation action: its content-op + label + icon + whether it needs the reference url / a prompt.
interface GenAction { op: string; labelKey: string; icon: IconName; needsRef?: boolean; needsPrompt?: boolean }
const ACTIONS: GenAction[] = [
  { op: 'content-gen-script', labelKey: 'workspaces.content.actScript', icon: 'file-lines' },
  { op: 'content-gen-voice', labelKey: 'workspaces.content.actVoice', icon: 'wave-square' },
  { op: 'content-gen-images', labelKey: 'workspaces.content.actImages', icon: 'table-cells-large' },
  { op: 'content-gen-reference-image', labelKey: 'workspaces.content.actReferenceImage', icon: 'wand-magic-sparkles', needsRef: true },
  { op: 'content-gen-shortform', labelKey: 'workspaces.content.actShortform', icon: 'wand-magic-sparkles', needsPrompt: true },
  { op: 'content-gen-music', labelKey: 'workspaces.content.actMusic', icon: 'wave-square' },
  { op: 'content-gen-sfx', labelKey: 'workspaces.content.actSfx', icon: 'wave-square' },
  { op: 'content-gen-3d', labelKey: 'workspaces.content.act3d', icon: 'box-archive' },
  { op: 'content-assemble', labelKey: 'workspaces.content.actAssemble', icon: 'diagram-project' },
];

export default function ContentPiece({ params }: { params: Record<string, string | undefined> }) {
  const id = params.pieceid ?? '';
  const { content, runContentOp, navigate } = useWorkspaces();
  const translate = useTranslator();
  const [styleKey, setStyleKey] = useState('');
  const [extra, setExtra] = useState('');
  const [referenceUrl, setReferenceUrl] = useState('');

  const piece = useMemo(() => content.pieces.find((p) => p.id === id), [content.pieces, id]);

  if (!piece) {
    return (
      <div className="p-6">
        <EmptyState icon="circle-question" title={translate({ key: 'workspaces.content.notFound' })} sub={
          <button type="button" onClick={() => { navigate('content'); }} className="text-primary hover:underline cursor-pointer">{translate({ key: 'workspaces.content.backToBoard' })}</button>
        } />
      </div>
    );
  }

  const fire = (action: GenAction) => {
    void (async () => {
      const ok = await menuHandler.confirm({ title: translate({ key: 'workspaces.content.confirmTitle' }), content: translate({ key: 'workspaces.content.costWarning' }) });
      if (!ok) return;
      const payload: Record<string, string> = {};
      if (styleKey.trim()) payload.styleKey = styleKey.trim();
      if (extra.trim()) payload.extraInstructions = extra.trim();
      if (action.needsPrompt) payload.prompt = extra.trim() || piece.title;
      if (action.needsRef && referenceUrl.trim()) payload.referenceUrl = referenceUrl.trim();
      runContentOp(action.op, piece.id, payload);
    })();
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 md:px-6 py-3 md:py-4 flex items-center gap-3">
        <button type="button" onClick={() => { navigate('content'); }} title={translate({ key: 'workspaces.content.backToBoard' })} className="w-8 h-8 rounded-lg hover:bg-container2 text-muted hover:text-common flex items-center justify-center cursor-pointer">
          <Icon name="arrow-left" />
        </button>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-title truncate">{piece.title}</h1>
          <div className="flex items-center gap-2 text-xs text-muted mt-0.5">
            <span className="capitalize">{piece.format}</span>
            <span className="text-disabled">·</span>
            <span className="capitalize">{piece.stageId}</span>
            <span className="text-disabled">·</span>
            <span className="capitalize">{piece.status}</span>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 pb-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          {/* Creative direction — the shared style + free-form instruction applied to a generation. */}
          <section className="lg:col-span-1 rounded-2xl border border-container1-border bg-container1 p-5 flex flex-col gap-3">
            <div>
              <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.content.directionTitle' })}</div>
              <div className="text-sm text-muted mt-0.5">{translate({ key: 'workspaces.content.directionDesc' })}</div>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">{translate({ key: 'workspaces.content.styleLabel' })}</span>
              <input value={styleKey} onChange={(e) => { setStyleKey(e.target.value); }} placeholder={translate({ key: 'workspaces.content.stylePlaceholder' })} className="rounded-lg border border-container2-border bg-container2 px-3 py-2 text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">{translate({ key: 'workspaces.content.extraLabel' })}</span>
              <textarea value={extra} onChange={(e) => { setExtra(e.target.value); }} rows={3} placeholder={translate({ key: 'workspaces.content.extraPlaceholder' })} className="rounded-lg border border-container2-border bg-container2 px-3 py-2 text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring resize-none" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">{translate({ key: 'workspaces.content.referenceLabel' })}</span>
              <input value={referenceUrl} onChange={(e) => { setReferenceUrl(e.target.value); }} placeholder={translate({ key: 'workspaces.content.referencePlaceholder' })} className="rounded-lg border border-container2-border bg-container2 px-3 py-2 text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring" />
            </label>
            <div className="flex items-start gap-2 text-xs text-muted mt-1">
              <Icon name="triangle-exclamation" className="text-warning mt-0.5" /> {translate({ key: 'workspaces.content.costWarning' })}
            </div>
          </section>

          {/* Generation actions — each fires its control-op behind a confirm. */}
          <section className="lg:col-span-2 rounded-2xl border border-container1-border bg-container1 p-5">
            <div className="mb-4">
              <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.content.generateTitle' })}</div>
              <div className="text-sm text-muted mt-0.5">{translate({ key: 'workspaces.content.generateDesc' })}</div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ACTIONS.map((a) => (
                <button key={a.op} type="button" onClick={() => { fire(a); }} className="flex items-center gap-3 rounded-xl border border-container2-border bg-container2 hover:bg-container2-hover px-3 py-2.5 text-left cursor-pointer transition-colors">
                  <span className="w-8 h-8 rounded-lg bg-container1 text-primary flex items-center justify-center shrink-0"><Icon name={a.icon} /></span>
                  <span className="text-sm font-medium text-title">{translate({ key: a.labelKey })}</span>
                  <Icon name="wand-magic-sparkles" className="ml-auto text-muted" />
                </button>
              ))}
            </div>

            <div className="mt-5">
              <div className="text-sm font-medium text-muted mb-2">{translate({ key: 'workspaces.content.assetsTitle' })}</div>
              <div className="rounded-xl border border-dashed border-divider py-8 text-center text-sm text-disabled">
                {translate({ key: 'workspaces.content.assetsEmpty' })}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
