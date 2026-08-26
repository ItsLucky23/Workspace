//? Marketing — the artifact CARD chrome only. The per-kind previews, the content readers and the
//? HTML→PNG rasterizer are the Studio's (../studio/previews, ../studio/content) — this file used to carry
//? byte-near copies of all of them (F-005/F-020). Same ops as the Studio card, different presentation:
//? the ONE contextually-primary action (Publish live / Use as brand / Send to Content) stays a
//? visible button, all rare actions (Regenerate, Expand, Copy HTML, Download PNG, Delete) live
//? in an overflow menu so the title never truncates away on a phone.

import { useState } from 'react';

import { i18nNotify as notify, useTranslator } from '@luckystack/core/client';

import Icon, { type IconName } from '../../_components/Icon';
import { PopMenu, type PopMenuItem } from '../../_components/primitives';
import type { StudioArtifact } from '../../_data/types';
import { asRecord, asStr, downloadHtmlAsPng } from '../studio/content';
import { KIND_ICONS } from '../studio/kinds';
import { ArtifactBody } from '../studio/previews';
import { useWorkspaceTimeZone } from '../../_functions/wsTime';

//? ---- Artifact card ----
//? Header = icon + title + status + ONE primary action + overflow menu. Priority for the visible
//? button: Publish live (landing) > Use as brand (brand) > Send to Content; whichever loses the
//? slot stays reachable via the menu. `busy` guards Regenerate while another generation runs.
export function ArtifactCard({ artifact, busy, pendingRefine, onDelete, onRegenerate, onPromote, onSendToContent, onPublishLive }: { artifact: StudioArtifact; busy: boolean; pendingRefine: string; onDelete: () => void; onRegenerate: () => void; onPromote?: () => void; onSendToContent?: () => void; onPublishLive?: () => void }) {
  const translate = useTranslator();
  const c = asRecord(artifact.content);
  //? D55 — workspace time, not the reader's device time.
  const timeZone = useWorkspaceTimeZone();
  const when = new Date(artifact.createdAt).toLocaleString(undefined, { timeZone });
  //? Expand state lives here (not in the preview) so the overflow menu can toggle it.
  const [full, setFull] = useState(false);
  const html = asStr(c.html);
  const hasHtmlPreview = (artifact.kind === 'landing' || artifact.kind === 'component' || artifact.kind === 'thumbnail') && artifact.status === 'ready' && html.trim().length > 0;
  //? I4 bug fix — the refine that PRODUCED this card (persisted, historical) vs. the refine that WILL
  //? apply if Regenerate is clicked now (the live shared box) are two different things; show both
  //? instead of leaving the user to guess which one a stale box silently reapplies.
  const usedRefine = artifact.refine ?? null;
  const trimmedPending = pendingRefine.trim();
  const regenerateLabel = trimmedPending.length > 0
    ? translate({ key: 'workspaces.studio.regenerateWithRefine', params: [{ key: 'refine', value: trimmedPending.length > 28 ? `${trimmedPending.slice(0, 27)}…` : trimmedPending }] })
    : translate({ key: 'workspaces.studio.regenerate' });

  let primary: { onClick: () => void; icon: IconName; label: string; hint: string } | null = null;
  if (onPublishLive) primary = { onClick: onPublishLive, icon: 'globe', label: 'workspaces.studio.publishLive', hint: 'workspaces.studio.publishLiveHint' };   //? G3 — one click from "generated page" to a real public URL (re-publish = update, same slug).
  else if (onPromote) primary = { onClick: onPromote, icon: 'swatchbook', label: 'workspaces.studio.useAsBrand', hint: 'workspaces.studio.useAsBrandHint' };
  else if (onSendToContent) primary = { onClick: onSendToContent, icon: 'paper-plane', label: 'workspaces.studio.sendToContent', hint: 'workspaces.studio.sendToContentHint' };

  const menu: PopMenuItem[] = [
    //? busyKind semantics preserved: while any generation runs, Regenerate is inert (was `disabled`).
    { label: regenerateLabel, icon: 'rotate', onClick: () => { if (!busy) onRegenerate(); } },
  ];
  if (onSendToContent && primary && primary.onClick !== onSendToContent) menu.push({ label: translate({ key: 'workspaces.studio.sendToContent' }), icon: 'paper-plane', onClick: onSendToContent });
  if (hasHtmlPreview) {
    menu.push(
      { label: translate({ key: full ? 'workspaces.studio.collapse' : 'workspaces.studio.expand' }), icon: full ? 'compress' : 'expand', onClick: () => { setFull((v) => !v); } },
      { label: translate({ key: 'workspaces.studio.copyHtml' }), icon: 'copy', onClick: () => { void navigator.clipboard.writeText(html); } },
      //? #170 — falls back to Copy HTML on a tainted canvas; the failure notify is deliberate honesty.
      { label: translate({ key: 'workspaces.studio.downloadPng' }), icon: 'file-export', onClick: () => { downloadHtmlAsPng(html, () => { notify.error({ key: 'workspaces.studio.pngFailed' }); }); } },
    );
  }
  menu.push({ divider: true }, { label: translate({ key: 'workspaces.studio.deleteArtifact' }), icon: 'trash-can', danger: true, onClick: onDelete });

  return (
    <div className={`rounded-2xl border border-container1-border bg-container1 overflow-hidden`}>
      <div className={`flex items-center gap-2 px-4 py-2.5 border-b border-divider`}>
        <Icon name={KIND_ICONS[artifact.kind]} className={`text-primary shrink-0`} />
        <div className={`text-sm font-medium text-title flex-1 truncate`}>{artifact.title}</div>
        {/* #168 — a 'generating' artifact shows an in-progress spinner until the detached completion flips it. */}
        {artifact.status === 'generating' && <span className={`text-xs text-muted flex items-center gap-1.5 shrink-0`}><Icon name="spinner" className={`animate-spin`} />{translate({ key: 'workspaces.studio.generating' })}</span>}
        {artifact.status === 'error' && <span className={`text-xs text-wrong shrink-0`}>{translate({ key: 'workspaces.studio.failed' })}</span>}
        {primary && <button type="button" onClick={primary.onClick} title={translate({ key: primary.hint })} className={`shrink-0 text-xs text-primary hover:text-primary-hover cursor-pointer flex items-center gap-1`}><Icon name={primary.icon} className={`text-xs`} />{translate({ key: primary.label })}</button>}
        <PopMenu ariaLabel={translate({ key: 'workspaces.studio.artifactMenu' })} items={menu} />
      </div>
      <div className={`p-4`}>
        {artifact.status === 'generating' && <div className={`text-sm text-muted flex items-center gap-2`}><Icon name="spinner" className={`animate-spin`} />{translate({ key: 'workspaces.studio.generating' })}</div>}
        {artifact.status === 'error' && <div className={`text-sm text-muted`}>{artifact.error ?? translate({ key: 'workspaces.studio.failed' })}</div>}
        {artifact.status === 'ready' && <ArtifactBody kind={artifact.kind} c={c} full={full} />}
      </div>
      {/* demoted metadata: one collapsed muted line */}
      <div className={`px-4 py-2 border-t border-divider text-[11px] text-meta flex items-center gap-2`}>
        <span>{translate({ key: `workspaces.studio.kind.${artifact.kind}` })}</span>
        {artifact.providerId && <span>· {artifact.providerId}</span>}
        {usedRefine && <span className={`truncate max-w-[10rem]`} title={usedRefine}>· {translate({ key: 'workspaces.studio.refinedWith', params: [{ key: 'refine', value: usedRefine }] })}</span>}
        <span className={`ml-auto`}>{when}</span>
      </div>
    </div>
  );
}
