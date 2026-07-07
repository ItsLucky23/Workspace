//? S3 — guided first-run setup: a short stepper that connects a media provider key + sets a spend budget, so a
//? new user reaches a working state without hunting through the settings forms. Each step fires the SAME
//? single-writer control-op as the settings UI (saveMediaProvider / editMediaBudget) — the wizard is just a
//? friendlier front door, never a new writer. The natural-language "let the Assistant configure it" path is a
//? follow-up on top of this (the Assistant proposes the same ops). Browser-verified; the ops are tested.

import { useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import { useWorkspaces } from '../_shell/WorkspacesContext';
import Icon from './Icon';
import { WsButton } from './primitives';

const fieldCls = 'h-10 px-3 rounded-lg border border-container1-border bg-container1 text-sm text-title placeholder:text-disabled focus:outline-none focus:border-primary w-full';

export default function SetupWizard({ onClose }: { onClose: () => void }) {
  const translate = useTranslator();
  const { saveMediaProvider, editMediaBudget } = useWorkspaces();
  const [step, setStep] = useState(0);
  const [apiKey, setApiKey] = useState('');
  const [budgetEuro, setBudgetEuro] = useState('25');

  const steps = 3;
  const next = () => {
    if (step === 1 && apiKey.trim()) saveMediaProvider({ providerId: 'fal', apiKey: apiKey.trim() });
    if (step === 2) {
      const cents = Math.max(0, Math.round(Number(budgetEuro) * 100));
      if (cents > 0) editMediaBudget({ capCents: cents, enabled: true });
    }
    if (step >= steps - 1) { onClose(); return; }
    setStep((s) => s + 1);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4" onClick={onClose}>
      <div className="rounded-2xl border border-container1-border bg-background p-5 max-w-md w-full flex flex-col gap-4" onClick={(e) => { e.stopPropagation(); }}>
        <div className="flex items-center justify-between">
          <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.setup.title' })}</div>
          <button type="button" onClick={onClose} className="text-muted hover:text-title cursor-pointer"><Icon name="xmark" /></button>
        </div>

        {/* progress dots */}
        <div className="flex items-center gap-1.5">
          {Array.from({ length: steps }, (_, i) => (
            <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= step ? 'bg-primary' : 'bg-container2-border'}`} />
          ))}
        </div>

        {step === 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-sm font-semibold text-title">{translate({ key: 'workspaces.setup.welcomeTitle' })}</div>
            <div className="text-sm text-muted">{translate({ key: 'workspaces.setup.welcomeBody' })}</div>
          </div>
        )}
        {step === 1 && (
          <div className="flex flex-col gap-2">
            <div className="text-sm font-semibold text-title">{translate({ key: 'workspaces.setup.keyTitle' })}</div>
            <div className="text-sm text-muted">{translate({ key: 'workspaces.setup.keyBody' })}</div>
            <input value={apiKey} onChange={(e) => { setApiKey(e.target.value); }} placeholder="fal_..." className={`${fieldCls} font-mono`} />
          </div>
        )}
        {step === 2 && (
          <div className="flex flex-col gap-2">
            <div className="text-sm font-semibold text-title">{translate({ key: 'workspaces.setup.budgetTitle' })}</div>
            <div className="text-sm text-muted">{translate({ key: 'workspaces.setup.budgetBody' })}</div>
            <input value={budgetEuro} onChange={(e) => { setBudgetEuro(e.target.value); }} inputMode="decimal" placeholder="€ 25" className={fieldCls} />
          </div>
        )}

        <div className="flex items-center justify-between">
          {step > 0 ? <button type="button" onClick={() => { setStep((s) => s - 1); }} className="text-sm text-muted hover:text-common cursor-pointer">{translate({ key: 'workspaces.setup.back' })}</button> : <span />}
          <WsButton icon={step >= steps - 1 ? 'check' : 'arrow-right'} onClick={next}>{translate({ key: step >= steps - 1 ? 'workspaces.setup.finish' : 'workspaces.setup.next' })}</WsButton>
        </div>
      </div>
    </div>
  );
}
