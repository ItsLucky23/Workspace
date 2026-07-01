// scripts/generateGraph.mjs
//
// Regenerates docs/ai-graph.json — the project's dependency graph, so an AI can
// answer the structural questions a flat index can't: "what (transitively)
// depends on this file?", "what is the blast radius of changing it?", "which
// files are god-nodes everything leans on?".
//
// Two layers, both committed to docs/ai-graph.json:
//   1. FILE/IMPORT level — nodes are source files (classified api/sync/page/
//      helper/component/other), edges are resolved `import` relations, and
//      `blastRadius` is transitive reverse-reachability (file change-impact).
//      Regex-based, fast, no compiler.
//   2. SYMBOL level — function-to-function `callEdges` resolved with the
//      TypeScript TypeChecker (`symbols`, `callEdges`, `symbolBlastRadius`), so
//      "what calls THIS function / what breaks if I change it" is answered per
//      function, not just per file. Uses the `typescript` package directly (a
//      consumer devDependency) against tsconfig.server.json.
//
// Edge-coverage honesty (like the Zod emitter's z.any() fallbacks): calls
// routed through the `functions.*` injection proxy resolve to the GENERATED
// type file and are intentionally skipped; dynamic `import()`, calls via
// interface/abstract types, and deeply-aliased re-exports may be missed. Calls
// outside any named scope attribute to a per-file `<module>` caller. The symbol
// pass degrades gracefully to import-level only if the program can't be built,
// or is skipped above SYMBOL_FILE_CAP files to protect commit time on huge
// repos. Spec: docs/decisions/0002 + 0004 + 0006.
//
// Deterministic: sorted keys, POSIX paths, NO timestamps and NO commit SHA (a
// SHA would dirty the file every commit and defeat the clean-diff guarantee).
// The pre-commit hook regenerates it from disk, so the committed graph always
// matches the committed code.
//
// KEEP IN SYNC with packages/create-luckystack-app/template/scripts/
// generateGraph.mjs (byte-for-byte duplicate ships to consumers).

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const SRC_DIR = path.join(REPO_ROOT, "src");
const OUTPUT_FILE = path.join(REPO_ROOT, "docs", "ai-graph.json");

const GOD_NODE_LIMIT = 25; // top-N most-depended-upon files surfaced explicitly
const SYMBOL_FILE_CAP = 2500; // skip the TS-compiler pass above this many program files

const safe = async (promise) => {
  try { return [null, await promise]; } catch (error) { return [error, null]; }
};
const safeSync = (fn) => {
  try { return [null, fn()]; } catch (error) { return [error, null]; }
};

const toPosix = (p) => p.replaceAll("\\", "/");
const relFromRepo = (abs) => toPosix(path.relative(REPO_ROOT, abs));
const relFromSrc = (abs) => toPosix(path.relative(SRC_DIR, abs));

const walkFiles = async (rootDir, predicate) => {
  const out = [];
  const [statErr, stat] = await safe(fs.stat(rootDir));
  if (statErr || !stat.isDirectory()) return out;
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const [readErr, entries] = await safe(fs.readdir(current, { withFileTypes: true }));
    if (readErr) continue;
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(abs);
      else if (entry.isFile() && predicate(entry.name, abs)) out.push(abs);
    }
  }
  return out.sort();
};

const readTextFile = async (absPath) => {
  const [err, content] = await safe(fs.readFile(absPath, "utf8"));
  return err ? null : content;
};

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const SOURCE_RE = /\.(ts|tsx)$/;
const isSource = (name) => SOURCE_RE.test(name) && !name.endsWith(".d.ts") && !name.endsWith(".generated.ts");

const classify = (relSrc, name) => {
  if (/(^|\/)_api\/[A-Za-z0-9_-]+_v\d+\.ts$/.test(relSrc)) return "api";
  if (/(^|\/)_sync\/[A-Za-z0-9_-]+_(server|client)_v\d+\.ts$/.test(relSrc)) return "sync";
  if (name === "page.tsx") return "page";
  if (relSrc.startsWith("_functions/")) return "helper";
  if (relSrc.startsWith("_components/")) return "component";
  return "other";
};

