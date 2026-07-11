//? J3 (novice-proof) — the glossary: plain-language definitions of the app's core terms, so a non-technical
//? user isn't blocked by jargon. Opened as a modal from the shell help affordance (menuHandler.open). Terms +
//? definitions are i18n keys (`workspaces.glossary.<term>` / `<term>Def`), so they translate with the app.

import { useTranslator } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';

import Icon from './Icon';
import { WsButton } from './primitives';

//? The core terms, in reading order (concept → workflow → output). Each renders a term + its definition.
const TERMS = ['workspace', 'module', 'ticket', 'pipeline', 'stage', 'mr', 'environment', 'piece', 'shortlink'] as const;

export function Glossary() {
  const translate = useTranslator();
  return (
    <div className="w-full flex flex-col gap-3 p-5 max-h-[80vh] overflow-y-auto">
      <div className="flex items-center gap-2">
        <Icon name="book-open" className="text-primary" />
        <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.glossary.title' })}</div>
      </div>
      <div className="text-sm text-muted">{translate({ key: 'workspaces.glossary.intro' })}</div>
      <div className="flex flex-col divide-y divide-divider">
        {TERMS.map((t) => (
          <div key={t} className="py-2.5">
            <div className="text-sm font-semibold text-title">{translate({ key: `workspaces.glossary.${t}` })}</div>
            <div className="text-sm text-common mt-0.5">{translate({ key: `workspaces.glossary.${t}Def` })}</div>
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <WsButton variant="ghost" onClick={() => void menuHandler.close()}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>
      </div>
    </div>
  );
}
