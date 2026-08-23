//? LIVE integration test for the pi-agent harness (ADR 0322, CODING_AGENT_PROGRAM fase 5): a REAL turn on the
//? Codex (ChatGPT) seat inside a REAL `workspaces/base` container — auth projection + copy-in, the in-container
//? `pi auth check` gate, a full PTY turn through `driveContainerTurn` with the pi adapter (capture written by
//? the baked extension), the tool-call trail, and a `--session-id` RESUME of that exact session. Gated: skips
//? cleanly when Docker, the image, or the host's Codex OAuth entry is missing. Costs one tiny subscription turn.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { assert, eq, report } from '../_helpers.mts';

const { docker, dockerAvailable } = await import('../../server/container/runtime');
const { authProjectionDir } = await import('../../server/orchestrator/codingAgents/claudeCode');
const { hostPiAuthHas, piAgentAdapter, PI_AUTH_PROJECTION } = await import('../../server/orchestrator/codingAgents/piAgent');
const { driveContainerTurn } = await import('../../server/orchestrator/stageRunner');

const IMAGE = process.env.WS_BASE_IMAGE ?? 'workspaces/base:0.1.0';
const CONTAINER = `ws-test-piagent-${String(Date.now())}`;

const available = await dockerAvailable();
const imagePresent = available && (await docker(['image', 'inspect', IMAGE])).code === 0;
const codexSeat = hostPiAuthHas('openai-codex');
if (!available || !imagePresent || !codexSeat) {
  console.log(`[piAgentStage] skipping — docker=${String(available)} image=${String(imagePresent)} codexAuth=${String(codexSeat)}`);
  report('piAgentStage (skipped)');
}

const adapter = piAgentAdapter('codex');

//? Host-side seat projection BEFORE the launch (stageRunner calls prepareHost at the same point).
adapter.prepareHost?.();
const projected = path.join(authProjectionDir(), PI_AUTH_PROJECTION);
assert(existsSync(projected), 'prepareHost projects the host pi auth file into data/_auth');

try {
  //? A minimal OUR-labelled container (isWorkspacesContainer checks the workspace label): the image's own
  //? /work (agent-owned), the auth projection RO-mounted exactly like runtime.ts does, default network.
  const run = await docker(['run', '-d', '--name', CONTAINER,
    '--label', 'org.workspaces.workspace=piagent-test',
    '-v', `${authProjectionDir()}:/auth-ro:ro`,
    IMAGE, 'sh', '-c', 'sleep infinity']);
  assert(run.code === 0, `test container launched (${run.code === 0 ? CONTAINER : run.err})`);

  //? The stage-instructions file the pi argv references (`--append-system-prompt`), as renderStage would write.
  await docker(['exec', CONTAINER, 'sh', '-c',
    'mkdir -p /work/.claude && printf "You are a test agent. Answer in one short sentence." > /work/.claude/stage-instructions.txt']);

  //? The in-container seat gate the runner uses before opening a PTY.
  await adapter.projectAuth(CONTAINER, docker);
  assert(await adapter.authenticated(CONTAINER, docker), 'in-container `pi auth check --provider openai-codex` says ready');

  //? 1) A real PTY turn on the Codex seat — capture comes from the baked extension, not the PTY.
  const marker = `PI_E2E_${String(Date.now())}`;
  const turn = await driveContainerTurn(CONTAINER, `Reply with exactly this marker and nothing else: ${marker}`, {
    adapter, model: 'gpt-5.4-mini', effort: 'low', timeoutMs: 180_000,
  });
  assert(turn.ok, `live pi turn completes (${turn.error ?? 'ok'})`);
  assert(turn.message.includes(marker), `the extension captured the assistant message (got: ${turn.message.slice(0, 120)})`);
  assert(typeof turn.claudeSessionId === 'string' && turn.claudeSessionId.length > 0, 'the capture carries the pi session id');

  //? 2) Resume THAT session: pi must remember the marker from turn 1 (proves --session-id + --session-dir).
  const resume = await driveContainerTurn(CONTAINER, 'Repeat the exact marker I gave you earlier, nothing else.', {
    adapter, model: 'gpt-5.4-mini', effort: 'low', timeoutMs: 180_000,
    ...(turn.claudeSessionId ? { resumeSessionId: turn.claudeSessionId } : {}),
  });
  assert(resume.ok, `resumed pi turn completes (${resume.error ?? 'ok'})`);
  assert(resume.message.includes(marker), `the resumed session remembers turn 1's marker (got: ${resume.message.slice(0, 120)})`);
  eq(resume.claudeSessionId, turn.claudeSessionId, 'the resume stayed in the same session');

  //? 3) The tool trail + capture files exist in the shared capture dir (same contract as Claude's hooks).
  const trail = await docker(['exec', CONTAINER, 'sh', '-c', 'cat /work/.claude/tool-calls.jsonl 2>/dev/null; true']);
  console.log(`[piAgentStage] tool-trail lines: ${String(trail.out.split('\n').filter((l) => l.trim().length > 0).length)}`);

  //? 4) afterTurn persisted the (possibly refreshed) token back to the host projection.
  assert(existsSync(projected) && readFileSync(projected, 'utf8').includes('openai-codex'), 'the host projection still holds the Codex entry after copy-back');
} finally {
  await docker(['rm', '-f', CONTAINER]);
}

report('piAgentStage');