const routeOf = (relSrc) => {
  const a = relSrc.match(/^(.*)\/_api\/([A-Za-z0-9_-]+)_v(\d+)\.ts$/);
  if (a) return `api/${a[1]}/${a[2]}/v${a[3]}`;
  const s = relSrc.match(/^(.*)\/_sync\/([A-Za-z0-9_-]+)_(server|client)_v(\d+)\.ts$/);
  if (s) return `sync/${s[1]}/${s[2]}/v${s[4]}`;
  return null;
};

// ---------------------------------------------------------------------------
// Import extraction + resolution (mirrors generateProjectIndex.mjs)
// ---------------------------------------------------------------------------

const extractImportSources = (src) => {
  const out = new Set();
  const re = /(?:import|export)\s+(?:type\s+)?(?:[^'"\n]*?\s+from\s+)?['"]([^'"\n]+)['"]/g;
  const dyn = /import\(\s*['"]([^'"\n]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) out.add(m[1]);
  while ((m = dyn.exec(src)) !== null) out.add(m[1]);
  return [...out];
};

// Resolve an import specifier (from `importerRel`, a src-relative file) to a
// src-relative file id that exists in `fileSet`, or null if it's external / not
// under src/. Handles relative (./ ../) and the `src/` path alias.
const resolveTarget = (importerRel, spec, fileSet) => {
  let baseNoExt = null;
  if (spec.startsWith(".")) {
    const importerDir = path.posix.dirname(importerRel);
    baseNoExt = toPosix(path.posix.normalize(path.posix.join(importerDir, spec)));
    if (baseNoExt.startsWith("..")) return null;
  } else if (spec.startsWith("src/")) {
    baseNoExt = spec.slice("src/".length);
  } else {
    return null; // package / shared / config / node builtin — not a src node
  }
  baseNoExt = baseNoExt.replace(/\.(tsx?|jsx?|mjs)$/, "");
  for (const cand of [`${baseNoExt}.ts`, `${baseNoExt}.tsx`, `${baseNoExt}/index.ts`, `${baseNoExt}/index.tsx`]) {
    if (fileSet.has(cand)) return cand;
  }
  return null;
};

// ---------------------------------------------------------------------------
// Symbol-level call graph (TypeScript TypeChecker)
// ---------------------------------------------------------------------------

// Build a ts.Program from tsconfig.server.json (fallback tsconfig.json). Returns
// null on any failure so the import-level graph still ships.
const buildProgram = () => {
  const configPath =
    ts.findConfigFile(REPO_ROOT, ts.sys.fileExists, "tsconfig.server.json") ??
    ts.findConfigFile(REPO_ROOT, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) return null;
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) return null;
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(configPath));
  if (parsed.fileNames.length === 0) return null;
  return ts.createProgram(parsed.fileNames, parsed.options);
};

// A source file's path as a src-relative id, or null if it isn't under src/ or
// is a generated/declaration file.
const srcIdOf = (fileName) => {
  const rel = toPosix(path.relative(SRC_DIR, fileName));
  if (rel.startsWith("..") || rel.endsWith(".d.ts") || rel.includes(".generated.")) return null;
  return rel;
};

// If `node` introduces a named caller scope, return { name, kind }; else null.
// Covers function declarations, const/let arrow|function expressions, object-
// literal method properties, and named function/method declarations. Calls
// outside any named scope attribute to a synthetic `<module>` caller per file,
// so coverage is complete (every resolvable call edge is recorded, attributed
// to the nearest enclosing name).
const namedScopeOf = (node) => {
  if (ts.isFunctionDeclaration(node) && node.name) return { name: node.name.text, kind: "function" };
  if ((ts.isMethodDeclaration(node) || ts.isFunctionExpression(node)) && node.name && ts.isIdentifier(node.name)) {
    return { name: node.name.text, kind: "method" };
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
    (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
    return { name: node.name.text, kind: "function" };
  }
  if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.initializer &&
    (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
    return { name: node.name.text, kind: "method" };
  }
  return null;
};

// Resolve a call/new callee expression to its declared { file, name }, or null.
const resolveCallee = (expr, checker) => {
  let sym = checker.getSymbolAtLocation(expr);
  if (!sym && ts.isPropertyAccessExpression(expr)) sym = checker.getSymbolAtLocation(expr.name);
  if (!sym) return null;
  if (sym.flags & ts.SymbolFlags.Alias) {
    try { sym = checker.getAliasedSymbol(sym); } catch { /* keep original */ }
  }
  const decl = sym.declarations?.[0];
  if (!decl) return null;
  return { file: decl.getSourceFile().fileName, name: sym.getName() };
};

const collectSymbolGraph = (fileSet) => {
  let program;
  try { program = buildProgram(); } catch { return null; }
  if (!program) return null;
  if (program.getSourceFiles().length > SYMBOL_FILE_CAP) {
    console.error(`[ai:graph] symbol pass skipped: ${program.getSourceFiles().length} program files > cap ${SYMBOL_FILE_CAP} (import-level graph still emitted).`);
    return null;
  }
  const checker = program.getTypeChecker();

  const symbols = new Map(); // id -> { id, file, name, kind }
  const addSymbol = (file, name, kind) => {
    const id = `${file}::${name}`;
    if (!symbols.has(id)) symbols.set(id, { id, file, name, kind });
    return id;
  };
  const callEdgeSet = new Set();

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    const callerFile = srcIdOf(sf.fileName);
    if (!callerFile || !fileSet.has(callerFile)) continue;
    // Single recursive walk tracking the nearest enclosing named scope; a call
    // outside any named scope attributes to a synthetic `<module>` caller, so
    // every resolvable in-project call edge is captured.
    const walk = (node, callerId) => {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const target = resolveCallee(node.expression, checker);
        if (target) {
          const calleeFile = srcIdOf(target.file);
          if (calleeFile && fileSet.has(calleeFile)) {
            const calleeId = addSymbol(calleeFile, target.name, "fn");
            //? Join edge endpoints with `\n` (not a raw space): a src id is
            //? `<posix-path>::<symbol-name>` and a path segment or identifier
            //? CAN contain a space (`My Widget.tsx`), which would corrupt a
            //? space-split edge key. `\n` can appear in neither.
            if (calleeId !== callerId) callEdgeSet.add(`${callerId}\n${calleeId}`);
          }
        }
      }
      const named = namedScopeOf(node);
      const childCaller = named ? addSymbol(callerFile, named.name, named.kind) : callerId;
      ts.forEachChild(node, (c) => walk(c, childCaller));
    };
    walk(sf, addSymbol(callerFile, "<module>", "module"));
  }

  const symbolList = [...symbols.values()].sort((a, b) => a.id.localeCompare(b.id));
  const callEdges = [...callEdgeSet].map((k) => {
    const [from, to] = k.split("\n");
    return { from, to };
  }).sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  // symbol blast-radius: transitive reverse-reachability over callEdges.
  const reverse = new Map();
  for (const s of symbolList) reverse.set(s.id, new Set());
  for (const e of callEdges) reverse.get(e.to)?.add(e.from);
  const memo = new Map();
  const callersOf = (id, stack = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    if (stack.has(id)) return new Set();
    stack.add(id);
    const acc = new Set();
    for (const c of reverse.get(id) ?? []) { acc.add(c); for (const t of callersOf(c, stack)) acc.add(t); }
    stack.delete(id);
    memo.set(id, acc);
    return acc;
  };
  const symbolBlastRadius = {};
  for (const s of symbolList) {
    const callers = [...callersOf(s.id)].sort();
    if (callers.length > 0) symbolBlastRadius[s.id] = callers;
  }

  return { symbols: symbolList, callEdges, symbolBlastRadius };
};

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const build = async () => {
  const absFiles = await walkFiles(SRC_DIR, (name) => isSource(name));
  const nodes = absFiles.map((abs) => {
    const rel = relFromSrc(abs);
    return { id: rel, kind: classify(rel, path.basename(abs)), route: routeOf(rel) };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const fileSet = new Set(nodes.map((n) => n.id));

  // edges: importer -> imported (both src-relative ids)
  const edgeSet = new Set();
  const forward = new Map(); // id -> Set(imported)
  const reverse = new Map(); // id -> Set(importers)
  for (const id of fileSet) { forward.set(id, new Set()); reverse.set(id, new Set()); }

  for (const abs of absFiles) {
    const importerRel = relFromSrc(abs);
    const src = await readTextFile(abs);
    if (src === null) continue;
    for (const spec of extractImportSources(src)) {
      const target = resolveTarget(importerRel, spec, fileSet);
      if (!target || target === importerRel) continue;
      //? `\n`-joined edge key (not a raw space): a src-relative path can
      //? contain a space (`My Widget.tsx`), which a space-split would corrupt.
      const key = `${importerRel}\n${target}`;
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);
      forward.get(importerRel).add(target);
      reverse.get(target).add(importerRel);
    }
  }

  const edges = [...edgeSet].map((k) => {
    const [from, to] = k.split("\n");
    return { from, to };
  }).sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  // blast radius = transitive reverse-reachability (everything that would be
  // affected by changing a file). Memoized DFS over the reverse graph.
  const memo = new Map();
  const dependentsOf = (id, stack = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    if (stack.has(id)) return new Set(); // cycle guard
    stack.add(id);
    const acc = new Set();
    for (const importer of reverse.get(id) ?? []) {
      acc.add(importer);
      for (const t of dependentsOf(importer, stack)) acc.add(t);
    }
    stack.delete(id);
    memo.set(id, acc);
    return acc;
  };

  const blastRadius = {};
  for (const n of nodes) {
    const deps = [...dependentsOf(n.id)].sort();
    if (deps.length > 0) blastRadius[n.id] = deps;
  }

  const godNodes = nodes
    .map((n) => ({ id: n.id, kind: n.kind, dependents: (blastRadius[n.id] ?? []).length, directDependents: (reverse.get(n.id) ?? new Set()).size }))
    .filter((g) => g.dependents > 0)
    .sort((a, b) => b.dependents - a.dependents || a.id.localeCompare(b.id))
    .slice(0, GOD_NODE_LIMIT);

  // Layer 2: symbol-level call graph (degrades to null on compiler failure / cap).
  const symbolGraph = collectSymbolGraph(fileSet);

  return {
    version: 2,
    note: "Dependency graph, ids relative to src/. File level: blastRadius[file] = files transitively importing it. Symbol level: callEdges are function->function calls; symbolBlastRadius['file::fn'] = symbols transitively calling it. <module> = file top-level scope. functions.* injection-proxy / dynamic-import / interface-typed calls are intentionally not resolved. See docs/decisions/0002,0004,0006.",
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      symbols: symbolGraph?.symbols.length ?? 0,
      callEdges: symbolGraph?.callEdges.length ?? 0,
    },
    nodes,
    edges,
    blastRadius,
    godNodes,
    symbols: symbolGraph?.symbols ?? [],
    callEdges: symbolGraph?.callEdges ?? [],
    symbolBlastRadius: symbolGraph?.symbolBlastRadius ?? {},
  };
};

const main = async () => {
  const graph = await build();
  // Stable 2-space JSON. Object key order is deterministic (we control it).
  const json = `${JSON.stringify(graph, null, 2)}\n`;

  const [mkErr] = await safe(fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true }));
  if (mkErr) { console.error(`[ai:graph] failed to ensure docs directory: ${mkErr.message}`); process.exit(1); }
  const [writeErr] = await safe(fs.writeFile(OUTPUT_FILE, json, "utf8"));
  if (writeErr) { console.error(`[ai:graph] failed to write ${OUTPUT_FILE}: ${writeErr.message}`); process.exit(1); }

  console.log(`[ai:graph] generated ${relFromRepo(OUTPUT_FILE)} (${graph.counts.nodes} files, ${graph.counts.edges} import-edges, ${graph.counts.symbols} symbols, ${graph.counts.callEdges} call-edges, ${graph.godNodes.length} god-nodes)`);
};

const [runErr] = await safe(main());
if (runErr) {
  safeSync(() => console.error(`[ai:graph] fatal: ${runErr.stack ?? runErr.message ?? runErr}`));
  process.exit(1);
}
