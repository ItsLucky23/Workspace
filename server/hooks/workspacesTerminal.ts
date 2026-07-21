//? Workspaces browser terminal: Socket.io ⇄ the pty-agent / `docker exec` shell INSIDE the exact
//? workspace ticket container. There is deliberately NO host-shell mode — not for members, workspace
//? owners, host superadmins, development, or production. The product terminal is a repo-container tool;
//? host administration belongs outside the application control plane.
//?
//? Security boundary: the browser sends workspaceId + ticketKey, never a Docker object name. The server
//? authenticates the socket itself, checks workTickets in that workspace, derives the canonical container
//? name, and verifies its immutable workspace/ticket labels before opening a PTY.

import {
  extractTokenFromSocket,
  getLogger,
  getPrismaClient,
  readSession,
  registerSocketMiddleware,
  tryCatch,
  tryCatchSync,
} from '@luckystack/core';
import * as pty from 'node-pty';

import { CAP, hasCapability } from '../control/rbac';
import {
  DOCKER_BIN,
  PTY_AGENT_PORT,
  containerName,
  docker,
  isWorkspaceTicketContainer,
} from '../container/runtime';
import { connectPtyAgent, resolvePtyAgentPort } from '../container/ptyAgentClient';

interface TermMsg {
  id: string;
  cols?: number;
  rows?: number;
  data?: string;
  workspaceId?: string;
  ticketKey?: string;
}

interface TermHandle {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
}

const fromPty = (term: pty.IPty): TermHandle => ({
  write: (data) => { term.write(data); },
  resize: (cols, rows) => { term.resize(cols, rows); },
  kill: () => { term.kill(); },
});

const WORKSPACE_ID = /^[a-fA-F0-9]{24}$/;
const TICKET_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SESSION_ID = /^[A-Za-z0-9:._-]{1,240}$/;

function readTermMsg(value: unknown): TermMsg | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || !SESSION_ID.test(row.id)) return null;
  return {
    id: row.id,
    ...(typeof row.cols === 'number' && Number.isFinite(row.cols) ? { cols: row.cols } : {}),
    ...(typeof row.rows === 'number' && Number.isFinite(row.rows) ? { rows: row.rows } : {}),
    ...(typeof row.data === 'string' ? { data: row.data } : {}),
    ...(typeof row.workspaceId === 'string' ? { workspaceId: row.workspaceId } : {}),
    ...(typeof row.ticketKey === 'string' ? { ticketKey: row.ticketKey } : {}),
  };
}

export interface TerminalAuthorizationDependencies {
  hasWorkTickets: (workspaceId: string, userId: string) => Promise<boolean>;
  matchesContainer: (name: string, workspaceId: string, ticketKey: string) => Promise<boolean>;
}

const terminalAuthorizationDependencies: TerminalAuthorizationDependencies = {
  hasWorkTickets: (workspaceId, userId) => hasCapability(getPrismaClient(), workspaceId, userId, CAP.workTickets),
  matchesContainer: isWorkspaceTicketContainer,
};

//? Resolve the ONLY container a terminal request may enter. Exported with injected dependencies so the
//? cross-tenant/capability policy is unit-testable without Docker, Redis, or a live socket.
export async function authorizeTerminalTarget(
  input: { workspaceId?: string; ticketKey?: string; userId: string },
  dependencies: TerminalAuthorizationDependencies = terminalAuthorizationDependencies,
): Promise<string | null> {
  const workspaceId = input.workspaceId ?? '';
  const ticketKey = input.ticketKey ?? '';
  if (!WORKSPACE_ID.test(workspaceId) || !TICKET_KEY.test(ticketKey) || input.userId.length === 0) return null;
  if (!(await dependencies.hasWorkTickets(workspaceId, input.userId))) return null;
  const name = containerName(workspaceId, ticketKey);
  return await dependencies.matchesContainer(name, workspaceId, ticketKey) ? name : null;
}

let registered = false;

