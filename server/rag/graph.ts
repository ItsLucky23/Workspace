//? N1 — the knowledge-GRAPH data op (the Obsidian-view). Assembles the workspace's knowledge as nodes (context
//? sources, tickets, content pieces) + edges: SIMILARITY edges (cosine over the RAG embedder — keyless lexical
//? fallback when no API key, so this works offline) + explicit LINK edges. Tenant-scoped read (no write). The
//? similarity-edge builder is pure + unit-tested; `buildKnowledgeGraph` is the DB-backed assembler. N2 renders it.

import type { PrismaClient } from '@prisma/client';

import { embedTexts, cosine } from './embed';

export type GraphNodeType = 'source' | 'ticket' | 'piece';
export interface GraphNode { id: string; type: GraphNodeType; label: string }
export interface GraphEdge { from: string; to: string; kind: 'similarity' | 'link'; weight: number }
export interface KnowledgeGraph { nodes: GraphNode[]; edges: GraphEdge[] }

//? Pure — the top-K most-similar UNDIRECTED similarity edges between embedded nodes (cosine ≥ minScore). Dedup by
//? the unordered {from,to} pair; self-edges skipped. `topK` bounds fan-out per node so a dense graph stays readable.
export function similarityEdges(nodes: { id: string; vec: number[] }[], opts: { topK?: number; minScore?: number } = {}): GraphEdge[] {
  const topK = opts.topK ?? 4;
  const minScore = opts.minScore ?? 0.3;
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const a of nodes) {
    const scored = nodes
      .filter((b) => b.id !== a.id)
      .map((b) => ({ id: b.id, score: cosine(a.vec, b.vec) }))
      .filter((s) => s.score >= minScore)
      .toSorted((x, y) => y.score - x.score)
      .slice(0, topK);
    for (const s of scored) {
      const key = [a.id, s.id].toSorted((p, q) => (p < q ? -1 : 1)).join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: a.id, to: s.id, kind: 'similarity', weight: Math.round(s.score * 100) / 100 });
    }
  }
  return edges;
}

//? Assemble the workspace knowledge graph: nodes from the context sources + tickets + content pieces, similarity
//? edges from their embedded text, and explicit LINK edges (a content piece → its project's owning dev ticket is
//? not modelled, so link edges stay empty for now — extensible). Bounded per type so the embed pass stays cheap.
export async function buildKnowledgeGraph(prisma: PrismaClient, workspaceId: string, opts: { topK?: number; minScore?: number } = {}): Promise<KnowledgeGraph> {
  const [sources, tickets, pieces] = await Promise.all([
    prisma.infoSource.findMany({ where: { workspaceId, enabled: true }, select: { id: true, name: true, content: true }, take: 100 }),
    prisma.ticket.findMany({ where: { workspaceId, archived: false }, select: { id: true, key: true, title: true, description: true }, take: 200, orderBy: { lastActivityAt: 'desc' } }),
    prisma.contentProject.findMany({ where: { workspaceId }, select: { id: true, title: true }, take: 100 }),
  ]);

  const nodes: GraphNode[] = [
    ...sources.map((s): GraphNode => ({ id: `source:${s.id}`, type: 'source', label: s.name })),
    ...tickets.map((t): GraphNode => ({ id: `ticket:${t.id}`, type: 'ticket', label: `${t.key} · ${t.title}` })),
    ...pieces.map((p): GraphNode => ({ id: `piece:${p.id}`, type: 'piece', label: p.title })),
  ];

  //? The text each node is embedded on (label + any body). Empty graph short-circuits (no embed call).
  if (nodes.length === 0) return { nodes: [], edges: [] };
  const texts = [
    ...sources.map((s) => `${s.name}\n${(s.content ?? '').slice(0, 2000)}`),
    ...tickets.map((t) => `${t.title}\n${t.description ?? ''}`),
    ...pieces.map((p) => p.title),
  ];
  const vectors = await embedTexts(texts);
  const embedded = nodes.map((n, i) => ({ id: n.id, vec: vectors[i] ?? [] }));
  const edges = similarityEdges(embedded, opts);
  return { nodes, edges };
}
