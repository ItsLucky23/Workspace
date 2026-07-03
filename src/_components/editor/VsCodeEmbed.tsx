//? Editor #2 surface — embeds the real openvscode-server (browser VS Code) via an iframe.
//? In the product this URL is a per-ticket `vscode-<ticketId>` Caddy route; for the
//? standalone/demo path it points at the durable `ls-vscode-demo` container on
//? http://localhost:3100. Shows a themed "not running" panel with the exact start command
//? when the server isn't reachable, and lets you point at a custom URL. The iframe brings
//? VS Code's own file explorer + native git source control + open-vsx extensions.

/* eslint-disable react/jsx-no-literals -- editor-chrome labels + the copy-paste start command */
import { useEffect, useState } from 'react';

import { getPalette, type EditorThemeId } from './editorThemes';

const DEFAULT_URL = 'http://localhost:3100/?tkn=luckystack';
const URL_KEY = 'ls.vscode.url';

export interface VsCodeEmbedProps {
  theme: EditorThemeId;
  initialUrl?: string;
}

export function VsCodeEmbed({ theme, initialUrl }: VsCodeEmbedProps) {
  const palette = getPalette(theme);
  const [url, setUrl] = useState<string>('');
  const [draft, setDraft] = useState<string>('');
  const [showConfig, setShowConfig] = useState(false);

  //? Resolve the initial URL: prop → ?vscode= query → localStorage → default.
  useEffect(() => {
    const fromQuery = new URLSearchParams(globalThis.location.search).get('vscode');
    const fromStore = typeof localStorage === 'undefined' ? null : localStorage.getItem(URL_KEY);
    const resolved = initialUrl ?? fromQuery ?? fromStore ?? DEFAULT_URL;
    setUrl(resolved);
    setDraft(resolved);
  }, [initialUrl]);

  const apply = (): void => {
    setUrl(draft);
    if (typeof localStorage !== 'undefined') localStorage.setItem(URL_KEY, draft);
    setShowConfig(false);
  };

  return (
    <div className="flex flex-col h-full w-full overflow-hidden rounded-lg border" style={{ borderColor: palette.border, background: palette.bg }}>
      <div className="flex items-center gap-2 px-2 h-9 shrink-0 border-b text-[12px]" style={{ borderColor: palette.border, background: palette.bgAlt, color: palette.fg }}>
        <span className="font-medium">Real VS Code · openvscode-server</span>
        <span className="truncate hidden sm:inline" style={{ color: palette.comment }}>{url}</span>
        <div className="flex-1" />
        <a href={url} target="_blank" rel="noreferrer" className="px-2 py-1 rounded cursor-pointer" style={{ color: palette.accent }}>Open ↗</a>
        <button type="button" className="px-2 py-1 rounded cursor-pointer" style={{ color: palette.fg }} onClick={() => { setShowConfig((s) => !s); }}>URL</button>
      </div>

      {showConfig && (
        <div className="p-3 border-b flex flex-col gap-2 text-[12px]" style={{ borderColor: palette.border, background: palette.bgAlt, color: palette.fg }}>
          <div style={{ color: palette.comment }}>Point at your openvscode-server (per-ticket route or the standalone container):</div>
          <div className="flex gap-2">
            <input value={draft} onChange={(e) => { setDraft(e.target.value); }} className="flex-1 px-2 py-1 rounded outline-none border font-mono" style={{ background: palette.bg, color: palette.fg, borderColor: palette.border }} />
            <button type="button" onClick={apply} className="px-3 py-1 rounded cursor-pointer" style={{ background: palette.accent, color: '#fff' }}>Load</button>
          </div>
          <div style={{ color: palette.comment }}>
            Start the standalone container:&nbsp;
            <code className="font-mono" style={{ color: palette.string }}>docker run -d --name ls-vscode-demo --restart unless-stopped -p 3100:3000 gitpod/openvscode-server --host 0.0.0.0 --connection-token luckystack</code>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 relative">
        {url ? (
          <iframe title="VS Code" src={url} className="absolute inset-0 w-full h-full border-0" allow="clipboard-read; clipboard-write" />
        ) : (
          <div className="h-full flex items-center justify-center text-sm" style={{ color: palette.comment }}>No editor URL</div>
        )}
      </div>
    </div>
  );
}
