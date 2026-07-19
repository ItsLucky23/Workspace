//? J1 — the board's teaching empty state: a first-steps banner for a fresh
//? workspace (zero tickets). Names the 3 things a novice does first — connect a
//? repo, create a ticket, ask the AI — with "create your first ticket" as the
//? DOMINANT CTA (it is the page's primary action). Dismiss is LOCAL state only:
//? the banner reappears on reload while the ticket count stays 0 (deliberate).

import { useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import Icon, { type IconName } from '../../_components/Icon';
import { WsButton } from '../../_components/primitives';
import { useWorkspaces } from '../../_shell/WorkspacesContext';

export function OnboardingBanner() {
  const translate = useTranslator();
  const { quickAdd, navigate, toggleAi } = useWorkspaces();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  const steps: { icon: IconName; text: string; action: () => void; cta: string; primary?: boolean }[] = [
    { icon: 'link', text: translate({ key: 'workspaces.firstSteps.step1' }), action: () => { navigate('settings'); }, cta: translate({ key: 'workspaces.firstSteps.step1Cta' }) },
    { icon: 'plus', text: translate({ key: 'workspaces.firstSteps.step2' }), action: () => { quickAdd({ title: translate({ key: 'workspaces.firstSteps.firstTicket' }) }); }, cta: translate({ key: 'workspaces.firstSteps.step2Cta' }), primary: true },
    { icon: 'robot', text: translate({ key: 'workspaces.firstSteps.step3' }), action: () => { toggleAi(); }, cta: translate({ key: 'workspaces.firstSteps.step3Cta' }) },
  ];
  return (
    <div className={`mx-4 md:mx-6 mb-3 rounded-2xl border border-primary-border bg-primary/8 p-4`}>
      <div className={`flex items-center justify-between gap-2 mb-3`}>
        <div className={`text-sm font-semibold text-title`}>{translate({ key: 'workspaces.firstSteps.title' })}</div>
        <button type="button" onClick={() => { setDismissed(true); }} className={`text-muted hover:text-title cursor-pointer text-xs`}>{translate({ key: 'workspaces.firstSteps.dismiss' })}</button>
      </div>
      <div className={`grid grid-cols-1 sm:grid-cols-3 gap-3`}>
        {steps.map((s, i) => (
          <div key={s.cta} className={`rounded-xl border border-container2-border bg-container1 p-3 flex flex-col gap-2`}>
            <div className={`flex items-center gap-2 text-sm text-title`}><span className={`w-5 h-5 rounded-full bg-primary/15 text-primary text-[11px] font-semibold flex items-center justify-center shrink-0`}>{i + 1}</span><Icon name={s.icon} className={`text-muted`} /></div>
            <div className={`text-xs text-common`}>{s.text}</div>
            {s.primary
              ? <WsButton icon="plus" onClick={s.action} className={`self-start`}>{s.cta}</WsButton>
              : <button type="button" onClick={s.action} className={`self-start inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline cursor-pointer`}>{s.cta}<Icon name="arrow-right" /></button>}
          </div>
        ))}
      </div>
    </div>
  );
}
