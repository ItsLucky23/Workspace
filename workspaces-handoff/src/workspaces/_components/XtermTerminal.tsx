//? Workspaces — a REAL terminal. xterm.js in the browser ⇄ a node-pty shell on
//? the backend, over the framework's authenticated Socket.io connection (see
//? server/hooks/workspacesTerminal.ts). Dev-only on the server side.
//?
//? Sessions PERSIST across mounts: the xterm instance + its DOM element live in
//? a module-level registry keyed by `sessionId`, and we do NOT kill the PTY on
//? unmount — switching tabs / pages just detaches the element and re-attaches it
//? later, so scrollback + the live shell survive. (The backend keeps the PTY
//? alive for the lifetime of the socket connection.)
//?
//? Note: `@luckystack/core/client` types the live `socket` as `null` (it's only
//? populated at runtime), so we treat the awaited value as `unknown` and narrow
//? to a small `LiveSocket` shape covering just the events this terminal uses.

import { useEffect, useRef } from 'react';

import { waitForSocket } from '@luckystack/core/client';

import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

interface TermMsg { id: string; data?: string; exitCode?: number }
interface LiveSocket {
  on(event: string, listener: (payload: TermMsg) => void): void;
  emit(event: string, payload: object): void;
}

const ESC = String.fromCodePoint(27);
const THEME = {
  background: '#0C1018', foreground: '#C9D4E3', cursor: '#58A6FF', cursorAccent: '#0C1018', selectionBackground: '#23324d',
  black: '#0C1018', red: '#F85149', green: '#3FB950', yellow: '#D29922', blue: '#58A6FF', magenta: '#BC8CFF', cyan: '#39C5CF', white: '#C9D4E3',
  brightBlack: '#6B7688', brightRed: '#F85149', brightGreen: '#3FB950', brightYellow: '#D29922', brightBlue: '#58A6FF', brightMagenta: '#BC8CFF', brightCyan: '#39C5CF', brightWhite: '#FFFFFF',
};

interface Session { term: Terminal; fit: FitAddon; el: HTMLDivElement; started: boolean }
const sessions = new Map<string, Session>();

let socketPromise: Promise<LiveSocket | null> | null = null;
const getSocket = (): Promise<LiveSocket | null> => {
  socketPromise ??= (async () => {
    const raw: unknown = await waitForSocket().catch(() => null);
    if (!raw) return null;
    return raw as LiveSocket;
  })();
  return socketPromise;
};

//? One global router writes incoming output to the right session's terminal.
let routed = false;
const ensureRouting = (): void => {
  if (routed) return;
  routed = true;
  void getSocket().then((s) => {
    if (!s) return;
    s.on('ws-term:out', (p) => { const e = sessions.get(p.id); if (e && p.data !== undefined) e.term.write(p.data); });
    s.on('ws-term:exit', (p) => { const e = sessions.get(p.id); if (e) e.term.write(`\r\n${ESC}[90m[process exited with code ${String(p.exitCode ?? 0)}]${ESC}[0m\r\n`); });
  });
};

export default function XtermTerminal({ sessionId, className }: { sessionId: string; className?: string }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = mountRef.current;
    if (!host) return;
    ensureRouting();

    let entry = sessions.get(sessionId);
    if (!entry) {
      const el = document.createElement('div');
      el.style.width = '100%';
      el.style.height = '100%';
      const term = new Terminal({ cursorBlink: true, fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', theme: THEME, scrollback: 4000 });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(el);
      term.onData((d) => { void getSocket().then((s) => s?.emit('ws-term:input', { id: sessionId, data: d })); });
      entry = { term, fit, el, started: false };
      sessions.set(sessionId, entry);
    }
    const e = entry;
    host.append(e.el);

    const doFit = () => {
      if (host.clientWidth > 0 && host.clientHeight > 0) {
        e.fit.fit();
        void getSocket().then((s) => s?.emit('ws-term:resize', { id: sessionId, cols: e.term.cols, rows: e.term.rows }));
      }
    };
    doFit();
    e.term.focus();

    if (!e.started) {
      e.started = true;
      void getSocket().then((s) => {
        if (!s) { e.term.write(`${ESC}[33mNot connected to the backend socket — start the server and sign in.${ESC}[0m\r\n`); return; }
        s.emit('ws-term:start', { id: sessionId, cols: e.term.cols, rows: e.term.rows });
      });
    }

    const ro = new ResizeObserver(() => doFit());
    ro.observe(host);

    return () => {
      //? Keep the session + PTY alive; just detach the element so it survives.
      ro.disconnect();
      if (e.el.parentNode === host) e.el.remove();
    };
  }, [sessionId]);

  return <div ref={mountRef} className={`bg-terminal-bg ${className ?? ''}`} />;
}
