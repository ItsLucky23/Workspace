//? Marketing — artifact card + per-kind live previews (KISS fork of the shared Studio surface's
//? rendering; /studio keeps its own in ../studio/page.tsx). Same ops, different presentation:
//? the ONE contextually-primary action (Publish live / Use as brand / Send to Content) stays a
//? visible button, all rare actions (Regenerate, Expand, Copy HTML, Download PNG, Delete) live
//? in an overflow menu so the title never truncates away on a phone.

import { useState, type ReactNode } from 'react';

import { i18nNotify as notify, useTranslator } from '@luckystack/core/client';

import Icon, { type IconName } from '../../_components/Icon';
import { PopMenu, type PopMenuItem } from '../../_components/primitives';
import type { StudioArtifact, StudioArtifactKind } from '../../_data/types';
import { KIND_ICONS } from './kinds';

//? ---- content readers (the AI content is `unknown`; read defensively, no casts to `any`) ----
function asRecord(v: unknown): Record<string, unknown> { return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}; }
function asStr(v: unknown): string { return typeof v === 'string' ? v : ''; }
function asStrArr(v: unknown): string[] { return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; }

//? #170 — client-side render-to-PNG: rasterize the generated HTML card into a social-sized PNG via an
//? SVG <foreignObject> → <img> → <canvas> → blob, then download it. Fully client-side (no image provider).
//? Best-effort: an external image / cross-origin asset TAINTS the canvas so `toBlob` yields null — we notify
//? and the user falls back to Copy HTML (the owner picked client render-to-PNG knowing this limit).
const PNG_W = 1200;
const PNG_H = 630;
function downloadHtmlAsPng(html: string, onFail: () => void): void {
  //? Wrap the card in a namespaced foreignObject at social-card dimensions.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(PNG_W)}" height="${String(PNG_H)}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${String(PNG_W)}px;height:${String(PNG_H)}px;overflow:hidden;background:#ffffff">${html}</div></foreignObject></svg>`;
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const img = new Image();
  img.addEventListener('load', () => {
    const canvas = document.createElement('canvas');
    canvas.width = PNG_W; canvas.height = PNG_H;
    const cx = canvas.getContext('2d');
    if (!cx) { onFail(); return; }
    cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, PNG_W, PNG_H);
    cx.drawImage(img, 0, 0);
    //? toBlob is null when the canvas is tainted (external asset) — honest failure, not a broken file.
    canvas.toBlob((blob) => {
      if (!blob) { onFail(); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'design.png';
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  });
  img.addEventListener('error', () => { onFail(); });
  img.src = svgUrl;
}

//? ---- Artifact card ----
//? Header = icon + title + status + ONE primary action + overflow menu. Priority for the visible
//? button: Publish live (landing) > Use as brand (brand) > Send to Content; whichever loses the
//? slot stays reachable via the menu. `busy` guards Regenerate while another generation runs.
export function ArtifactCard({ artifact, busy, pendingRefine, onDelete, onRegenerate, onPromote, onSendToContent, onPublishLive }: { artifact: StudioArtifact; busy: boolean; pendingRefine: string; onDelete: () => void; onRegenerate: () => void; onPromote?: () => void; onSendToContent?: () => void; onPublishLive?: () => void }) {
  const translate = useTranslator();
  const c = asRecord(artifact.content);
  const when = new Date(artifact.createdAt).toLocaleString();
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

//? Render the artifact body by kind (avoids a nested ternary at the call site).
function ArtifactBody({ kind, c, full }: { kind: StudioArtifactKind; c: Record<string, unknown>; full: boolean }): ReactNode {
  if (kind === 'landing' || kind === 'component' || kind === 'thumbnail') return <LandingPreview html={asStr(c.html)} full={full} />;
  if (kind === 'videoScript') return <VideoScriptPreview c={c} />;
  if (kind === 'brand') return <BrandPreview c={c} />;
  if (kind === 'copy') return <CopyPreview c={c} />;
  if (kind === 'strategy') return <StrategyPreview markdown={asStr(c.markdown)} />;
  if (kind === 'email') return <EmailPreview c={c} />;
  if (kind === 'ads') return <AdsPreview c={c} />;
  if (kind === 'social') return <SocialPreview c={c} />;
  return <NamesPreview c={c} />;
}

function LandingPreview({ html, full }: { html: string; full: boolean }) {
  const translate = useTranslator();
  if (html.trim().length === 0) return <div className={`text-sm text-muted`}>{translate({ key: 'workspaces.studio.empty' })}</div>;
  return (
    <div className={`rounded-xl border border-container1-border overflow-hidden bg-white max-w-full ${full ? 'h-[70vh]' : 'h-96'}`}>
      {/* sandboxed: no scripts run — a safe visual preview of the generated page */}
      <iframe title="landing-preview" srcDoc={html} sandbox="" className={`w-full h-full border-0`} />
    </div>
  );
}

function BrandPreview({ c }: { c: Record<string, unknown> }) {
  const translate = useTranslator();
  const palette = Array.isArray(c.palette) ? c.palette.map((x) => asRecord(x)) : [];
  const typo = asRecord(c.typography);
  const taglines = asStrArr(c.taglines);
  const logoIdeas = asStrArr(c.logoIdeas);
  return (
    <div className={`flex flex-col gap-4`}>
      {palette.length > 0 && (
        <div>
          <div className={`text-xs text-muted mb-1.5`}>{translate({ key: 'workspaces.studio.palette' })}</div>
          <div className={`flex flex-wrap gap-2`}>
            {palette.map((p, i) => (
              <div key={`${asStr(p.hex)}-${String(i)}`} className={`flex flex-col items-center gap-1`}>
                <div className={`w-14 h-14 rounded-lg border border-container1-border`} style={{ backgroundColor: asStr(p.hex) }} />
                <span className={`text-[11px] text-muted`}>{asStr(p.name)}</span>
                <span className={`text-[10px] text-meta font-mono`}>{asStr(p.hex)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {(asStr(typo.heading) || asStr(typo.body)) && (
        <div className={`text-sm text-common`}><span className={`text-muted`}>{translate({ key: 'workspaces.studio.typography' })}: </span>{asStr(typo.heading)} / {asStr(typo.body)}</div>
      )}
      {asStr(c.voice) && <div className={`text-sm text-common`}><span className={`text-muted`}>{translate({ key: 'workspaces.studio.voice' })}: </span>{asStr(c.voice)}</div>}
      {taglines.length > 0 && <div><div className={`text-xs text-muted mb-1`}>{translate({ key: 'workspaces.studio.taglines' })}</div><ul className={`list-disc list-inside text-sm text-common`}>{taglines.map((t, i) => <li key={`${t.slice(0, 12)}-${String(i)}`}>{t}</li>)}</ul></div>}
      {logoIdeas.length > 0 && <div><div className={`text-xs text-muted mb-1`}>{translate({ key: 'workspaces.studio.logoIdeas' })}</div><ul className={`list-disc list-inside text-sm text-common`}>{logoIdeas.map((t, i) => <li key={`${t.slice(0, 12)}-${String(i)}`}>{t}</li>)}</ul></div>}
    </div>
  );
}

function CopyPreview({ c }: { c: Record<string, unknown> }) {
  const sections = Array.isArray(c.sections) ? c.sections.map((x) => asRecord(x)) : [];
  if (sections.length === 0) return <div className={`text-sm text-muted`}>—</div>;
  return (
    <div className={`grid md:grid-cols-2 gap-4`}>
      {sections.map((s, i) => (
        <div key={`${asStr(s.channel)}-${String(i)}`} className={`rounded-xl border border-container1-border bg-container2/30 p-3`}>
          <div className={`text-sm font-medium text-title mb-1.5`}>{asStr(s.channel)}</div>
          <ul className={`flex flex-col gap-1.5`}>{asStrArr(s.items).map((it, j) => <li key={`${it.slice(0, 12)}-${String(j)}`} className={`text-sm text-common`}>{it}</li>)}</ul>
        </div>
      ))}
    </div>
  );
}

function EmailPreview({ c }: { c: Record<string, unknown> }) {
  const emails = Array.isArray(c.emails) ? c.emails.map((x) => asRecord(x)) : [];
  if (emails.length === 0) return <div className={`text-sm text-muted`}>—</div>;
  return (
    <div className={`flex flex-col gap-3`}>
      {emails.map((e, i) => (
        <div key={`${asStr(e.subject).slice(0, 16)}-${String(i)}`} className={`rounded-xl border border-container1-border bg-container2/30 p-3`}>
          <div className={`text-sm font-medium text-title`}>{i + 1}. {asStr(e.subject)}</div>
          {asStr(e.preview) && <div className={`text-xs text-muted mt-0.5 italic`}>{asStr(e.preview)}</div>}
          <div className={`text-sm text-common mt-2 whitespace-pre-wrap`}>{asStr(e.body)}</div>
        </div>
      ))}
    </div>
  );
}

function AdsPreview({ c }: { c: Record<string, unknown> }) {
  const ads = Array.isArray(c.ads) ? c.ads.map((x) => asRecord(x)) : [];
  if (ads.length === 0) return <div className={`text-sm text-muted`}>—</div>;
  return (
    <div className={`grid md:grid-cols-2 gap-3`}>
      {ads.map((a, i) => (
        <div key={`${asStr(a.headline).slice(0, 16)}-${String(i)}`} className={`rounded-xl border border-container1-border bg-container2/30 p-3`}>
          <div className={`text-[11px] uppercase tracking-wide text-muted mb-1`}>{asStr(a.platform)}</div>
          <div className={`text-sm font-medium text-title`}>{asStr(a.headline)}</div>
          <div className={`text-sm text-common mt-1`}>{asStr(a.body)}</div>
          {asStr(a.cta) && <div className={`inline-block mt-2 rounded-md bg-primary/15 text-primary text-xs px-2 py-0.5`}>{asStr(a.cta)}</div>}
        </div>
      ))}
    </div>
  );
}

function SocialPreview({ c }: { c: Record<string, unknown> }) {
  const posts = Array.isArray(c.posts) ? c.posts.map((x) => asRecord(x)) : [];
  if (posts.length === 0) return <div className={`text-sm text-muted`}>—</div>;
  return (
    <div className={`flex flex-col gap-2`}>
      {posts.map((p, i) => (
        <div key={`${asStr(p.day).slice(0, 10)}-${String(i)}`} className={`flex gap-3 rounded-xl border border-container1-border bg-container2/30 p-3`}>
          <div className={`shrink-0 w-24 text-xs text-muted`}><div className={`font-medium text-common`}>{asStr(p.day)}</div>{asStr(p.platform)}</div>
          <div className={`min-w-0 flex-1`}><div className={`text-sm font-medium text-title`}>{asStr(p.hook)}</div><div className={`text-sm text-common mt-0.5`}>{asStr(p.body)}</div></div>
        </div>
      ))}
    </div>
  );
}

function NamesPreview({ c }: { c: Record<string, unknown> }) {
  const translate = useTranslator();
  const names = Array.isArray(c.names) ? c.names.map((x) => asRecord(x)) : [];
  const taglines = asStrArr(c.taglines);
  const domains = asStrArr(c.domains);
  return (
    <div className={`flex flex-col gap-4`}>
      {names.length > 0 && (
        <div className={`grid md:grid-cols-2 gap-2`}>
          {names.map((n, i) => (
            <div key={`${asStr(n.name).slice(0, 16)}-${String(i)}`} className={`rounded-xl border border-container1-border bg-container2/30 p-3`}>
              <div className={`text-sm font-semibold text-title`}>{asStr(n.name)}</div>
              <div className={`text-xs text-muted mt-0.5`}>{asStr(n.rationale)}</div>
            </div>
          ))}
        </div>
      )}
      {taglines.length > 0 && <div><div className={`text-xs text-muted mb-1`}>{translate({ key: 'workspaces.studio.taglines' })}</div><ul className={`list-disc list-inside text-sm text-common`}>{taglines.map((t, i) => <li key={`${t.slice(0, 12)}-${String(i)}`}>{t}</li>)}</ul></div>}
      {domains.length > 0 && <div className={`flex flex-wrap gap-1.5`}>{domains.map((d, i) => <span key={`${d}-${String(i)}`} className={`rounded-md bg-container2 text-xs text-common px-2 py-0.5 font-mono`}>{d}</span>)}</div>}
    </div>
  );
}

function VideoScriptPreview({ c }: { c: Record<string, unknown> }) {
  const translate = useTranslator();
  const scenes = Array.isArray(c.scenes) ? c.scenes.map((x) => asRecord(x)) : [];
  const hook = asStr(c.hook); const cta = asStr(c.cta);
  const dur = typeof c.durationSec === 'number' ? c.durationSec : null;
  const ctaLine = `${translate({ key: 'workspaces.studio.vsCta' })}: ${cta}`;
  if (scenes.length === 0 && hook.length === 0) return <div className={`text-sm text-muted`}>—</div>;
  return (
    <div className={`flex flex-col gap-3`}>
      {hook && <div className={`rounded-xl bg-primary/8 border border-primary-border/40 p-3`}><div className={`text-[11px] uppercase tracking-wide text-primary mb-0.5`}>{translate({ key: 'workspaces.studio.vsHook' })}</div><div className={`text-sm font-medium text-title`}>{hook}</div>{dur !== null && <div className={`text-xs text-muted mt-1`}>{translate({ key: 'workspaces.studio.vsDuration', params: [{ key: 'sec', value: String(dur) }] })}</div>}</div>}
      {scenes.map((s, i) => {
        const vo = asStr(s.voiceover); const screen = asStr(s.onScreen);
        const shotLine = typeof s.seconds === 'number' ? `${asStr(s.shot)} · ${String(s.seconds)}s` : asStr(s.shot);
        const voLine = `${translate({ key: 'workspaces.studio.vsVo' })}: ${vo}`;
        const screenLine = `${translate({ key: 'workspaces.studio.vsScreen' })}: ${screen}`;
        return (
          <div key={`${asStr(s.shot).slice(0, 12)}-${String(i)}`} className={`flex gap-3 rounded-xl border border-container1-border bg-container2/30 p-3`}>
            <div className={`shrink-0 w-7 h-7 rounded-lg bg-container2 text-muted text-sm font-semibold flex items-center justify-center`}>{i + 1}</div>
            <div className={`min-w-0 flex-1`}>
              <div className={`text-sm font-medium text-title`}>{shotLine}</div>
              {vo && <div className={`text-sm text-common mt-0.5`}>{voLine}</div>}
              {screen && <div className={`text-xs text-muted mt-0.5`}>{screenLine}</div>}
            </div>
          </div>
        );
      })}
      {cta && <div className={`text-sm text-title`}>{ctaLine}</div>}
      <div className={`text-xs text-muted flex items-center gap-1.5 rounded-lg bg-container2/40 p-2`}><Icon name="circle-info" className={`text-primary`} />{translate({ key: 'workspaces.studio.vsNote' })}</div>
    </div>
  );
}

function StrategyPreview({ markdown }: { markdown: string }) {
  const translate = useTranslator();
  if (markdown.trim().length === 0) return <div className={`text-sm text-muted`}>{translate({ key: 'workspaces.studio.empty' })}</div>;
  //? Minimal, safe markdown render — headings + bullets + paragraphs, no HTML injection.
  return <div className={`text-sm text-common leading-relaxed`}>{markdown.split('\n').map((line, i) => renderMdLine(line, i))}</div>;
}

function renderMdLine(line: string, key: number): ReactNode {
  const t = line.trim();
  if (t.length === 0) return <div key={key} className={`h-2`} />;
  if (t.startsWith('### ')) return <div key={key} className={`text-sm font-semibold text-title mt-2`}>{t.slice(4)}</div>;
  if (t.startsWith('## ')) return <div key={key} className={`text-base font-semibold text-title mt-3`}>{t.slice(3)}</div>;
  if (t.startsWith('# ')) return <div key={key} className={`text-lg font-semibold text-title mt-3`}>{t.slice(2)}</div>;
  if (t.startsWith('- ') || t.startsWith('* ')) return <div key={key} className={`flex gap-2 pl-2`}><span className={`text-muted`}>•</span><span>{stripInline(t.slice(2))}</span></div>;
  return <div key={key}>{stripInline(t)}</div>;
}
//? strip **bold**/`code` markers for a plain readable render (no dangerouslySetInnerHTML).
function stripInline(s: string): string { return s.replaceAll(/\*\*(.+?)\*\*/g, '$1').replaceAll(/`(.+?)`/g, '$1'); }
