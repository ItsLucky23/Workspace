//? The Content/Studio "second AI prompt stack" explainer — the same job as the Develop side's
//? EffectivePromptPreview (ADR 0308), for the unrelated stack described in the audit's
//? duplicateConcepts #2: brief tone, the workspace's central brand voice and a per-generation refine
//? instruction all steer ONE Studio/Marketing artifact generation. Reads `resolveContentAiLayers()`
//? from aiLayers.ts so the UI can't drift from server/studio/generate.ts's real composition order.
//?
//? Shared between /studio and /marketing (both consume this, neither forks it, unlike the rest of the
//? surface) because the order here is correctness-critical: it has to track the server, not a re-typed
//? guess duplicated in two places.

import { useTranslator } from '@luckystack/core/client';

import Icon from '../../_components/Icon';
import { Disclosure } from '../../_components/primitives';
import { CONTENT_LAYER_LABEL_KEY, composeEffectiveContentPrompt, resolveContentAiLayers, type ResolvedContentLayer } from '../../_functions/aiLayers';

const SOURCE_KEY: Record<ResolvedContentLayer['source'], string> = {
  brief: 'workspaces.aiLayers.sourceBrief',
  brand: 'workspaces.aiLayers.sourceBrand',
  refine: 'workspaces.aiLayers.sourceRefine',
  channel: 'workspaces.aiLayers.sourceChannel',
};

export function ContentPromptPreview({ briefTone, brandVoice, refine }: { briefTone: string; brandVoice: string; refine: string }) {
  const translate = useTranslator();
  const layers = resolveContentAiLayers({ briefTone, brandVoice, refine });
  const applicableLayers = layers.filter((l) => l.applicable);
  const contributing = applicableLayers.filter((l) => l.text.length > 0);
  const composed = composeEffectiveContentPrompt(layers);

  return (
    <Disclosure
      summary={(
        <span className={`flex items-center gap-2`}>
          <Icon name="layer-group" className={`text-muted`} />
          {translate({ key: 'workspaces.aiLayers.previewTitle' })}
          <span className={`rounded-full bg-container2 px-1.5 text-xs font-semibold text-meta`}>
            {translate({ key: 'workspaces.aiLayers.contributingCount', params: [{ key: 'n', value: String(contributing.length) }, { key: 'total', value: String(applicableLayers.length) }] })}
          </span>
        </span>
      )}
    >
      <div className={`flex flex-col gap-3`}>
        <div className={`text-xs text-muted leading-relaxed`}>{translate({ key: 'workspaces.aiLayers.contentPreviewHelp' })}</div>

        {/* the ladder: every layer always listed (including the inert channelVoice one) so absence
            reads as the answer rather than being invisible — same contract as the Develop preview. */}
        <ol className={`flex flex-col gap-1.5`}>
          {layers.map((l) => {
            const on = l.applicable && l.text.length > 0;
            return (
              <li key={l.id} className={`flex items-start gap-2.5 text-xs`}>
                <span className={`mt-0.5 w-5 h-5 shrink-0 rounded-md flex items-center justify-center font-bold tabular-nums ${on ? 'bg-primary/12 text-primary' : 'bg-container2 text-disabled'}`}>
                  {l.position}
                </span>
                <span className={`min-w-0 flex-1`}>
                  <span className={`font-semibold ${on ? 'text-title' : 'text-meta'}`}>{translate({ key: CONTENT_LAYER_LABEL_KEY[l.id] })}</span>
                  <span className={`text-meta`}> · {translate({ key: SOURCE_KEY[l.source] })}</span>
                  {l.applicable
                    ? (on
                      ? <span className={`block text-common truncate`}>{l.text}</span>
                      : <span className={`block text-meta italic`}>{translate({ key: 'workspaces.aiLayers.layerEmpty' })}</span>)
                    : <span className={`block text-meta italic`}>{translate({ key: 'workspaces.aiLayers.channelNotApplicable' })}</span>}
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
