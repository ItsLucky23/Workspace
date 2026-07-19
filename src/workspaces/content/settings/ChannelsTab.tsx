//? content/settings — Tab 2 "Channels & publishing": channels (a platform + brand identity a piece binds
//? to, A2) with the create/edit form behind ONE 'New channel' button; publishing connections (OAuth
//? accounts, #140/#146) below; the read-only channel-health board (A5) as a disclosure when present.

import { useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';
import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';

import Icon from '../../_components/Icon';
import { Disclosure, EmptyState, SectionCard, Toggle, WsButton } from '../../_components/primitives';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import { oauthCallbackBase } from '../../../../config';
import { AccountConnectForm } from './portalForms';
import { fieldCls, PUBLISH_PLATFORMS } from './shared';

//? A5 — health state → icon/colour (tokens only, Rule 14).
const HEALTH_ICON: Record<'ok' | 'warn' | 'down' | 'idle', string> = { ok: 'circle-check', warn: 'triangle-exclamation', down: 'circle-xmark', idle: 'circle-minus' };
const HEALTH_TEXT: Record<'ok' | 'warn' | 'down' | 'idle', string> = { ok: 'text-correct', warn: 'text-warning', down: 'text-wrong', idle: 'text-muted' };

//? Only YouTube + TikTok have publish builders (IG/LinkedIn record a 'platform.notBuilt' job), so they
//? are hidden from the channel platform picker until their builders land (#147 — consistent roadmap signal).
const CHANNEL_PLATFORMS = ['youtube', 'tiktok', 'none'];

//? Channel manager — create/edit/delete via the generic runContentOp (channel-* content control-ops).
function ChannelsCard() {
  const translate = useTranslator();
  const { content, runContentOp } = useWorkspaces();
  const platformItems: DropdownItem[] = CHANNEL_PLATFORMS.map((p) => ({ id: p, value: p, item: p }));
  //? #153 — the channel's default house style options (empty = no default).
  const styleItems: DropdownItem[] = [{ id: '', value: '', item: translate({ key: 'workspaces.content.channelNoStyle' }) }, ...content.styles.map((s) => ({ id: s.id, value: s.id, item: `${s.label} · ${s.feature}` }))];
  //? The create form doubles as an edit form: editing loads the row into the fields and dispatches
  //? channel-edit (a patch) instead of channel-create. Hidden until 'New channel' / an edit opens it.
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState('youtube');
  const [handle, setHandle] = useState('');
  const [brandVoice, setBrandVoice] = useState('');
  const [defaultStyleId, setDefaultStyleId] = useState('');   // #153 — the channel's house style
  //? AI-disclosure default: prefills the publish composer's synthetic-media checkbox; autopilot follows it.
  const [aiDisclosure, setAiDisclosure] = useState(false);
  //? Channel↔account-binding + autopilot: which connected account this channel posts with, and the
  //? per-channel autopilot consent (idea→render→publish without per-step approval).
  const [defaultAccountId, setDefaultAccountId] = useState('');
  const [autopilot, setAutopilot] = useState(false);
  const platformAccounts = content.publishTargets.find((t) => t.platform === platform)?.accounts ?? [];
  const accountItems: DropdownItem[] = [{ id: '', value: '', item: translate({ key: 'workspaces.content.channelDefaultAccount' }) }, ...platformAccounts.filter((a) => a.accountId !== null).map((a) => ({ id: a.accountId ?? '', value: a.accountId ?? '', item: a.accountId ?? '' }))];
  const canSave = name.trim().length > 0;
  const reset = () => { setFormOpen(false); setEditingId(null); setName(''); setHandle(''); setBrandVoice(''); setPlatform('youtube'); setDefaultStyleId(''); setAiDisclosure(false); setDefaultAccountId(''); setAutopilot(false); };
  const openNew = () => { reset(); setFormOpen(true); };
  const startEdit = (c: { id: string; name: string; platform: string; handle?: string | null; brandVoice?: string | null; defaultStyleId?: string | null; aiDisclosureDefault?: boolean; defaultAccountId?: string | null; autopilot?: boolean }): void => {
    setEditingId(c.id); setName(c.name); setPlatform(c.platform); setHandle(c.handle ?? ''); setBrandVoice(c.brandVoice ?? ''); setDefaultStyleId(c.defaultStyleId ?? ''); setAiDisclosure(c.aiDisclosureDefault ?? false); setDefaultAccountId(c.defaultAccountId ?? ''); setAutopilot(c.autopilot ?? false);
    setFormOpen(true);
  };
  //? Autopilot ON is a consent moment (it replaces every per-post approval) → an explicit confirm that
  //? also states the channel's current disclosure default.
  const toggleAutopilot = (next: boolean) => {
    if (!next) { setAutopilot(false); return; }
    void menuHandler.confirm({
      title: translate({ key: 'workspaces.content.autopilotConfirmTitle' }),
      content: translate({ key: aiDisclosure ? 'workspaces.content.autopilotConfirmBody' : 'workspaces.content.autopilotConfirmBodyNoDisclosure' }),
    }).then((ok) => { if (ok) setAutopilot(true); });
  };
  const submit = () => {
    if (!canSave) return;
    if (editingId) runContentOp('channel-edit', '', { channelId: editingId, name: name.trim(), platform, handle: handle.trim(), brandVoice: brandVoice.trim(), defaultStyleId, aiDisclosureDefault: aiDisclosure, defaultAccountId, autopilot });
    else runContentOp('channel-create', '', { name: name.trim(), platform, ...(handle.trim() ? { handle: handle.trim() } : {}), ...(brandVoice.trim() ? { brandVoice: brandVoice.trim() } : {}), aiDisclosureDefault: aiDisclosure, ...(defaultAccountId ? { defaultAccountId } : {}), autopilot });
    reset();
  };
  const removeChannel = (id: string): void => {
    void menuHandler.confirm({ title: translate({ key: 'workspaces.content.channelDelete' }), content: translate({ key: 'workspaces.content.channelDeleteConfirm' }) }).then((ok) => { if (ok) { if (editingId === id) reset(); runContentOp('channel-delete', '', { channelId: id }); } });
  };
  return (
    <SectionCard
      title={translate({ key: 'workspaces.content.channelsTitle' })}
      desc={translate({ key: 'workspaces.content.channelsDesc' })}
      right={<WsButton icon="plus" className={`min-h-11 shrink-0`} onClick={openNew}>{translate({ key: 'workspaces.content.channelNew' })}</WsButton>}
    >
      {content.channels.length === 0 && !formOpen
        ? (
          <EmptyState
            icon="paper-plane"
            title={translate({ key: 'workspaces.content.channelsEmpty' })}
            sub={translate({ key: 'workspaces.content.channelsEmptyTeach' })}
            action={<WsButton icon="plus" className={`min-h-11`} onClick={openNew}>{translate({ key: 'workspaces.content.channelNew' })}</WsButton>}
          />
        )
        : (
          <div className={`flex flex-col gap-1.5 ${formOpen ? 'mb-4' : ''}`}>
            {content.channels.map((c) => (
              <div key={c.id} className={`flex items-center gap-2 rounded-lg border border-container2-border bg-container2 px-3 py-2`}>
                <div className={`min-w-0 flex-1`}>
                  <div className={`text-sm font-medium text-title truncate`}>{c.name} <span className={`text-xs text-disabled`}>· {c.platform}{c.handle ? ` · ${c.handle}` : ''}</span>{c.autopilot && <span className={`ml-1.5 rounded-full bg-warning/15 text-warning px-1.5 py-0.5 text-[10px] font-semibold uppercase`}>{translate({ key: 'workspaces.content.autopilotBadge' })}</span>}</div>
                  {c.brandVoice ? <div className={`text-xs text-muted truncate`}>{c.brandVoice}</div> : null}
                </div>
                <button type="button" onClick={() => { startEdit(c); }} title={translate({ key: 'workspaces.content.channelEdit' })} className={`w-7 h-7 rounded-md flex items-center justify-center cursor-pointer shrink-0 ${editingId === c.id ? 'text-primary bg-primary/10' : 'text-muted hover:text-title hover:bg-container2-hover'}`}><Icon name="pen-nib" /></button>
                <button type="button" onClick={() => { removeChannel(c.id); }} title={translate({ key: 'workspaces.content.channelDelete' })} className={`w-7 h-7 rounded-md text-muted hover:text-wrong hover:bg-wrong/10 flex items-center justify-center cursor-pointer shrink-0`}><Icon name="trash" /></button>
              </div>
            ))}
          </div>
        )}
      {formOpen && (
        <div className={`rounded-xl border border-dashed border-divider p-3 flex flex-col gap-2`}>
          <div className={`flex items-center justify-between gap-2`}>
            <div className={`text-sm font-medium text-title`}>{translate({ key: editingId ? 'workspaces.content.channelEdit' : 'workspaces.content.channelNew' })}</div>
            <button type="button" onClick={reset} className={`text-xs text-muted hover:text-title cursor-pointer`}>{translate({ key: 'workspaces.shell.cancel' })}</button>
          </div>
          <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2`}>
            <input value={name} onChange={(e) => { setName(e.target.value); }} placeholder={translate({ key: 'workspaces.content.channelNamePlaceholder' })} className={fieldCls} />
            <Dropdown size="md" value={platformItems.find((i) => i.id === platform)} items={platformItems} onChange={(it) => { setPlatform(String(it.id)); }} />
          </div>
          <input value={handle} onChange={(e) => { setHandle(e.target.value); }} placeholder={translate({ key: 'workspaces.content.channelHandlePlaceholder' })} className={fieldCls} />
          <input value={brandVoice} onChange={(e) => { setBrandVoice(e.target.value); }} placeholder={translate({ key: 'workspaces.content.channelVoicePlaceholder' })} className={fieldCls} />
          {/* #153 — the channel's house style (defaultStyleId), only meaningful when editing an existing channel. */}
          {editingId && (
            <div className={`flex flex-col gap-1`}>
              <span className={`text-xs text-muted`}>{translate({ key: 'workspaces.content.channelDefaultStyle' })}</span>
              <Dropdown size="md" value={styleItems.find((i) => i.id === defaultStyleId) ?? styleItems[0]} items={styleItems} onChange={(it) => { setDefaultStyleId(String(it.id)); }} />
            </div>
          )}
          <div className={`flex items-center justify-between gap-2`}>
            <span className={`text-sm text-common`} title={translate({ key: 'workspaces.content.channelAiDisclosureHint' })}>{translate({ key: 'workspaces.content.channelAiDisclosure' })}</span>
            <Toggle on={aiDisclosure} onChange={setAiDisclosure} label={aiDisclosure ? translate({ key: 'workspaces.account.enabled' }) : translate({ key: 'workspaces.account.off' })} />
          </div>
          {accountItems.length > 1 && (
            <div className={`flex items-center justify-between gap-2`}>
              <span className={`text-sm text-common`} title={translate({ key: 'workspaces.content.channelAccountHint' })}>{translate({ key: 'workspaces.content.channelAccount' })}</span>
              <Dropdown size="sm" value={accountItems.find((i) => i.id === defaultAccountId) ?? accountItems[0]} items={accountItems} onChange={(it) => { setDefaultAccountId(String(it.id)); }} />
            </div>
          )}
          <div className={`flex items-center justify-between gap-2`}>
            <span className={`text-sm text-common`} title={translate({ key: 'workspaces.content.autopilotHint' })}>{translate({ key: 'workspaces.content.autopilotLabel' })}</span>
            <Toggle on={autopilot} onChange={toggleAutopilot} label={autopilot ? translate({ key: 'workspaces.account.enabled' }) : translate({ key: 'workspaces.account.off' })} />
          </div>
          <WsButton className={`self-start min-h-11`} disabled={!canSave} onClick={submit}>{translate({ key: 'workspaces.content.channelSave' })}</WsButton>
        </div>
      )}
    </SectionCard>
  );
}

//? Publishing connections (FIX-C) — connect an account so a finished render can be posted (B-23 gated).
function PublishingCard() {
  const translate = useTranslator();
  const { content, activeWorkspace, runContentOp } = useWorkspaces();
  //? A3/#146 — disconnect ONE connected account (confirm first — removing a credential). accountId null =
  //? the legacy default connection.
  const disconnectPlatform = (platform: string, accountId: string | null): void => {
    void menuHandler.confirm({ title: translate({ key: 'workspaces.content.publishDisconnect' }), content: translate({ key: 'workspaces.content.publishDisconnectConfirm' }) }).then((ok) => { if (ok) runContentOp('account-disconnect', '', { platform, ...(accountId ? { accountId } : {}) }); });
  };
  //? Start the OAuth connect: send the browser to the backend `start` route, which redirects to the
  //? platform's consent screen and (via the callback) stores the token, then returns here. #140 — an optional
  //? accountId opens a SEPARATE per-account connection (multi-account).
  const connectPlatform = (platform: string, accountId?: string) => {
    //? Use oauthCallbackBase (the BACKEND origin), not backendUrl (the Vite dev origin) — `/content/oauth/*`
    //? isn't in the dev proxy, and this is the host you register as the redirect URI with the provider.
    const base = `${oauthCallbackBase}/content/oauth/${platform}/start?ws=${encodeURIComponent(activeWorkspace.id)}`;
    globalThis.location.href = accountId && accountId.length > 0 ? `${base}&accountId=${encodeURIComponent(accountId)}` : base;
  };
  //? #140 — open the "connect another account" prompt (label → accountId slug); the form is injected props-only
  //? (it renders in the menu PORTAL, above WorkspacesProvider, so it must not call useWorkspaces — lesson 0011).
  const openConnectAccount = (platform: string, platformName: string) => {
    void menuHandler.open(<AccountConnectForm platformName={platformName} onConnect={(label) => { connectPlatform(platform, label); }} />, { dimBackground: true, background: 'bg-container1', size: 'sm' });
  };
  return (
    <SectionCard title={translate({ key: 'workspaces.content.publishTitle' })} desc={translate({ key: 'workspaces.content.publishDesc' })}>
      <div className={`flex flex-col gap-3`}>
        {PUBLISH_PLATFORMS.map((p) => {
          const target = content.publishTargets.find((t) => t.platform === p.id);
          const accounts = target?.accounts ?? [];
          const platformName = translate({ key: p.nameKey });
          return (
            <div key={p.id} className={`rounded-xl border border-container2-border bg-container2 px-3 py-2.5 flex flex-col gap-2`}>
              <div className={`flex items-center justify-between gap-3 flex-wrap`}>
                <span className={`text-sm font-medium text-title`}>{platformName}</span>
                {/* #140 — connect the first / another account (opens a label prompt). */}
                <button type="button" onClick={() => { openConnectAccount(p.id, platformName); }} className={`min-h-11 rounded-lg border border-primary-border bg-primary/10 text-primary px-3 py-1.5 text-sm font-medium hover:bg-primary/20 cursor-pointer flex items-center gap-1.5`}>
                  <Icon name="link" /> {translate({ key: accounts.length > 0 ? 'workspaces.content.publishConnectAnother' : 'workspaces.content.publishConnect' })}
                </button>
              </div>
              {/* #140/#146 — one row per connected account with its own disconnect. */}
              {accounts.map((acc) => (
                <div key={acc.accountId ?? '__default__'} className={`flex items-center justify-between gap-3 pl-1 flex-wrap`}>
                  {/* GAP_SCAN A4 — a dead token (refresh failed) shows a reconnect CTA instead of failing silently on the next post. */}
                  <span className={`text-xs font-medium flex items-center gap-1.5 ${acc.needsReconnect ? 'text-warning' : 'text-correct'}`}>
                    <Icon name={acc.needsReconnect ? 'triangle-exclamation' : 'circle-check'} /> {acc.accountId ?? translate({ key: 'workspaces.content.publishDefaultAccount' })}
                    {acc.needsReconnect && <span className={`text-[10px] uppercase tracking-wide rounded-full bg-warning/15 px-1.5 py-0.5`}>{translate({ key: 'workspaces.content.publishNeedsReconnect' })}</span>}
                  </span>
                  <div className={`flex items-center gap-2 shrink-0`}>
                    {acc.needsReconnect && <button type="button" onClick={() => { openConnectAccount(p.id, platformName); }} className={`text-xs text-primary hover:underline cursor-pointer`}>{translate({ key: 'workspaces.content.publishReconnect' })}</button>}
                    <button type="button" onClick={() => { disconnectPlatform(p.id, acc.accountId); }} className={`text-xs text-muted hover:text-wrong cursor-pointer`}>{translate({ key: 'workspaces.content.publishDisconnect' })}</button>
                  </div>
                </div>
              ))}
              {accounts.length === 0 && <span className={`text-xs text-muted pl-1`}>{translate({ key: 'workspaces.content.publishNoAccounts' })}</span>}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

//? GAP_SCAN A5 — per-channel publish health: one glance answers "is every channel still posting?".
//? Derived from the publish-job history + the A4 connection markers; read-only.
function HealthBody() {
  const translate = useTranslator();
  const { content } = useWorkspaces();
  return (
    <div>
      <div className={`text-sm text-muted mb-3`}>{translate({ key: 'workspaces.content.healthDesc' })}</div>
      <div className={`flex flex-col gap-2`}>
        {content.channelHealth.map((h) => (
          <div key={h.channelId} className={`rounded-xl border border-container2-border bg-container2 px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap`}>
            <div className={`flex items-center gap-2 min-w-0`}>
              <Icon name={HEALTH_ICON[h.state]} className={HEALTH_TEXT[h.state]} />
              <span className={`text-sm font-medium text-title truncate`}>{h.name}</span>
              <span className={`text-xs text-muted`}>{h.platform}</span>
            </div>
            <div className={`flex items-center gap-3 text-xs text-muted flex-wrap`}>
              <span>{translate({ key: `workspaces.content.health_${h.state}` })}</span>
              <span className={`tabular-nums`}>{translate({ key: 'workspaces.content.healthPosts' })}{': '}{String(h.posts)}</span>
              {h.failures > 0 && <span className={`tabular-nums text-wrong`}>{translate({ key: 'workspaces.content.healthFailures' })}{': '}{String(h.failures)}</span>}
              <span>{h.lastSuccessAt === null ? translate({ key: 'workspaces.content.healthNever' }) : new Date(h.lastSuccessAt).toLocaleDateString()}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChannelsTab() {
  const translate = useTranslator();
  const { content } = useWorkspaces();
  return (
    <div className={`flex flex-col gap-4`}>
      <ChannelsCard />
      <PublishingCard />
      {content.channelHealth.length > 0 && (
        <Disclosure summary={<span className={`flex items-center gap-2`}>{translate({ key: 'workspaces.content.healthTitle' })} <span className={`text-xs text-muted font-normal`}>{String(content.channelHealth.length)}</span></span>}>
          <HealthBody />
        </Disclosure>
      )}
    </div>
  );
}
