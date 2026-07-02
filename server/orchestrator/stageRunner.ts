//? Stage-runner — the autonomous per-stage execution loop (07 §A step 6-7). Renders the
//? stage config into the container, then drives an in-container `claude` turn on the ticket,
//? parses the result, and (later) advances the ticket. Runs OFF the Conductor serial chain
//? (the turn is long). This file holds the CREDENTIAL-FREE materialization step now; the
//? `docker exec claude` drive is gated on the container-auth spike (07b §2) and lands with it.

import { docker, isWorkspacesContainer } from '../container/runtime';
import type { StageArtifacts } from './renderStage';

//? Write a small text file INTO the container volume as the `agent` user (the worktree is a
//? docker volume, not a host path — 07b §4). base64 round-trip so any content is shell-safe.
async function writeFileInContainer(container: string, filePath: string, content: string): Promise<boolean> {
  const b64 = Buffer.from(content, 'utf8').toString('base64');
  const dir = filePath.slice(0, filePath.lastIndexOf('/'));
  const cmd = `mkdir -p '${dir}' && printf '%s' '${b64}' | base64 -d > '${filePath}'`;
  const r = await docker(['exec', container, 'sh', '-c', cmd]);
  return r.code === 0;
}

//? Materialize the rendered stage artifacts into the container worktree (07 §A step 6):
//? CLAUDE.md at the work root, settings.json + stage-instructions under .claude, .mcp.json.
//? Label-gated (never write into a foreign container). Returns false if any write fails.
export async function materializeStageConfig(container: string, artifacts: StageArtifacts): Promise<boolean> {
  if (!(await isWorkspacesContainer(container))) return false;
  const writes: [string, string][] = [
    ['/work/CLAUDE.md', artifacts.claudeMd],
    ['/work/.claude/settings.json', artifacts.settingsJson],
    ['/work/.claude/stage-instructions.txt', artifacts.stageInstructions],
    ['/work/.mcp.json', artifacts.mcpJson],
  ];
  for (const [path, content] of writes) {
    if (!(await writeFileInContainer(container, path, content))) return false;
  }
  return true;
}
