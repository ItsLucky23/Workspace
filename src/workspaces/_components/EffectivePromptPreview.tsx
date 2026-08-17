//? The answer to "what does the AI actually receive?" (ADR 0308).
//?
//? Five fields across two pages compose one agent prompt. Documenting the order somewhere else
//? does not help a user editing seven stages — the composition has to be verifiable on the screen
//? where you are typing. This renders the layers in their real order, marks which ones currently
//? contribute, and shows the concatenated result. It is also the cheapest way to spot the class of
//? bug this design invites: the same instruction written twice, or two layers contradicting.

import { useTranslator } from '@luckystack/core/client';

import Icon from './Icon';
import { Disclosure } from './primitives';
import { AI_LAYER_COUNT, AI_LAYER_LABEL_KEY, composeEffectivePrompt, type ResolvedAiLayer } from '../_functions/aiLayers';

export function EffectivePromptPreview({ layers, defaultOpen = false }: { layers: ResolvedAiLayer[]; defaultOpen?: boolean }) {
  const translate = useTranslator();
  const contributing = layers.filter((l) => l.text.length > 0);
  const composed = composeEffectivePrompt(layers);

  return (
    <Disclosure
      defaultOpen={defaultOpen}
      summary={(
        <span className={`flex items-center gap-2`}>
          <Icon name="layer-group" className={`text-muted`} />
          {translate({ key: 'workspaces.aiLayers.previewTitle' })}
          <span className={`rounded-full bg-container2 px-1.5 text-xs font-semibold text-meta`}>
            {translate({ key: 'workspaces.aiLayers.contributingCount', params: [{ key: 'n', value: String(contributing.length) }, { key: 'total', value: String(AI_LAYER_COUNT) }] })}
          </span>
        </span>
      )}
    >
      <div className={`flex flex-col gap-3`}>
        <div className={`text-xs text-muted leading-relaxed`}>{translate({ key: 'workspaces.aiLayers.previewHelp' })}</div>

        {/* The ladder: every layer always listed, so an empty one reads as "not set" rather than
            being invisible — that absence is itself the answer to "why is this being ignored?". */}
        <ol className={`flex flex-col gap-1.5`}>
          {layers.map((l) => {
            const on = l.text.length > 0;
            return (
              <li key={l.id} className={`flex items-start gap-2.5 text-xs`}>
                <span className={`mt-0.5 w-5 h-5 shrink-0 rounded-md flex items-center justify-center font-bold tabular-nums ${on ? 'bg-primary/12 text-primary' : 'bg-container2 text-disabled'}`}>
                  {l.position}
                </span>
                <span className={`min-w-0 flex-1`}>
                  <span className={`font-semibold ${on ? 'text-title' : 'text-meta'}`}>{translate({ key: AI_LAYER_LABEL_KEY[l.id] })}</span>
                  <span className={`text-meta`}> · {translate({ key: l.source === 'workspace' ? 'workspaces.aiLayers.sourceWorkspace' : 'workspaces.aiLayers.sourceStage' })}</span>
                  {on
                    ? <span className={`block text-common truncate`}>{l.text}</span>
                    : <span className={`block text-meta italic`}>{translate({ key: 'workspaces.aiLayers.layerEmpty' })}</span>}
                </span>
              </li>
            );
          })}
        </ol>

        <div>
          <div className={`text-xs font-semibold text-title mb-1`}>{translate({ key: 'workspaces.aiLayers.composedTitle' })}</div>
          {composed.length > 0
            ? <pre className={`whitespace-pre-wrap break-words rounded-lg bg-container2 p-3 text-xs text-common max-h-64 overflow-auto`}>{composed}</pre>
            : <div className={`rounded-lg border border-dashed border-container1-border px-3 py-4 text-xs text-muted text-center`}>{translate({ key: 'workspaces.aiLayers.composedEmpty' })}</div>}
        </div>
      </div>
    </Disclosure>
  );
}

/** The inline note that goes on a layered field, e.g. "layer 3 of 5 — runs after Workspace, Skills".
 *  Feed it to `SettingRow`'s `inherits` prop. */
export function LayerNote({ layers, id }: { layers: ResolvedAiLayer[]; id: ResolvedAiLayer['id'] }) {
  const translate = useTranslator();
  const layer = layers.find((l) => l.id === id);
  if (!layer) return null;
  const before = layers.filter((l) => l.position < layer.position).map((l) => translate({ key: AI_LAYER_LABEL_KEY[l.id] }));
  if (before.length === 0) {
    return <>{translate({ key: 'workspaces.aiLayers.noteFirst', params: [{ key: 'total', value: String(AI_LAYER_COUNT) }] })}</>;
  }
  return (
    <>
      {translate({
        key: 'workspaces.aiLayers.noteAfter',
        params: [
          { key: 'n', value: String(layer.position) },
          { key: 'total', value: String(AI_LAYER_COUNT) },
          { key: 'before', value: before.join(', ') },
        ],
      })}
    </>
  );
}
