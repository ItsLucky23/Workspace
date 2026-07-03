//? File model + flat-paths → nested-tree builder, shared by the Monaco file explorer and
//? the (later) real-repo browser. Kept framework-agnostic (no React) so the server-side
//? repo-read op can reuse the same shapes.

export interface EditorFile {
  path: string;      // POSIX path relative to the workspace root
  content: string;
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: FileTreeNode[];
}

//? Build a sorted nested tree (dirs first, then files, each alphabetical) from flat paths.
export function buildTree(paths: string[]): FileTreeNode[] {
  const root: FileTreeNode = { name: '', path: '', type: 'dir', children: [] };
  for (const full of paths) {
    const parts = full.split('/').filter(Boolean);
    let node = root;
    for (const [i, part] of parts.entries()) {
      const isFile = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join('/');
      node.children ??= [];
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, path, type: isFile ? 'file' : 'dir', ...(isFile ? {} : { children: [] }) };
        node.children.push(child);
      }
      node = child;
    }
  }
  const sort = (nodes: FileTreeNode[]): FileTreeNode[] => {
    nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : (a.type === 'dir' ? -1 : 1)));
    for (const n of nodes) if (n.children) sort(n.children);
    return nodes;
  };
  return sort(root.children ?? []);
}

//? Collect every directory path in a tree (for a default-expanded set).
export function allDirPaths(nodes: FileTreeNode[]): string[] {
  const out: string[] = [];
  const walk = (ns: FileTreeNode[]): void => {
    for (const n of ns) {
      if (n.type === 'dir') { out.push(n.path); if (n.children) walk(n.children); }
    }
  };
  walk(nodes);
  return out;
}
