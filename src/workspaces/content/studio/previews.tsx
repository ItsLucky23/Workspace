//? Studio — per-kind artifact preview renderers. `ArtifactBody` is the single entry point; every
//? sub-preview stays module-private. All previews read the AI-generated `unknown` content through
//? the defensive readers in ./content (no casts).

import { useState, type ReactNode } from 'react';

import { useTranslator } from '@luckystack/core/client';

import Icon from '../../_components/Icon';
import { asRecord, asStr, asStrArr } from './content';
import { stripInline } from '../../_components/MarkdownView';
import type { StudioArtifactKind } from '../../_data/types';

//? Render the artifact body by kind (avoids a nested ternary at the call site). `full` makes the HTML
//? preview's expand CONTROLLED (the marketing card toggles it from its overflow menu); omitted, the
//? preview owns its own corner toggle.
export function ArtifactBody({ kind, c, full }: { kind: StudioArtifactKind; c: Record<string, unknown>; full?: boolean }): ReactNode {
  if (kind === 'landing' || kind === 'component' || kind === 'thumbnail') return <LandingPreview html={asStr(c.html)} {...(full === undefined ? {} : { full })} />;
  if (kind === 'videoScript') return <VideoScriptPreview c={c} />;
  if (kind === 'brand') return <BrandPreview c={c} />;
  if (kind === 'copy') return <CopyPreview c={c} />;
  if (kind === 'strategy') return <StrategyPreview markdown={asStr(c.markdown)} />;
  if (kind === 'email') return <EmailPreview c={c} />;
  if (kind === 'ads') return <AdsPreview c={c} />;
  if (kind === 'social') return <SocialPreview c={c} />;
  return <NamesPreview c={c} />;
}

function LandingPreview({ html, full: controlled }: { html: string; full?: boolean }) {
  const translate = useTranslator();
  const [ownFull, setFull] = useState(false);
  const full = controlled ?? ownFull;
  if (html.trim().length === 0) return <div className={`text-sm text-muted`}>{translate({ key: 'workspaces.studio.empty' })}</div>;
  return (
    <div className={`relative rounded-xl border border-container1-border overflow-hidden bg-white max-w-full ${full ? 'h-[70vh]' : 'h-96'}`}>
      {/* sandboxed: no scripts run — a safe visual preview of the generated page */}
      <iframe title="landing-preview" srcDoc={html} sandbox="" className={`w-full h-full border-0`} />
      {/* expand/collapse lives as a single corner icon button — Copy HTML / Download PNG moved to the card's overflow menu */}
      {controlled === undefined && <button
        type="button" onClick={() => { setFull((v) => !v); }}
        title={translate({ key: full ? 'workspaces.studio.collapse' : 'workspaces.studio.expand' })}
        aria-label={translate({ key: full ? 'workspaces.studio.collapse' : 'workspaces.studio.expand' })}
        className={`absolute top-2 right-2 w-8 h-8 rounded-lg border border-container1-border bg-container1/90 text-common hover:text-title shadow-sm flex items-center justify-center cursor-pointer transition-colors`}
      >
        <Icon name={full ? 'xmark' : 'up-right-from-square'} className={`text-xs`} />
      </button>}
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
                <span className={`text-[10px] text-disabled font-mono`}>{asStr(p.hex)}</span>
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
      <div className={`text-xs text-muted flex items-center gap-1.5 rounded-lg bg-container2/40 p-2`}><Icon name="circle-question" className={`text-primary`} />{translate({ key: 'workspaces.studio.vsNote' })}</div>
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
