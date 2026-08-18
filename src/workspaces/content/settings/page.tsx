//? intent: the Content module's setup & settings home, KISS-shaped — teach the AI your brand first (the
//? page's primary action: the persistent brand context + logo folded into every generation), then three
//? tabs: Brand & styles / Channels & publishing / Admin (provider keys, media €-budget, app credentials —
//? role-gated, fail-open). Keys stay write-only; every save is a control-op (the Conductor writes, B-23).

import { useTranslator } from '@luckystack/core/client';

import Icon from '../../_components/Icon';
import { Disclosure, Tabs, type TabDef } from '../../_components/primitives';
import { useTrailSegment } from '../../_components/sections';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import { AdminTab } from './AdminTab';
import { BrandStylesTab } from './BrandStylesTab';
import { ChannelsTab } from './ChannelsTab';

export const template = 'workspaces';

export default function ContentSettings() {
  const translate = useTranslator();
  const { activeWorkspace, navigate } = useWorkspaces();
  //? Role gate — deliberately fail-open: only an explicit 'member' hides the Admin tab (an unresolved role keeps it).
  const showAdmin = activeWorkspace.role !== 'member';
  //? ADR 0312 — the tab is the URL (`/workspaces/content/settings/channels`), so a "fix it" deep-link
  //? from a blocked feature is an address. Validated against the tabs this user can actually see, which
  //? subsumes the old admin-gate fallback.
  const visibleTabIds = ['brand', 'channels', ...(showAdmin ? ['admin'] : [])];
  const [active, setTab] = useTrailSegment(0, visibleTabIds, 'brand');
  //? First-run banner: the full guided card until the brand context (the page's primary action) is saved,
  //? then collapsed to a one-line disclosure so the guide + cost warning stay one tap away.
  const setupDone = (activeWorkspace.productContext ?? '').trim().length > 0;
  const tabs: TabDef[] = [
    { id: 'brand', label: translate({ key: 'workspaces.content.tabBrand' }), icon: 'wand-magic-sparkles' },
    { id: 'channels', label: translate({ key: 'workspaces.content.tabChannels' }), icon: 'paper-plane' },
    ...(showAdmin ? [{ id: 'admin', label: translate({ key: 'workspaces.content.tabAdmin' }), icon: 'sliders' }] : []),
  ];
  return (
    <div className={`flex flex-col h-full min-h-0`}>
      <div className={`px-4 md:px-6 py-3 md:py-4 flex items-center gap-3`}>
        <button type="button" onClick={() => { navigate('content'); }} title={translate({ key: 'workspaces.content.backToBoard' })} className={`w-8 h-8 rounded-lg hover:bg-container2 text-muted hover:text-common flex items-center justify-center cursor-pointer shrink-0`}>
          <Icon name="arrow-left" />
        </button>
        <div className={`min-w-0`}>
          <h1 className={`text-xl font-semibold text-title`}>{translate({ key: 'workspaces.content.settingsTitle' })}</h1>
          <span className={`text-sm text-muted`}>{translate({ key: 'workspaces.content.settingsIntro' })}</span>
        </div>
      </div>

      <div className={`flex-1 min-h-0 overflow-y-auto px-4 md:px-6 pb-8`}>
        <div className={`flex flex-col gap-4 max-w-2xl`}>
          {/* First-run setup flow — the guided path + the guide link + a money warning. */}
          {setupDone
            ? (
              <Disclosure summary={<span className={`flex items-center gap-2`}><Icon name="wand-magic-sparkles" className={`text-muted`} /> {translate({ key: 'workspaces.content.setupTitle' })}</span>}>
                <div className={`text-sm text-muted`}>{translate({ key: 'workspaces.content.setupDesc' })}</div>
                <div className={`mt-2 text-sm text-primary font-medium`}>{translate({ key: 'workspaces.content.setupGuideLink' })}</div>
                <div className={`mt-2 flex items-start gap-2 text-xs text-muted`}>
                  <Icon name="triangle-exclamation" className={`text-warning mt-0.5`} /> {translate({ key: 'workspaces.content.costWarning' })}
                </div>
              </Disclosure>
            )
            : (
              <section className={`rounded-2xl border border-primary-border bg-primary/5 p-5`}>
                <div className={`flex items-start gap-3`}>
                  <span className={`w-9 h-9 rounded-lg bg-primary text-title-primary flex items-center justify-center shrink-0`}><Icon name="wand-magic-sparkles" /></span>
                  <div>
                    <div className={`text-base font-semibold text-title`}>{translate({ key: 'workspaces.content.setupTitle' })}</div>
                    <div className={`text-sm text-muted mt-0.5`}>{translate({ key: 'workspaces.content.setupDesc' })}</div>
                    <div className={`mt-2 text-sm text-primary font-medium`}>{translate({ key: 'workspaces.content.setupGuideLink' })}</div>
                    <div className={`mt-2 flex items-start gap-2 text-xs text-muted`}>
                      <Icon name="triangle-exclamation" className={`text-warning mt-0.5`} /> {translate({ key: 'workspaces.content.costWarning' })}
                    </div>
                  </div>
                </div>
              </section>
            )}

          <Tabs tabs={tabs} active={active} onChange={setTab} />

          {/* Tab bodies stay MOUNTED (hidden, not unmounted) so drafts survive a tab switch — the old
              single-column page kept all state alive; this preserves that while showing one group at a time. */}
          <div className={active === 'brand' ? `` : `hidden`}><BrandStylesTab /></div>
          <div className={active === 'channels' ? `` : `hidden`}><ChannelsTab /></div>
          {showAdmin && <div className={active === 'admin' ? `` : `hidden`}><AdminTab /></div>}
        </div>
      </div>
    </div>
  );
}
