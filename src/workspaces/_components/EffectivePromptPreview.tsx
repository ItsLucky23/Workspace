//? The answer to "what does the AI actually receive?" (ADR 0311, supersedes 0308).
//?
//? Five fields across two pages steer one agent run, and documenting the composition somewhere else
//? does not help a user editing seven stages — it has to be verifiable on the screen where you type.
//? What changed in 0311: the fields do NOT form one ordered stack. They travel in two independent
//? channels (the system prompt vs the CLAUDE.md project brief), so this renders them grouped by
//? channel, each with its real internal order and its own composed result. Showing one merged block
//? would be the same lie in a nicer wrapper — a user would read "my system prompt constrains my
//? instructions below it" and act on it, and the two are not even in the same file.
//?
//? It is also the cheapest way to spot the class of bug this design invites: the same instruction
//? written twice, or two layers contradicting.
//? @adr 0311

/* eslint-disable react-refresh/only-export-components -- `useLayerTip` returns the tip's PARTS because SettingRow builds its own InfoTip while FieldLabel takes a node; it belongs with the component it mirrors, not in a third file, for a dev-only fast-refresh rule. Not a route component. */
import { useTranslator } from '@luckystack/core/client';

import Icon from './Icon';
import { Disclosure, FOCUS_RING, InfoTip, type InfoTipPoint } from './primitives';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import {
  AI_LAYER_CHANNEL_HELP_KEY, AI_LAYER_CHANNEL_LABEL_KEY, AI_LAYER_CHANNEL_ORDER, AI_LAYER_COUNT,
  AI_LAYER_LABEL_KEY, composeChannel, layersInChannel, type ResolvedAiLayer,
} from '../_functions/aiLayers';

//? A stable identity for the "nothing is inline here" default — a fresh `[]` on every render is a new
//? prop value, which is what the unstable-default-props rule is about.
const NO_INLINE: readonly ResolvedAiLayer['id'][] = [];

//? Naming a layer without saying WHERE it is edited is the half-answer this preview shipped with: it
//? listed five fields spread over two pages and left you to find them. Each layer therefore carries its
//? own destination, and the URL work (ADR 0312) makes that destination an address rather than a hint —
//? the carry-over template lives behind an admin-only Advanced tab, which is exactly the one nobody finds.
function LayerLink({ id, stageId, inline }: { id: ResolvedAiLayer['id']; stageId?: string; inline: boolean }) {
  const translate = useTranslator();
  const { navigate, focusSetup, stageConfigs } = useWorkspaces();
  const anchor = stageId ?? stageConfigs[0]?.id;
  //? The editor for this layer is already on screen — a jump would land the user where they are.
  if (inline) return null;

  //? F-010 — on a pipeline stage the skills layer is the stage's own PICK (Context tab), so that is where
  //? the link goes; the workspace editor is only the destination when no stage is in play.
  const stageSkills = id === 'skills' && stageId !== undefined;
  const go = (): void => {
    if (id === 'workspace' || (id === 'skills' && !stageSkills)) { focusSetup({ view: 'workspace', tab: 'aibehavior' }); return; }
    if (stageSkills) { navigate('pipeline', [stageId, 'context']); return; }
    const tab = id === 'carryOver' ? 'carryover' : 'general';
    //? Same rule as useLayerTip: never navigate to the pipeline without the stage, or the tab segment
    //? is dropped and the link lands on the first stage's General tab whatever the label promised.
    navigate('pipeline', anchor === undefined ? [] : [anchor, tab]);
  };

  return (
    <button
      type="button" onClick={go}
      className={`shrink-0 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-primary hover:bg-primary/10 cursor-pointer transition-colors ${FOCUS_RING}`}
    >
      {translate({ key: stageSkills ? 'workspaces.aiLayers.goto_skillsStage' : `workspaces.aiLayers.goto_${id}` })} <Icon name="arrow-right-long" className={`text-[10px]`} />
    </button>
  );
}

