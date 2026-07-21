//? intent: Components — the live reference gallery of every UI component the product ships, rendered under
//? a selectable design theme. A DEV component-library reference (moved out of the Designer into its own
//? destination): pick a theme + light/dark and preview how your design system renders across buttons,
//? inputs, overlays, data and foundations. Reuses the Designer's Components section + shared state.

import { useTranslator } from '@luckystack/core/client';

import BaseDropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';

import Icon from '../../_components/Icon';
import { Segmented } from '../../_components/primitives';
import { DesignerProvider, useDesigner } from '../designer/state';
import type { ThemeMode } from '../designer/themes';
import Components from '../designer/sections/Components';

export const template = 'workspaces';

export default function ComponentsPage() {
  return (
    <DesignerProvider>
      <ComponentsShell />
    </DesignerProvider>
  );
}

//? The theme + light/dark preview controls (same pair as the Designer header) drive the tokens the
//? Components section renders under — kept here so the gallery is previewable exactly as it was inside
//? the Designer, just on its own page.
function ComponentsShell() {
  const translate = useTranslator();
  const d = useDesigner();
  const themeItems: DropdownItem[] = d.themes.map((t) => ({ id: t.id, value: t.id, item: t.name }));
  const activeItem = themeItems.find((i) => i.id === d.activeThemeId);
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-5 md:px-6 pt-4 pb-3 border-b border-divider shrink-0 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-title min-w-0">
          <span className="w-8 h-8 rounded-xl bg-primary/12 text-primary flex items-center justify-center shrink-0"><Icon name="table-cells-large" /></span>
          <div className="min-w-0">
            <div className="text-xl font-semibold leading-tight">{translate({ key: 'workspaces.components.title' })}</div>
            <div className="text-xs text-muted truncate">{translate({ key: 'workspaces.components.tagline' })}</div>
          </div>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted hidden sm:inline">{translate({ key: 'workspaces.designer.previewingWith' })}</span>
          <BaseDropdown items={themeItems} {...(activeItem ? { value: activeItem } : {})} onChange={(i) => { d.setActiveThemeId(String(i.id)); }} size="md" />
          <Segmented<ThemeMode> options={[{ id: 'light', label: <Icon name="sun" /> }, { id: 'dark', label: <Icon name="moon" /> }]} value={d.mode} onChange={d.setMode} />
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <Components />
      </div>
    </div>
  );
}
