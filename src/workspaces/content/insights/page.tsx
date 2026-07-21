//? intent: content insights — a tabbed KISS dashboard: Performance (pieces made/done/published + AI cost),
//? Links & A/B (create trackable short links, watch clicks, spot the A/B winner), and Brand voice (the
//? per-channel brand editor that feeds brand-RAG, with the read-only style library behind a disclosure).

import { useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import Icon from '../../_components/Icon';
import { Disclosure, EmptyState, Segmented, WsButton } from '../../_components/primitives';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import type { ContentChannelSummary } from '../../_data/types';

export const template = 'workspaces';

type InsightsTab = 'performance' | 'links' | 'brand';

const euros = (cents: number): string => `€${(cents / 100).toFixed(2)}`;
//? URL-path prefix rendered verbatim (shortlinks) — a code-value, not prose; const keeps it
//? out of jsx-no-literals territory without a fake translation.
const SHORTLINK_PREFIX = '/l/';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={`rounded-2xl border border-container1-border bg-container1 p-4`}>
      <div className={`text-xs text-muted`}>{label}</div>
      <div className={`text-2xl font-semibold text-title mt-1 tabular-nums`}>{value}</div>
    </div>
  );
}

function BrandCard({ channel, onSave }: { channel: ContentChannelSummary; onSave: (voice: string) => void }) {
  const translate = useTranslator();
  const [voice, setVoice] = useState(channel.brandVoice);
  const [saved, setSaved] = useState(false);
  return (
    <div className={`rounded-xl border border-container2-border bg-container2 p-3 flex flex-col gap-2`}>
      <div className={`flex items-center gap-2`}>
        <span className={`text-sm font-medium text-title`}>{channel.name}</span>
        <span className={`rounded-full bg-container1 px-2 py-0.5 text-[11px] text-muted capitalize`}>{channel.platform}</span>
      </div>
      <textarea
        value={voice} onChange={(e) => { setVoice(e.target.value); setSaved(false); }} rows={2}
        placeholder={translate({ key: 'workspaces.content.brandVoicePlaceholder' })}
        className={`rounded-lg border border-container1-border bg-container1 px-3 py-2 text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring resize-none`}
      />
      <div className={`flex items-center gap-2`}>
        <button type="button" onClick={() => { onSave(voice.trim()); setSaved(true); }} className={`rounded-lg bg-primary text-title-primary px-3 py-1.5 text-sm font-medium hover:bg-primary-hover cursor-pointer`}>{translate({ key: 'workspaces.content.brandSave' })}</button>
        {saved && <span className={`text-xs text-correct flex items-center gap-1`}><Icon name="circle-check" /> {translate({ key: 'workspaces.content.brandSaved' })}</span>}
      </div>
    </div>
  );
}

