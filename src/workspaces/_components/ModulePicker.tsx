//? Workspaces — module picker. A set of toggle-cards for the three shippable modules
//? (Development / Content / Design, _data/modules.ts). Used at workspace creation
//? (Onboarding + CreateWorkspaceForm) and reused as the settings toggle grid. Presets
//? only — the resolved section-id list is what gets persisted.

import { useTranslator } from '@luckystack/core/client';

import { WORKSPACE_MODULES, type WorkspaceModuleId } from '../_data/modules';
import Icon from './Icon';

export function ModulePicker({ selected, onToggle }: { selected: WorkspaceModuleId[]; onToggle: (id: WorkspaceModuleId) => void }) {
  const translate = useTranslator();
  return (
    <div className="flex flex-col gap-2">
      {WORKSPACE_MODULES.map((m) => {
        const on = selected.includes(m.id);
        return (
          <button
            key={m.id} type="button" onClick={() => { onToggle(m.id); }}
            //? role=switch + aria-checked: it IS a two-state control, it just does not look like the
            //? Toggle primitive. Without this a screen reader announces a plain button with no state,
            //? and an e2e check cannot tell an enabled module from a disabled one either.
            role="switch" aria-checked={on}
            data-testid={`ws-module-${m.id}`}
            className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-colors cursor-pointer ${on ? 'border-primary bg-primary/5' : 'border-container1-border bg-container2/40 hover:bg-container2'}`}
          >
            <span className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${on ? 'bg-primary text-title-primary' : 'bg-container2 text-muted'}`}><Icon name={m.icon} /></span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-title">{translate({ key: m.labelKey })}</div>
              <div className="text-xs text-muted">{translate({ key: m.descKey })}</div>
            </div>
            <span className={`mt-1 w-4 h-4 rounded-md border flex items-center justify-center shrink-0 ${on ? 'bg-primary border-primary text-title-primary' : 'border-container1-border'}`}>{on && <Icon name="check" className="text-[10px]" />}</span>
          </button>
        );
      })}
    </div>
  );
}
