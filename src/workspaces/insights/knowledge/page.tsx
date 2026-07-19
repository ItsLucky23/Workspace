//? intent: the Knowledge graph (Obsidian-view) — the workspace's context sources, tickets and
//? content pieces as one explorable map. The graph canvas is the whole show: tap/click a node to
//? focus it, its connections light up, and a detail panel lists everything it links to. Refresh
//? (header icon) re-runs the N1 knowledgeGraph_v1 data op; counts live as a caption under the canvas.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { apiRequest, tryCatch, useTranslator } from '@luckystack/core/client';

import Icon from '../../_components/Icon';
import { EmptyState, IconButton, WsButton } from '../../_components/primitives';
import { useWorkspaces } from '../../_shell/WorkspacesContext';

export const template = 'workspaces';

type NodeType = 'source' | 'ticket' | 'piece';
interface GraphNode { id: string; type: NodeType; label: string }
interface GraphEdge { from: string; to: string; kind: 'similarity' | 'link'; weight: number }
interface Graph { nodes: GraphNode[]; edges: GraphEdge[] }

//? Node colour per type — via the theme tokens (fill-current + text-<token>), never arbitrary hex.
const TYPE_TEXT: Record<NodeType, string> = { source: 'text-primary', ticket: 'text-secondary', piece: 'text-correct' };
const TYPE_LABEL: Record<NodeType, string> = {
  source: 'workspaces.knowledge.typeSource',
  ticket: 'workspaces.knowledge.typeTicket',
  piece: 'workspaces.knowledge.typePiece',
};

//? A deterministic ring layout (no force sim / no lib — CSP-safe, no animation loop): nodes evenly
//? spaced on a circle, grouped by type so same-type nodes sit on the same arc. Labels render on
//? hover/selection only (an Obsidian-style graph), so a dense graph stays readable.
const W = 1000;
const H = 700;
const CX = W / 2;
const CY = H / 2;
const R = 300;

const truncate = (label: string): string => (label.length > 42 ? `${label.slice(0, 42)}…` : label);