//? The "?" next to a layered FIELD — the shape the owner actually asked for: a small icon, hover or
//? click, and the explanation appears over the page instead of as a block above it.
//?
//? What shipped instead was `EffectivePromptPreview`, a full-width disclosure sitting on top of the
//? very field it describes, and on the workspace AI page it landed four settings rows below the field
//? — present, and unfindable. The information was right; the container was wrong on both pages.
//?
//? Returns the PARTS rather than an element because the two call sites mount a tip differently:
//? `SettingRow` builds its own InfoTip from `infoTitle`/`info`/`infoPoints`, while the pipeline's
//? `FieldLabel` takes a rendered node. One definition, two mounts.
export function useLayerTip(layers: ResolvedAiLayer[], id: ResolvedAiLayer['id'], stageId?: string): {
  title: string;
  body: string;
  points: InfoTipPoint[];
} {
  const translate = useTranslator();
  const { navigate, focusSetup, stageConfigs } = useWorkspaces();
  //? The workspace AI page has no stage of its own, so its tip's stage links had nowhere precise to
  //? go: `navigate('pipeline', [])` dropped the tab it had just computed and landed on the first
  //? stage's General tab while the button said "Edit on the Carry-over tab". Falling back to the first
  //? stage keeps the promise — that tab, on a real stage — instead of quietly landing elsewhere.
  const anchorStage = stageId ?? stageConfigs[0]?.id;
  const layer = layers.find((l) => l.id === id);
  const channel = layer?.channel ?? 'system';
  const siblings = layersInChannel(layers, channel);

  const go = (target: ResolvedAiLayer): (() => void) | undefined => {
    //? No link for the field the tip is attached to — it is the thing you are looking at.
    if (target.id === id) return undefined;
    if (target.id === 'workspace' || target.id === 'skills') return () => { focusSetup({ view: 'workspace', tab: 'aibehavior' }); };
    const tab = target.id === 'carryOver' ? 'carryover' : 'general';
    //? No stage anywhere means no pipeline to point at — offer no link rather than a link that lies.
    if (anchorStage === undefined) return undefined;
    return () => { navigate('pipeline', [anchorStage, tab]); };
  };

  return {
    title: translate({ key: 'workspaces.aiLayers.tipTitle' }),
    //? Names the CHANNEL and this field's place in it, because "after X" only means anything within
    //? one channel — a field in the other channel neither precedes nor follows it.
    body: `${translate({ key: AI_LAYER_CHANNEL_HELP_KEY[channel] })} ${translate({
      key: 'workspaces.aiLayers.tipPosition',
      params: [
        { key: 'channel', value: translate({ key: AI_LAYER_CHANNEL_LABEL_KEY[channel] }) },
        { key: 'n', value: String(layer?.position ?? 1) },
        { key: 'total', value: String(layer?.channelTotal ?? siblings.length) },
      ],
    })}`,
    points: siblings.map((l): InfoTipPoint => {
      const onGo = go(l);
      return {
        id: l.id,
        label: `${String(l.position)}. ${translate({ key: AI_LAYER_LABEL_KEY[l.id] })}${l.id === id ? translate({ key: 'workspaces.aiLayers.tipThisField' }) : ''}`,
        //? Set vs empty is the answer to "why is my instruction being ignored" — an empty layer
        //? contributes nothing, and that absence is invisible everywhere else.
        desc: l.text.length > 0 ? l.text.slice(0, 140) : translate({ key: 'workspaces.aiLayers.layerEmpty' }),
        ...(onGo === undefined ? {} : { onGo, goLabel: translate({ key: `workspaces.aiLayers.goto_${l.id}` }) }),
      };
    }),
  };
}

/** The rendered "?" for a call site that wants a node (the pipeline's FieldLabel). */
export function LayerTip({ layers, id, stageId }: { layers: ResolvedAiLayer[]; id: ResolvedAiLayer['id']; stageId?: string }) {
  const tip = useLayerTip(layers, id, stageId);
  return <InfoTip align="start" title={tip.title} body={tip.body} points={tip.points} />;
}

