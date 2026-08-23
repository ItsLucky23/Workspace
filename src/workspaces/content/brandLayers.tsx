//? The content-side brand ladder shown beside each voice/context field. It makes the actual
//? generation boundary visible: Content pieces/media and Studio/Marketing use related but separate
//? inputs, so a user never has to guess which free-text voice wins.

import { useTranslator } from '@luckystack/core/client';

import Icon from '../_components/Icon';

export type BrandLayerSurface = 'product' | 'studio' | 'channel';

const LAYER_KEYS: Record<BrandLayerSurface, readonly string[]> = {
  product: ['workspaces.content.brandLayerProduct', 'workspaces.content.brandLayerChannel', 'workspaces.content.brandLayerStyle'],
  studio: ['workspaces.studio.brandLayerBrief', 'workspaces.studio.brandLayerLibrary', 'workspaces.studio.brandLayerRefine'],
  channel: ['workspaces.content.brandLayerProduct', 'workspaces.content.brandLayerChannel', 'workspaces.content.brandLayerStyle'],
};
const NOTE_KEYS: Record<BrandLayerSurface, string> = {
  product: 'workspaces.content.brandLayerProductNote',
  studio: 'workspaces.studio.brandLayerStudioNote',
  channel: 'workspaces.content.brandLayerChannelNote',
};
const ACTION_KEYS: Record<BrandLayerSurface, string> = {
  product: 'workspaces.content.brandLayerStudioAction',
  studio: 'workspaces.studio.brandLayerProductAction',
  channel: 'workspaces.content.brandLayerStudioAction',
};

export function BrandLayerNote({ surface, onOpen }: { surface: BrandLayerSurface; onOpen?: () => void }) {
  const translate = useTranslator();
  const layers = LAYER_KEYS[surface];
  const noteKey = NOTE_KEYS[surface];
  const actionKey = ACTION_KEYS[surface];
  return (
    <div className={`rounded-lg border border-divider bg-container2/40 px-3 py-2.5 text-xs text-muted`}>
      <div className={`flex items-center gap-1.5 mb-1.5`}>
        <Icon name="layer-group" className={`text-primary`} />
        <div className={`flex flex-wrap items-center gap-1`}>
          {layers.map((key, index) => (
            <span key={key} className={`inline-flex items-center gap-1`}>
              {index > 0 && <Icon name="arrow-right" aria-hidden="true" className={`text-disabled text-[10px]`} />}
              <span className={`rounded-full bg-container1 px-1.5 py-0.5 text-meta`}>{translate({ key })}</span>
            </span>
          ))}
        </div>
      </div>
      <div className={`flex items-start justify-between gap-2`}>
        <span className={`leading-relaxed`}>{translate({ key: noteKey })}</span>
        {onOpen && <button type="button" onClick={onOpen} className={`shrink-0 text-primary hover:text-primary-hover hover:underline cursor-pointer`}>{translate({ key: actionKey })}</button>}
      </div>
    </div>
  );
}
