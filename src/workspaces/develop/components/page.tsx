//? intent: Components — a curated showcase of the shared UI component kit, rendered under a selectable
//? design theme. A DEV component-library reference (moved out of the Designer into its own destination):
//? pick a theme + light/dark and preview how your design system renders across buttons,
//? inputs, overlays, data and foundations. Reuses the Designer's Components section + shared state.

import { useTranslator } from '@luckystack/core/client';

import BaseDropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';

import Icon from '../../_components/Icon';
import { InfoDot, Segmented, WsButton } from '../../_components/primitives';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import { DesignerProvider, useDesigner } from '../designer/state';
import type { ThemeMode } from '../designer/themes';
import Components from '../designer/sections/Components';

export const template = 'workspaces';

export default function ComponentsPage() {
  const { activeWorkspace } = useWorkspaces();
  return (
    <DesignerProvider key={activeWorkspace.id}>
      <ComponentsShell />
    </DesignerProvider>
  );
}

//? The theme + light/dark preview controls (same pair as the Designer header) drive the tokens the
//? Components section renders under — kept here so the gallery is previewable exactly as it was inside
//? the Designer, just on its own page.
function ComponentsShell() {
  const translate = useTranslator();
  const { navigate } = useWorkspaces();
  const d = useDesigner();
  const themeItems: DropdownItem[] = d.themes.map((t) => ({ id: t.id, value: t.id, item: t.name }));
  const activeItem = themeItems.find((i) => i.id === d.activeThemeId);

  const tagline = translate({ key: 'workspaces.components.tagline' });
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-5 md:px-6 pt-4 pb-3 border-b border-divider shrink-0 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-title min-w-0">
          <span className="w-8 h-8 rounded-xl bg-primary/12 text-primary flex items-center justify-center shrink-0"><Icon name="table-cells-large" /></span>
          <div className="min-w-0">
            <div className="text-xl font-semibold leading-tight">{translate({ key: 'workspaces.components.title' })}</div>
            {/* gap-fix: title= recovers the truncated tagline on narrow viewports instead of losing it to the ellipsis */}
            <div className="text-xs text-muted truncate" title={tagline}>{tagline}</div>
          </div>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted hidden sm:inline">{translate({ key: 'workspaces.designer.previewingWith' })}</span>
          <BaseDropdown items={themeItems} {...(activeItem ? { value: activeItem } : {})} onChange={(i) => { d.setActiveThemeId(String(i.id)); }} size="md" />
          <Segmented<ThemeMode>
            options={[
              { id: 'light', label: <Icon name="sun" />, ariaLabel: translate({ key: 'workspaces.designer.previewLight' }) },
              { id: 'dark', label: <Icon name="moon" />, ariaLabel: translate({ key: 'workspaces.designer.previewDark' }) },
            ]}
            value={d.mode}
            onChange={d.setMode}
          />
        </div>
      </div>
      {/* gap-fix (duplicate-concept "active theme"): the dropdown above only changes what YOU preview HERE
          (local, resets on reload) — a second, independent concept from which theme the coding agent actually
          builds with. Say both explicitly, with a link to the one place either is actually editable, so the
          two never get mistaken for a single savable control. */}
      <div className="px-5 md:px-6 py-2 border-b border-divider shrink-0 flex items-center gap-2 flex-wrap bg-container1/30">
        <InfoDot body={translate({ key: 'workspaces.components.previewOnlyBody' })} />
        <span className="text-xs text-muted">{translate({ key: 'workspaces.components.previewOnly' })}</span>
        <span className="text-xs text-muted inline-flex items-center gap-1.5 min-w-0">
          <Icon name="link" className={d.activeThemeName ? 'text-correct' : 'text-muted'} />
          <span className="truncate">{d.activeThemeName ? translate({ key: 'workspaces.designer.activeInProject', params: [{ key: 'name', value: d.activeThemeName }] }) : translate({ key: 'workspaces.designer.noneActive' })}</span>
        </span>
        <div className="flex-1" />
        <WsButton variant="secondary" icon="palette" onClick={() => { navigate('designer'); }}>{translate({ key: 'workspaces.components.openInDesigner' })}</WsButton>
      </div>
      <div className="flex-1 min-h-0">
        <Components />
      </div>
    </div>
  );
}
