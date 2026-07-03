//? Path → Monaco language id, plus a compact file-icon (glyph + color) for the explorer.
//? Covers the main frontend + backend languages. Monaco ships these grammars built-in;
//? no extra grammar loading needed for highlighting.

export interface LangDef {
  id: string;        // Monaco language id
  label: string;
  ext: string[];     // matching extensions (no dot) or exact basenames
  icon: string;      // single glyph shown in the file tree
  color: string;     // icon color (hex)
}

//? Ordered; first match wins. Basenames (e.g. 'dockerfile') match the whole filename.
const LANGS: LangDef[] = [
  { id: 'typescript', label: 'TypeScript', ext: ['ts', 'tsx', 'mts', 'cts'], icon: 'TS', color: '#3178c6' },
  { id: 'javascript', label: 'JavaScript', ext: ['js', 'jsx', 'mjs', 'cjs'], icon: 'JS', color: '#e0af68' },
  { id: 'json', label: 'JSON', ext: ['json', 'jsonc'], icon: '{}', color: '#cbcb41' },
  { id: 'html', label: 'HTML', ext: ['html', 'htm'], icon: '<>', color: '#e34c26' },
  { id: 'css', label: 'CSS', ext: ['css'], icon: '#', color: '#563d7c' },
  { id: 'scss', label: 'SCSS', ext: ['scss', 'sass'], icon: '#', color: '#c76494' },
  { id: 'less', label: 'Less', ext: ['less'], icon: '#', color: '#1d365d' },
  { id: 'markdown', label: 'Markdown', ext: ['md', 'mdx', 'markdown'], icon: 'M↓', color: '#519aba' },
  { id: 'python', label: 'Python', ext: ['py', 'pyw'], icon: 'Py', color: '#3572a5' },
  { id: 'go', label: 'Go', ext: ['go'], icon: 'Go', color: '#00add8' },
  { id: 'rust', label: 'Rust', ext: ['rs'], icon: 'Rs', color: '#dea584' },
  { id: 'java', label: 'Java', ext: ['java'], icon: 'Jv', color: '#b07219' },
  { id: 'kotlin', label: 'Kotlin', ext: ['kt', 'kts'], icon: 'Kt', color: '#a97bff' },
  { id: 'c', label: 'C', ext: ['c', 'h'], icon: 'C', color: '#555555' },
  { id: 'cpp', label: 'C++', ext: ['cpp', 'cc', 'cxx', 'hpp', 'hh'], icon: 'C+', color: '#f34b7d' },
  { id: 'csharp', label: 'C#', ext: ['cs'], icon: 'C#', color: '#178600' },
  { id: 'php', label: 'PHP', ext: ['php'], icon: 'Ph', color: '#4f5d95' },
  { id: 'ruby', label: 'Ruby', ext: ['rb'], icon: 'Rb', color: '#701516' },
  { id: 'sql', label: 'SQL', ext: ['sql'], icon: 'DB', color: '#e38c00' },
  { id: 'yaml', label: 'YAML', ext: ['yml', 'yaml'], icon: 'Y', color: '#cb171e' },
  { id: 'xml', label: 'XML', ext: ['xml', 'svg'], icon: '<>', color: '#0060ac' },
  { id: 'shell', label: 'Shell', ext: ['sh', 'bash', 'zsh'], icon: '$', color: '#89e051' },
  { id: 'dockerfile', label: 'Dockerfile', ext: ['dockerfile'], icon: '🐳', color: '#2496ed' },
  { id: 'graphql', label: 'GraphQL', ext: ['graphql', 'gql'], icon: 'GQ', color: '#e10098' },
  { id: 'toml', label: 'TOML', ext: ['toml'], icon: 'T', color: '#9c4221' },
];

const DEFAULT: LangDef = { id: 'plaintext', label: 'Plain Text', ext: [], icon: '≡', color: '#8b949e' };

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

function extOf(path: string): string {
  const name = basename(path).toLowerCase();
  //? Whole-name match first (Dockerfile, Makefile-like).
  return name.includes('.') ? (name.split('.').at(-1) ?? name) : name;
}

export function langDefForPath(path: string): LangDef {
  const name = basename(path).toLowerCase();
  const ext = extOf(path);
  return LANGS.find((l) => l.ext.includes(name) || l.ext.includes(ext)) ?? DEFAULT;
}

export function languageForPath(path: string): string {
  return langDefForPath(path).id;
}

export function iconForPath(path: string): { icon: string; color: string } {
  const d = langDefForPath(path);
  return { icon: d.icon, color: d.color };
}

//? The languages the demo/explorer advertises (for a language picker, docs).
export const SUPPORTED_LANGUAGES = LANGS.map((l) => ({ id: l.id, label: l.label }));
