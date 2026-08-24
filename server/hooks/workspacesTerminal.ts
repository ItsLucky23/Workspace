//? Workspaces browser terminal: Socket.io ⇄ the pty-agent / `docker exec` shell INSIDE the exact
//? workspace ticket container. There is deliberately NO host-shell mode — not for members, workspace
//? owners, host superadmins, development, or production. The product terminal is a repo-container tool;
//? host administration belongs outside the application control plane.
//?
//? ONE deliberate, narrow exception (ADR 0324): the SEAT-LOGIN PTY. A host superadmin can open the
//? subscription-seat login flow (`claude /login`, or the pi TUI pinned to openai-codex) in the browser
//? so a fresh install never needs an SSH session to sign the coding seat in. The client names a SEAT,
//? never a command — the argv is a fixed server-side constant — so this is still not a host shell.
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

import { buildClaudeCliEnv, claudeCliBin } from '../ai/providers/claudeCli';
import { buildPiCliEnv, piCliBin } from '../ai/providers/piCli';
import { CAP, hasCapability } from '../control/rbac';
import {
  DOCKER_BIN,
  PTY_AGENT_PORT,
  containerName,
  docker,
  isWorkspaceTicketContainer,
} from '../container/runtime';
import { connectPtyAgent, resolvePtyAgentPort } from '../container/ptyAgentClient';
import { refreshProjectedClaudeAuth } from '../orchestrator/codingAgents/claudeCode';
import { refreshProjectedPiAuth } from '../orchestrator/codingAgents/piAgent';
import { broadcastWorkspaceDirty } from '../read/broadcast';
import { resetHostReadiness } from '../read/readiness';
import { isHostSuperadmin } from '../security/hostSuperadmin';

export type SeatLoginSeat = 'claude' | 'codex';

interface TermMsg {
  id: string;
  cols?: number;
  rows?: number;
  data?: string;
  workspaceId?: string;
  ticketKey?: string;
  seat?: SeatLoginSeat;
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
    ...(row.seat === 'claude' || row.seat === 'codex' ? { seat: row.seat } : {}),
  };
}

//? Pure: the FIXED argv per seat — the client only ever names a seat, never a command. `claude /login`
//? opens Claude Code straight into its login flow; pi has no login subcommand (verified 0.84.2: `pi auth`
//? is print/check only), so the Codex seat opens the pi TUI pinned to openai-codex, where `/login` runs
//? the OAuth flow. On Windows the pi bin is an npm `.cmd` shim conpty cannot exec directly — wrap in cmd.exe.
export function seatLoginCommand(seat: SeatLoginSeat, platform: NodeJS.Platform = process.platform): { file: string; args: string[] } {
  if (seat === 'claude') return { file: claudeCliBin(), args: ['/login'] };
  const piArgs = ['--provider', 'openai-codex'];
  return platform === 'win32'
    ? { file: 'cmd.exe', args: ['/c', piCliBin(), ...piArgs] }
    : { file: piCliBin(), args: piArgs };
}

export interface SeatLoginAuthorizationDependencies {
  getIdentity: (userId: string) => Promise<{ admin?: boolean | null; email?: string | null } | null>;
}

const seatLoginAuthorizationDependencies: SeatLoginAuthorizationDependencies = {
  getIdentity: async (userId) => await getPrismaClient().user.findUnique({ where: { id: userId }, select: { admin: true, email: true } }),
};

//? Seat login is HOST-level — it writes the host CLI's OAuth store, which every workspace's pipeline
//? borrows — so workspace RBAC is the wrong gate: only a host superadmin (User.admin or
//? WS_SUPERADMIN_EMAILS, ADR 0287) may open it. Exported with injected deps for unit tests.
export async function authorizeSeatLogin(
  userId: string,
  dependencies: SeatLoginAuthorizationDependencies = seatLoginAuthorizationDependencies,
): Promise<boolean> {
  if (userId.length === 0) return false;
  const identity = await dependencies.getIdentity(userId);
  return identity !== null && isHostSuperadmin(identity);
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
      // Anonymous sockets are required for login/register API traffic. They receive no terminal
      // listeners; terminal authorization still requires a valid session before handlers exist.
      if (sessionError || !session) {
        next();
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

      //? Seat-login PTY (ADR 0324): fixed argv on the HOST, allowlist-only child env (no app/db/provider
      //? secrets cross into the CLI). A login flow lasts minutes, never stands — hard wall-clock cap;
      //? interrupt before kill because a hard kill of a live CLI crashes Windows conpty (lesson 0009).
      const SEAT_LOGIN_TIMEOUT_MS = 15 * 60_000;
      const attachSeatLoginPty = (id: string, seat: SeatLoginSeat, workspaceId: string | undefined, cols: number, rows: number): void => {
        const { file, args } = seatLoginCommand(seat);
        const env = seat === 'claude'
          ? { ...buildClaudeCliEnv(), TERM: 'xterm-256color' }
          : { ...buildPiCliEnv(), TERM: 'xterm-256color' };
        const [spawnError, term] = tryCatchSync(() => pty.spawn(file, args, { name: 'xterm-256color', cols, rows, cwd: process.cwd(), env }));
        if (spawnError || !term) { emitExit(id, 1); return; }
        const timer = setTimeout(() => {
          tryCatchSync(() => { term.write('\u0003'); });
          setTimeout(() => { tryCatchSync(() => { term.kill(); }); }, 1500);
        }, SEAT_LOGIN_TIMEOUT_MS);
        sessions.set(id, fromPty(term));
        term.onData((data) => { socket.emit('ws-term:out', { id, data }); });
        term.onExit(({ exitCode }) => {
          clearTimeout(timer);
          //? The flow's whole point: pull the fresh host credentials into the container projection and
          //? recompute host readiness, then ping the room so every open client sees the seat turn green.
          tryCatchSync(() => { if (seat === 'claude') refreshProjectedClaudeAuth(); else refreshProjectedPiAuth('openai-codex'); });
          resetHostReadiness();
          if (workspaceId !== undefined && WORKSPACE_ID.test(workspaceId)) broadcastWorkspaceDirty(workspaceId);
          emitExit(id, exitCode);
          sessions.delete(id);
        });
        getLogger().info(`[workspaces] seat-login PTY opened (seat=${seat}, user=${session.id})`);
      };

      socket.on('ws-term:start', (raw: unknown) => {
        const payload = readTermMsg(raw);
        if (!payload || sessions.has(payload.id) || starting.has(payload.id)) return;
        starting.add(payload.id);
        void (async () => {
          if (payload.seat !== undefined) {
            const seat = payload.seat;
            if (!(await authorizeSeatLogin(session.id))) { emitExit(payload.id, 126); return; }
            attachSeatLoginPty(
              payload.id, seat, payload.workspaceId,
              Math.max(20, Math.min(400, Math.round(payload.cols ?? 80))),
              Math.max(5, Math.min(200, Math.round(payload.rows ?? 24))),
            );
            return;
          }

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