export const registerWorkspacesTerminalHooks = (): void => {
  if (registered) return;
  registered = true;

  const dockerEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

  registerSocketMiddleware((socket, next) => {
    void (async () => {
      const token = extractTokenFromSocket(socket);
      const [sessionError, session] = token ? await tryCatch(() => readSession(token)) : [null, null];
      if (sessionError || !session) {
        next(new Error('terminal authentication required'));
        return;
      }

      const sessions = new Map<string, TermHandle>();
      const starting = new Set<string>();
      const emitExit = (id: string, exitCode: number): void => { socket.emit('ws-term:exit', { id, exitCode }); };

      const attachPty = (id: string, term: pty.IPty): void => {
        sessions.set(id, fromPty(term));
        term.onData((data) => { socket.emit('ws-term:out', { id, data }); });
        term.onExit(({ exitCode }) => { emitExit(id, exitCode); sessions.delete(id); });
      };

      const attachDockerPty = (id: string, target: string, cols: number, rows: number): void => {
        const [spawnError, term] = tryCatchSync(() => pty.spawn(
          DOCKER_BIN,
          ['exec', '-it', '-w', '/work', target, 'bash'],
          { name: 'xterm-256color', cols, rows, cwd: process.cwd(), env: { ...dockerEnv, TERM: 'xterm-256color' } },
        ));
        if (spawnError || !term) { emitExit(id, 1); return; }
        attachPty(id, term);
      };

      socket.on('ws-term:start', (raw: unknown) => {
        const payload = readTermMsg(raw);
        if (!payload || sessions.has(payload.id) || starting.has(payload.id)) return;
        starting.add(payload.id);
        void (async () => {
          const target = await authorizeTerminalTarget({
            workspaceId: payload.workspaceId,
            ticketKey: payload.ticketKey,
            userId: session.id,
          });
          if (!target) { emitExit(payload.id, 126); return; }

          const cols = Math.max(20, Math.min(400, Math.round(payload.cols ?? 80)));
          const rows = Math.max(5, Math.min(200, Math.round(payload.rows ?? 24)));
          const agentPort = await resolvePtyAgentPort(docker, target, PTY_AGENT_PORT);
          if (agentPort === null) { attachDockerPty(payload.id, target, cols, rows); return; }

          const connection = connectPtyAgent('127.0.0.1', agentPort, {
            onData: (data) => { socket.emit('ws-term:out', { id: payload.id, data }); },
            onExit: (exitCode) => { emitExit(payload.id, exitCode); sessions.delete(payload.id); },
            onError: () => {
              sessions.get(payload.id)?.kill();
              sessions.delete(payload.id);
              attachDockerPty(payload.id, target, cols, rows);
            },
          });
          sessions.set(payload.id, {
            write: connection.write,
            resize: connection.resize,
            kill: connection.close,
          });
          connection.resize(cols, rows);
        })().finally(() => { starting.delete(payload.id); });
      });

      socket.on('ws-term:input', (raw: unknown) => {
        const payload = readTermMsg(raw);
        if (!payload) return;
        sessions.get(payload.id)?.write((payload.data ?? '').slice(0, 64 * 1024));
      });

      socket.on('ws-term:resize', (raw: unknown) => {
        const payload = readTermMsg(raw);
        if (!payload) return;
        const term = sessions.get(payload.id);
        if (!term || payload.cols === undefined || payload.rows === undefined) return;
        const cols = Math.max(20, Math.min(400, Math.round(payload.cols)));
        const rows = Math.max(5, Math.min(200, Math.round(payload.rows)));
        term.resize(cols, rows);
      });

      socket.on('ws-term:kill', (raw: unknown) => {
        const payload = readTermMsg(raw);
        if (!payload) return;
        sessions.get(payload.id)?.kill();
        sessions.delete(payload.id);
      });

      socket.on('disconnect', () => {
        for (const term of sessions.values()) term.kill();
        sessions.clear();
        starting.clear();
      });

      next();
    })();
  });

  getLogger().info('[workspaces] workspace-scoped container terminal relay registered (host shell disabled)');
};