export default function KnowledgePage() {
  const { activeWorkspace } = useWorkspaces();
  const translate = useTranslator();
  const workspaceId = activeWorkspace.id;

  const [graph, setGraph] = useState<Graph | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!workspaceId) return;
    setLoading(true);
    void (async () => {
      const [error, res] = await tryCatch(() => apiRequest({ name: 'workspaces/knowledgeGraph', version: 'v1', data: { workspaceId } }));
      setLoading(false);
      if (error || res?.status !== 'success') { setGraph({ nodes: [], edges: [] }); return; }
      setGraph({ nodes: res.result.nodes, edges: res.result.edges });
      //? A fresh graph may not contain the previously selected id — a stale focus would dim
      //? every node with nothing highlighted, so selection resets with the data.
      setSelected(null);
      setHovered(null);
    })();
  }, [workspaceId]);

  useEffect(() => { load(); }, [load]);

  //? Positions: order nodes grouped by type, then place evenly on the ring (index → angle).
  const positioned = useMemo(() => {
    const nodes = graph?.nodes ?? [];
    const order: NodeType[] = ['source', 'ticket', 'piece'];
    const sorted = [...nodes].toSorted((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
    const n = Math.max(1, sorted.length);
    const pos = new Map<string, { x: number; y: number; node: GraphNode }>();
    for (const [i, node] of sorted.entries()) {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      pos.set(node.id, { x: CX + R * Math.cos(angle), y: CY + R * Math.sin(angle), node });
    }
    return pos;
  }, [graph]);

  const nodesById = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const n of graph?.nodes ?? []) map.set(n.id, n);
    return map;
  }, [graph]);

  //? Focus = sticky selection first, hover as the transient fallback (touch devices only have the
  //? click/tap path). The neighbour set of the focused node drives highlight + labels.
  const focus = selected ?? hovered;
  const neighbours = useMemo(() => {
    const set = new Set<string>();
    if (!focus) return set;
    for (const e of graph?.edges ?? []) {
      if (e.from === focus) set.add(e.to);
      if (e.to === focus) set.add(e.from);
    }
    return set;
  }, [focus, graph]);

  //? The drill-in detail for a STICKY selection (not hover — that would flicker): full label,
  //? type and the neighbour list, so a 42-char SVG label is no longer the only detail surface.
  const selectedNode = selected === null ? null : (nodesById.get(selected) ?? null);
  const neighbourNodes = useMemo((): GraphNode[] => {
    if (selected === null) return [];
    const out: GraphNode[] = [];
    for (const id of neighbours) {
      const n = nodesById.get(id);
      if (n) out.push(n);
    }
    return out;
  }, [selected, neighbours, nodesById]);

  const nodeCount = graph?.nodes.length ?? 0;
  const edgeCount = graph?.edges.length ?? 0;

  return (
    <div className={`flex flex-col h-full min-h-0`}>
      <div className={`px-4 md:px-6 py-3 md:py-4 flex items-start justify-between gap-3 shrink-0`}>
        <div className={`min-w-0`}>
          <h1 className={`text-xl md:text-2xl font-semibold text-title`}>{translate({ key: 'workspaces.knowledge.title' })}</h1>
          <span className={`text-sm text-muted`}>{translate({ key: 'workspaces.knowledge.subtitle' })}</span>
        </div>
        {/* Refresh — secondary by design (data comes from work done elsewhere), so icon-only ghost. */}
        <WsButton icon="arrows-rotate" variant="ghost" onClick={load} disabled={loading} title={translate({ key: 'workspaces.knowledge.refresh' })} className={`shrink-0`} />
      </div>

      <div className={`flex-1 min-h-0 overflow-y-auto px-4 md:px-6 pb-8`}>
        {nodeCount === 0 ? (
          <EmptyState
            icon="diagram-project"
            title={translate({ key: loading ? 'workspaces.knowledge.loadingTitle' : 'workspaces.knowledge.emptyTitle' })}
            sub={translate({ key: loading ? 'workspaces.knowledge.loadingSub' : 'workspaces.knowledge.emptyTeach' })}
            action={!loading && (
              <WsButton icon="arrows-rotate" variant="secondary" onClick={load}>{translate({ key: 'workspaces.knowledge.refresh' })}</WsButton>
            )}
          />
        ) : (
          <div className={`flex flex-col gap-3`}>
            {/* Colour legend — first-screen so a first-timer can decode the dots immediately. */}
            <div className={`flex items-center gap-4 flex-wrap text-xs text-muted`}>
              <span className={`flex items-center gap-1.5`}><span className={`w-2.5 h-2.5 rounded-full bg-current text-primary`} />{translate({ key: 'workspaces.knowledge.legendSources' })}</span>
              <span className={`flex items-center gap-1.5`}><span className={`w-2.5 h-2.5 rounded-full bg-current text-secondary`} />{translate({ key: 'workspaces.knowledge.legendTickets' })}</span>
              <span className={`flex items-center gap-1.5`}><span className={`w-2.5 h-2.5 rounded-full bg-current text-correct`} />{translate({ key: 'workspaces.knowledge.legendPieces' })}</span>
            </div>

            {/* The graph canvas — the page's primary surface. Background click clears the selection. */}
            <div className={`rounded-2xl border border-container1-border bg-container1`}>
              <svg viewBox={`0 0 ${String(W)} ${String(H)}`} className={`w-full h-auto`} role="img" aria-label={translate({ key: 'workspaces.knowledge.title' })} onClick={() => { setSelected(null); }}>
                {/* Edges first (under the nodes). Kind encodes colour, weight encodes opacity; dim outside the focus neighbourhood. */}
                {(graph?.edges ?? []).map((e) => {
                  const a = positioned.get(e.from);
                  const b = positioned.get(e.to);
                  if (!a || !b) return null;
                  const active = focus !== null && (e.from === focus || e.to === focus);
                  const dim = focus !== null && !active;
                  return (
                    <line key={`${e.from}-${e.to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                      className={`stroke-current ${e.kind === 'link' ? 'text-primary' : 'text-divider'}`}
                      strokeWidth={active ? 2 : 1} strokeOpacity={dim ? 0.08 : 0.15 + e.weight * 0.5} />
                  );
                })}
                {/* Nodes. Labels only for the focus node + its neighbours (Obsidian-style). */}
                {[...positioned.values()].map(({ x, y, node }) => {
                  const isFocus = node.id === focus;
                  const isNeighbour = neighbours.has(node.id);
                  const dim = focus !== null && !isFocus && !isNeighbour;
                  const showLabel = isFocus || isNeighbour;
                  return (
                    <g key={node.id} className={`cursor-pointer`} opacity={dim ? 0.25 : 1}
                      onClick={(ev) => { ev.stopPropagation(); setSelected((s) => (s === node.id ? null : node.id)); }}
                      onMouseEnter={() => { setHovered(node.id); }} onMouseLeave={() => { setHovered(null); }}>
                      {/* Invisible larger hit circle: r=6 dots are too small for touch; the visual radius stays unchanged. */}
                      <circle cx={x} cy={y} r={18} className={`fill-transparent`} />
                      <circle cx={x} cy={y} r={isFocus ? 10 : 6} className={`fill-current ${TYPE_TEXT[node.type]}`} />
                      {showLabel && (
                        <text x={x} y={y - 12} textAnchor="middle" className={`fill-current text-title text-[13px] font-medium`} style={{ pointerEvents: 'none' }}>{truncate(node.label)}</text>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Footer caption: the interaction hint (tap-copy on phone, where hover doesn't exist) + the diagnostics counts. */}
            <div className={`flex items-center justify-between gap-3 flex-wrap text-xs text-muted`}>
              <span className={`flex items-center gap-1.5`}>
                <Icon name="circle-question" />
                <span className={`md:hidden`}>{translate({ key: 'workspaces.knowledge.hintTap' })}</span>
                <span className={`hidden md:inline`}>{translate({ key: 'workspaces.knowledge.hint' })}</span>
              </span>
              <span className={`flex items-center gap-4 tabular-nums`}>
                <span>{translate({ key: 'workspaces.knowledge.nodeCount', params: [{ key: 'count', value: String(nodeCount) }] })}</span>
                <span>{translate({ key: 'workspaces.knowledge.edgeCount', params: [{ key: 'count', value: String(edgeCount) }] })}</span>
              </span>
            </div>

            {/* Drill-in panel for the selected node — full label + type + tappable neighbour list. */}
            {selectedNode && (
              <div className={`rounded-2xl border border-container1-border bg-container1 p-4 flex flex-col gap-3`}>
                <div className={`flex items-start justify-between gap-3`}>
                  <div className={`min-w-0`}>
                    <span className={`flex items-center gap-1.5 text-xs text-muted`}>
                      <span className={`w-2.5 h-2.5 rounded-full bg-current ${TYPE_TEXT[selectedNode.type]}`} />
                      {translate({ key: TYPE_LABEL[selectedNode.type] })}
                    </span>
                    <div className={`text-sm font-semibold text-title break-words mt-1`}>{selectedNode.label}</div>
                  </div>
                  <IconButton icon="xmark" title={translate({ key: 'workspaces.knowledge.detailClose' })} onClick={() => { setSelected(null); }} className={`shrink-0 -mt-1.5 -mr-1.5`} />
                </div>
                <div className={`flex flex-col gap-1`}>
                  <span className={`text-xs font-medium text-muted`}>{translate({ key: 'workspaces.knowledge.connectedTo', params: [{ key: 'count', value: String(neighbourNodes.length) }] })}</span>
                  {neighbourNodes.length === 0 ? (
                    <span className={`text-sm text-muted`}>{translate({ key: 'workspaces.knowledge.noConnections' })}</span>
                  ) : (
                    <div className={`flex flex-col`}>
                      {neighbourNodes.map((n) => (
                        <button
                          key={n.id} type="button" onClick={() => { setSelected(n.id); }}
                          className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-common text-left hover:bg-container2 transition-colors cursor-pointer min-w-0`}
                        >
                          <span className={`w-2 h-2 rounded-full bg-current shrink-0 ${TYPE_TEXT[n.type]}`} />
                          <span className={`truncate`}>{n.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
