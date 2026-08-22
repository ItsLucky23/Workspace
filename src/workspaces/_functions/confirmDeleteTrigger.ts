//? F-019 — the ONE "delete this trigger?" confirm (#93), shared by the Automations panel and the Schedules
//? page. It was copied verbatim into both; a copy drifts, a helper cannot.

import type { useTranslator } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';

export async function confirmDeleteTrigger(translate: ReturnType<typeof useTranslator>, triggerName: string): Promise<boolean> {
  return menuHandler.confirm({
    title: translate({ key: 'workspaces.automation.deleteConfirmTitle' }),
    content: translate({ key: 'workspaces.automation.deleteConfirmBody', params: [{ key: 'name', value: triggerName }] }),
  });
}
