//? The coding-harness ADAPTER seam (CODING_AGENT_PROGRAM.md §2.2, ADR 0322). `stageRunner.driveContainerTurn`
//? drives ONE interactive turn through this interface and never names a CLI. Everything the two harnesses
//? share stays in the runner (ownership fence, PTY lifecycle, capture polling, tool-trail drain, handoff);
//? everything that differs lives behind these methods. The capture FILES are shared by contract: both
//? harnesses write `/work/.claude/turn-stop.json` (`last_assistant_message` + `session_id`), append
//? `/work/.claude/tool-calls.jsonl`, and touch `/work/.claude/precompact-signal` — Claude via its hooks,
//? pi via the baked extension — so turnResult/toolTrail/handoff parse one shape.
//? @adr 0322

import type { DockerResult } from '../../container/runtime';
import type { CodingHarness, StageEffort } from '../../../src/workspaces/_data/types';

export type RunDocker = (args: string[]) => Promise<DockerResult>;

export interface TurnArgsInput {
  resumeSessionId?: string;
  model?: string;
  effort?: StageEffort;
}

export interface CodingAgentAdapter {
  id: CodingHarness;
  //? The in-container binary name (`docker exec -it <c> <binary> ...args`).
  binary: string;
  //? Needle for the procps-free /proc cmdline walk that stops the agent after a turn.
  processMatch: string;
  //? The pinned in-image CLI version (recorded on AgentSession.cliVersion).
  cliVersion: string;
  //? The per-turn argv after the binary. Pure.
  turnArgs(input: TurnArgsInput): string[];
  //? Host-side, BEFORE the container launches: make sure the projection dir holds this harness's credentials
  //? (the launch mounts the dir only when a projection exists).
  prepareHost?(): void;
  //? Copy the host's projected credentials into the agent-owned config dir inside the container and reset
  //? the turn capture. Runs before every turn (the projection is refreshed host-side first).
  projectAuth(container: string, runDocker: RunDocker): Promise<void>;
  //? Is the harness signed in INSIDE the container? Checked before a PTY is opened so an expired seat fails
  //? fast instead of burning a full timeout turn.
  authenticated(container: string, runDocker: RunDocker): Promise<boolean>;
  //? Optional post-turn hook (pi: persist the refreshed OAuth token back to the host projection).
  afterTurn?(container: string, runDocker: RunDocker): Promise<void>;
  //? PTY prompt-ready detection for this harness's TUI. Function PROPERTIES (not methods): the runner
  //? passes them around unbound (`adapter.trustOrReadyMatches ?? adapter.readyMatches`).
  readyMatches: (buffer: string) => boolean;
  //? Does the harness show a folder-trust prompt that needs a confirming Enter? (pi: `--approve` → no.)
  confirmsTrust: boolean;
  //? When `confirmsTrust`: the wider "trust prompt OR ready" predicate the runner waits on before the Enter.
  trustOrReadyMatches?: (buffer: string) => boolean;
}
//? Both harnesses surface a missing seat as the SAME wire code (`claude.notAuthenticated`): it is what the
//? session writer, the retry policy and the UI already key on ("the coding-agent seat is not signed in").
