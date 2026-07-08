//? N1 — the pure similarity-edge builder (the graph's edges). Verifies: only pairs above minScore get an edge;
//? edges are UNDIRECTED + deduped (one per unordered pair); self-edges are skipped; and topK bounds each node's
//? fan-out. Cosine over fixed vectors → deterministic.

import { assert, eq, report } from '../_helpers.mts';
import { similarityEdges } from '../../server/rag/graph.ts';

// A≈B (near-parallel), C orthogonal → only the A–B edge clears minScore
{
  const nodes = [
    { id: 'a', vec: [1, 0] },
    { id: 'b', vec: [0.95, 0.05] },
    { id: 'c', vec: [0, 1] },
  ];
  const edges = similarityEdges(nodes, { topK: 4, minScore: 0.3 });
  eq(edges.length, 1, 'only the one above-threshold pair gets an edge');
  const e = edges[0];
  assert((e.from === 'a' && e.to === 'b') || (e.from === 'b' && e.to === 'a'), 'the A–B edge');
  eq(e.kind, 'similarity', 'it is a similarity edge');
  assert(e.weight > 0.9, 'the weight is the (high) cosine score');
}

// undirected dedup — a fully-similar trio yields 3 edges (not 6)
{
  const nodes = [{ id: 'x', vec: [1, 1] }, { id: 'y', vec: [1, 1] }, { id: 'z', vec: [1, 1] }];
  const edges = similarityEdges(nodes, { topK: 4, minScore: 0.3 });
  eq(edges.length, 3, 'a similar trio → 3 undirected edges (x-y, x-z, y-z), not 6 directed');
  assert(!edges.some((e) => e.from === e.to), 'no self-edges');
}

// topK bounds fan-out
{
  const nodes = Array.from({ length: 6 }, (_, i) => ({ id: `n${String(i)}`, vec: [1, 1] }));
  const edges = similarityEdges(nodes, { topK: 1, minScore: 0.3 });
  //? each node keeps its top-1; after undirected dedup the count is ≤ nodes.length.
  assert(edges.length <= nodes.length, 'topK=1 keeps the graph sparse');
}

// minScore filters everything
eq(similarityEdges([{ id: 'a', vec: [1, 0] }, { id: 'b', vec: [0, 1] }], { minScore: 0.5 }).length, 0, 'orthogonal nodes → no edge');
eq(similarityEdges([], {}).length, 0, 'no nodes → no edges');

report('tests/unit/knowledgeGraph.test.mts');