export default function ContentInsights() {
  const { content, editChannelBrand, navigate, runContentOp } = useWorkspaces();
  const translate = useTranslator();
  const [tab, setTab] = useState<InsightsTab>('performance');
  //? shortlink-create (was UI-less): create a trackable /l/<slug> link from a target URL.
  const [linkUrl, setLinkUrl] = useState('');
  const a = content.analytics;
  const maxStage = Math.max(1, ...a.byStage.map((s) => s.count));
  //? The snapshot returns links clicks-desc, so [0] is the A/B winner (only crowned once it has clicks).
  //? Sum without reduce (lint).
  const winnerId = content.shortLinks[0]?.id;
  let totalClicks = 0;
  for (const l of content.shortLinks) totalClicks += l.clicks;
  const validUrl = /^https?:\/\//.test(linkUrl.trim());

  return (
    <div className={`flex flex-col h-full min-h-0`}>
      <div className={`px-4 md:px-6 py-3 md:py-4 flex items-center gap-3`}>
        <button type="button" onClick={() => { navigate('content'); }} title={translate({ key: 'workspaces.content.backToBoard' })} className={`w-8 h-8 rounded-lg hover:bg-container2 text-muted hover:text-common flex items-center justify-center cursor-pointer`}>
          <Icon name="arrow-left" />
        </button>
        <div>
          <h1 className={`text-xl font-semibold text-title`}>{translate({ key: 'workspaces.content.insightsTitle' })}</h1>
          <span className={`text-sm text-muted`}>{translate({ key: 'workspaces.content.insightsSubtitle' })}</span>
        </div>
      </div>

      <div className={`flex-1 min-h-0 overflow-y-auto px-4 md:px-6 pb-8`}>
        <div className={`flex flex-col gap-4 max-w-4xl`}>
          {/* The at-a-glance answer to "how am I doing" — always visible, whatever the tab. */}
          <div className={`grid grid-cols-2 sm:grid-cols-4 gap-3`}>
            <Stat label={translate({ key: 'workspaces.content.anTotalPieces' })} value={String(a.totalPieces)} />
            <Stat label={translate({ key: 'workspaces.content.anDone' })} value={String(a.doneCount)} />
            <Stat label={translate({ key: 'workspaces.content.anPublished' })} value={String(a.publishedCount)} />
            <Stat label={translate({ key: 'workspaces.content.anCost' })} value={euros(a.totalCostCents)} />
          </div>

          {/* One topic on screen at a time — the strip scrolls in its own container on narrow screens. */}
          <div className={`overflow-x-auto ws-no-scrollbar`}>
            <Segmented<InsightsTab>
              value={tab} onChange={setTab}
              options={[
                { id: 'performance', label: translate({ key: 'workspaces.content.insightsTabPerformance' }) },
                { id: 'links', label: translate({ key: 'workspaces.content.insightsTabLinks' }) },
                { id: 'brand', label: translate({ key: 'workspaces.content.brandTitle' }) },
              ]}
            />
          </div>

          {/* ------------------------------------------------ Performance (default) */}
          {tab === 'performance' && (a.totalPieces === 0 ? (
            <div className={`rounded-2xl border border-container1-border bg-container1`}>
              <EmptyState
                icon="chart-column"
                title={translate({ key: 'workspaces.content.perfEmptyTitle' })}
                sub={translate({ key: 'workspaces.content.perfEmptySub' })}
                action={<WsButton icon="arrow-left" onClick={() => { navigate('content'); }}>{translate({ key: 'workspaces.content.backToBoard' })}</WsButton>}
              />
            </div>
          ) : (
            <>
              <section className={`rounded-2xl border border-container1-border bg-container1 p-5`}>
                <div className={`text-base font-semibold text-title mb-3`}>{translate({ key: 'workspaces.content.anByStage' })}</div>
                {a.byStage.length === 0 ? <div className={`text-sm text-disabled`}>—</div> : (
                  <div className={`flex flex-col gap-2`}>
                    {a.byStage.map((s) => (
                      <div key={s.stage} className={`flex items-center gap-2 text-sm`}>
                        <span className={`w-24 shrink-0 text-muted capitalize truncate`}>{s.stage}</span>
                        <div className={`flex-1 h-3 rounded-full bg-container2 overflow-hidden`}><div className={`h-full rounded-full bg-primary/70`} style={{ width: `${String(Math.round((s.count / maxStage) * 100))}%` }} /></div>
                        <span className={`w-6 text-right tabular-nums text-muted`}>{s.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className={`rounded-2xl border border-container1-border bg-container1 p-5`}>
                <div className={`text-base font-semibold text-title mb-3`}>{translate({ key: 'workspaces.content.anCostByFeature' })}</div>
                {a.costByFeature.length === 0 ? <div className={`text-sm text-disabled`}>—</div> : (
                  <div className={`flex flex-col gap-1`}>
                    {a.costByFeature.map((c) => (
                      <div key={c.feature} className={`flex items-center justify-between gap-2 text-sm border-b border-divider last:border-0 py-1.5`}>
                        <span className={`text-title capitalize`}>{c.feature}</span>
                        <span className={`text-muted font-mono tabular-nums`}>{euros(c.cents)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          ))}

          {/* ------------------------------------------------ Links & A/B */}
          {tab === 'links' && (
            <section className={`rounded-2xl border border-container1-border bg-container1 p-5`}>
              <div className={`flex items-center justify-between mb-3`}>
                <div className={`text-base font-semibold text-title`}>{translate({ key: 'workspaces.content.linksTitle' })}</div>
                {content.shortLinks.length > 0 && <span className={`text-xs text-muted`}>{translate({ key: 'workspaces.content.linksTotalClicks', params: [{ key: 'n', value: totalClicks }] })}</span>}
              </div>
              {/* The tab's primary action: create a trackable short link (shortlink-create, a control-API op). */}
              <div className={`flex items-center gap-2 mb-3`}>
                <input value={linkUrl} onChange={(e) => { setLinkUrl(e.target.value); }} placeholder={translate({ key: 'workspaces.content.linkUrlPlaceholder' })} className={`flex-1 min-w-0 rounded-lg border border-container2-border bg-container2 px-3 py-2 text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring`} />
                <WsButton icon="link" disabled={!validUrl} className={`shrink-0`} onClick={() => { runContentOp('shortlink-create', '', { targetUrl: linkUrl.trim() }); setLinkUrl(''); }}>{translate({ key: 'workspaces.content.linkCreate' })}</WsButton>
              </div>
              {content.shortLinks.length === 0 ? (
                <EmptyState
                  icon="link"
                  title={translate({ key: 'workspaces.content.linksEmptyTitle' })}
                  sub={translate({ key: 'workspaces.content.linksEmptySub' })}
                />
              ) : (
                <div className={`flex flex-col gap-1`}>
                  {content.shortLinks.map((l) => (
                    //? Phone: the row wraps to two lines (slug/badges/clicks on top, URL below). sm+: one line
                    //? where the URL is the ONLY truncating flex-1 element, so nothing forces horizontal scroll.
                    <div key={l.id} className={`flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-0.5 text-sm border-b border-divider last:border-0 py-1.5 ${l.id === winnerId && l.clicks > 0 ? 'text-title' : 'text-common'}`}>
                      <span className={`font-mono text-xs text-primary shrink-0`}>{SHORTLINK_PREFIX}{l.slug}</span>
                      {l.variant && <span className={`rounded-md bg-container2 px-1.5 py-0.5 text-[10px] font-semibold text-muted shrink-0`}>{l.variant}</span>}
                      {l.id === winnerId && l.clicks > 0 && <span className={`rounded-md bg-correct/15 text-correct px-1.5 py-0.5 text-[10px] font-semibold shrink-0`}><Icon name="trophy" /> {translate({ key: 'workspaces.content.linksWinner' })}</span>}
                      <span className={`order-last sm:order-none basis-full sm:basis-0 sm:flex-1 min-w-0 truncate text-muted`}>{l.targetUrl}</span>
                      <span className={`ml-auto sm:ml-0 font-mono tabular-nums shrink-0`}>{l.clicks}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* ------------------------------------------------ Brand voice */}
          {tab === 'brand' && (
            <>
              <section className={`rounded-2xl border border-container1-border bg-container1 p-5`}>
                <div className={`text-sm text-muted mb-3`}>{translate({ key: 'workspaces.content.brandDesc' })}</div>
                {content.channels.length === 0 ? (
                  <EmptyState
                    icon="wand-magic-sparkles"
                    title={translate({ key: 'workspaces.content.brandEmpty' })}
                    sub={translate({ key: 'workspaces.content.brandEmptySub' })}
                  />
                ) : (
                  <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3`}>
                    {content.channels.map((c) => (
                      <BrandCard key={c.id} channel={c} onSave={(voice) => { editChannelBrand(c.id, voice); }} />
                    ))}
                  </div>
                )}
              </section>

              {/* Read-only reference material — one tap away, collapsed by default. */}
              <Disclosure summary={translate({ key: 'workspaces.content.stylesTitle' })}>
                <div className={`text-sm text-muted mb-3`}>{translate({ key: 'workspaces.content.stylesDesc' })}</div>
                {content.styles.length === 0 ? <div className={`text-sm text-disabled`}>{translate({ key: 'workspaces.content.stylesEmpty' })}</div> : (
                  <div className={`flex flex-wrap gap-2`}>
                    {content.styles.map((s) => (
                      <div key={`${s.feature}:${s.key}`} className={`flex items-center gap-2 rounded-lg border border-container2-border bg-container2 px-2.5 py-1.5`}>
                        <span className={`text-sm text-title`}>{s.label}</span>
                        <span className={`rounded-full px-1.5 text-[10px] ${s.builtin ? 'bg-container1 text-muted' : 'bg-primary/15 text-primary'}`}>{translate({ key: s.builtin ? 'workspaces.content.styleBuiltin' : 'workspaces.content.styleCustom' })}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Disclosure>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
