//? intent: the Knowledge graph (Obsidian-view) — visualises the workspace's knowledge as
//? nodes (context sources, tickets, content pieces) linked by similarity + link edges, so a
//? user can see how their work relates. N2: the render of the N1 knowledgeGraph_v1 data op.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { apiRequest, tryCatch, useTranslator } from '@luckystack/core/client';

import Icon from '../../_components/Icon';
import { EmptyState, WsButton } from '../../_components/primitives';
import { useWorkspaces } from '../../_shell/WorkspacesContext';

export const template = 'workspaces';

type NodeType = 'source' | 'ticket' | 'piece';
interface GraphNode { id: string; type: NodeType; label: string }
interface GraphEdge { from: string; to: string; kind: 'similarity' | 'link'; weight: number }
interface Graph { nodes: GraphNode[]; edges: GraphEdge[] }

//? Node colour per type — via the theme tokens (fill-current + text-<token>), never arbitrary hex.
const TYPE_TEXT: Record<NodeType, string> = { source: 'text-primary', ticket: 'text-secondary', piece: 'text-correct' };

//? A deterministic ring layout (no force sim / no lib — CSP-safe, no animation loop): nodes evenly
//? spaced on a circle, grouped by type so same-type nodes sit on the same arc. Labels render on
//? hover/selection only (an Obsidian-style graph), so a dense graph stays readable.
const W = 1000;
const H = 700;
const CX = W / 2;
const CY = H / 2;
const R = 300;

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

  //? The neighbour set of the selected node (edges touching it) → highlight + label its neighbours.
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

  const nodeCount = graph?.nodes.length ?? 0;
  const edgeCount = graph?.edges.length ?? 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 md:px-6 py-3 md:py-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold text-title">{translate({ key: 'workspaces.knowledge.title' })}</h1>
          <span className="text-sm text-muted">{translate({ key: 'workspaces.knowledge.subtitle' })}</span>
        </div>
        <WsButton icon="arrows-rotate" variant="ghost" onClick={load} disabled={loading}>{translate({ key: 'workspaces.knowledge.refresh' })}</WsButton>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-4 md:px-6 pb-8">
        {nodeCount === 0 ? (
          <EmptyState icon="diagram-project" title={translate({ key: loading ? 'workspaces.knowledge.loadingTitle' : 'workspaces.knowledge.emptyTitle' })} sub={translate({ key: loading ? 'workspaces.knowledge.loadingSub' : 'workspaces.knowledge.emptySub' })} />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-4 flex-wrap text-xs text-muted">
              <span className="tabular-nums">{translate({ key: 'workspaces.knowledge.nodeCount', params: [{ key: 'count', value: String(nodeCount) }] })}</span>
              <span className="tabular-nums">{translate({ key: 'workspaces.knowledge.edgeCount', params: [{ key: 'count', value: String(edgeCount) }] })}</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-current text-primary" />{translate({ key: 'workspaces.knowledge.legendSources' })}</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-current text-secondary" />{translate({ key: 'workspaces.knowledge.legendTickets' })}</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-current text-correct" />{translate({ key: 'workspaces.knowledge.legendPieces' })}</span>
            </div>

            <div className="rounded-2xl border border-container1-border bg-container1">
              <svg viewBox={`0 0 ${String(W)} ${String(H)}`} className="w-full h-auto" role="img" aria-label={translate({ key: 'workspaces.knowledge.title' })} onClick={() => { setSelected(null); }}>
                {/* Edges first (under the nodes). Dim to the focus neighbourhood when a node is active. */}
                {(graph?.edges ?? []).map((e) => {
                  const a = positioned.get(e.from);
                  const b = positioned.get(e.to);
                  if (!a || !b) return null;
                  const active = focus !== null && (e.from === focus || e.to === focus);
                  const dim = focus !== null && !active;
                  return (
                    <line key={`${e.from}-${e.to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                      className={`stroke-current ${e.kind === 'link' ? 'text-primary' : 'text-divider'} ${active ? '' : ''}`}
                      strokeWidth={active ? 2 : 1} strokeOpacity={dim ? 0.08 : 0.15 + e.weight * 0.5} />
                  );
                })}
                {/* Nodes. */}
                {[...positioned.values()].map(({ x, y, node }) => {
                  const isFocus = node.id === focus;
                  const isNeighbour = neighbours.has(node.id);
                  const dim = focus !== null && !isFocus && !isNeighbour;
                  const showLabel = isFocus || isNeighbour;
                  return (
                    <g key={node.id} className="cursor-pointer" opacity={dim ? 0.25 : 1}
                      onClick={(ev) => { ev.stopPropagation(); setSelected((s) => (s === node.id ? null : node.id)); }}
                      onMouseEnter={() => { setHovered(node.id); }} onMouseLeave={() => { setHovered(null); }}>
                      <circle cx={x} cy={y} r={isFocus ? 10 : 6} className={`fill-current ${TYPE_TEXT[node.type]}`} />
                      {showLabel && (
                        <text x={x} y={y - 12} textAnchor="middle" className="fill-current text-title text-[13px] font-medium" style={{ pointerEvents: 'none' }}>{node.label.length > 42 ? `${node.label.slice(0, 42)}…` : node.label}</text>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted"><Icon name="circle-question" /> {translate({ key: 'workspaces.knowledge.hint' })}</div>
          </div>
        )}
      </div>
    </div>
  );
}