/** One channel: its name, what it steers, its layers in order, and the text it composes to. */
function ChannelBlock({ layers, channel, stageId, inlineIds }: { layers: ResolvedAiLayer[]; channel: ResolvedAiLayer['channel']; stageId?: string; inlineIds: readonly ResolvedAiLayer['id'][] }) {
  const translate = useTranslator();
  const own = layersInChannel(layers, channel);
  const composed = composeChannel(layers, channel);

  return (
    <div className={`rounded-xl border border-container1-border`}>
      <div className={`px-3 py-2 border-b border-container1-border`}>
        <div className={`text-xs font-semibold text-title`}>{translate({ key: AI_LAYER_CHANNEL_LABEL_KEY[channel] })}</div>
        <div className={`text-xs text-meta leading-relaxed`}>{translate({ key: AI_LAYER_CHANNEL_HELP_KEY[channel] })}</div>
      </div>

      {/* Every layer always listed, so an empty one reads as "not set" rather than being invisible —
          that absence is itself the answer to "why is this being ignored?". */}
      <ol className={`flex flex-col gap-1.5 p-3`}>
        {own.map((l) => {
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
              <LayerLink id={l.id} {...(stageId === undefined ? {} : { stageId })} inline={inlineIds.includes(l.id)} />
            </li>
          );
        })}
      </ol>

      <div className={`px-3 pb-3`}>
        {composed.length > 0
          ? <pre className={`whitespace-pre-wrap break-words rounded-lg bg-container2 p-3 text-xs text-common max-h-56 overflow-auto`}>{composed}</pre>
          : <div className={`rounded-lg border border-dashed border-container1-border px-3 py-3 text-xs text-muted text-center`}>{translate({ key: 'workspaces.aiLayers.composedEmpty' })}</div>}
      </div>
    </div>
  );
}

export function EffectivePromptPreview({ layers, defaultOpen = false, stageId, inlineIds = NO_INLINE }: {
  layers: ResolvedAiLayer[];
  defaultOpen?: boolean;
  /** The stage the preview belongs to, so a layer's "edit" lands on THAT stage rather than the first one. */
  stageId?: string;
  /** Layers whose editor is already on this screen — those get no jump, because there is nowhere to go. */
  inlineIds?: readonly ResolvedAiLayer['id'][];
}) {
  const translate = useTranslator();
  const contributing = layers.filter((l) => l.text.length > 0);

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
        {AI_LAYER_CHANNEL_ORDER.map((channel) => <ChannelBlock key={channel} layers={layers} channel={channel} inlineIds={inlineIds} {...(stageId === undefined ? {} : { stageId })} />)}
      </div>
    </Disclosure>
  );
}

/** The inline note on a layered field, e.g. "system prompt · 2 of 3 — runs after Workspace instruction".
 *  Feed it to `SettingRow`'s `inherits` prop. Names the CHANNEL, because "after X" only means anything
 *  within one: a field in the other channel neither precedes nor follows it. */
export function LayerNote({ layers, id }: { layers: ResolvedAiLayer[]; id: ResolvedAiLayer['id'] }) {
  const translate = useTranslator();
  const layer = layers.find((l) => l.id === id);
  if (!layer) return null;
  const channel = translate({ key: AI_LAYER_CHANNEL_LABEL_KEY[layer.channel] });
  const before = layersInChannel(layers, layer.channel)
    .filter((l) => l.position < layer.position)
    .map((l) => translate({ key: AI_LAYER_LABEL_KEY[l.id] }));

  if (before.length === 0) {
    return <>{translate({ key: 'workspaces.aiLayers.noteChannelFirst', params: [{ key: 'channel', value: channel }, { key: 'total', value: String(layer.channelTotal) }] })}</>;
  }
  return (
    <>
      {translate({
        key: 'workspaces.aiLayers.noteChannelAfter',
        params: [
          { key: 'channel', value: channel },
          { key: 'n', value: String(layer.position) },
          { key: 'total', value: String(layer.channelTotal) },
          { key: 'before', value: before.join(', ') },
        ],
      })}
    </>
  );
}
