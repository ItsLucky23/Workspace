//? Register-flow C — read + save the AI-authored draft `.workspaces/Dockerfile` that the
//? user reviews between generation (`dockerfileGen`) and the L2 build (`imageBuild`). Both
//? sides read/write the SAME on-disk draft at `data/workspaces/<id>/draft.Dockerfile` that
//? `buildProjectImage` consumes — the review UI edits it in place. A save re-validates the
//? first `FROM` extends the L1 base (the same supply-chain guard as generate + build,
//? 07b §1.2 / Q-CT-DOCKERFILE-TRUST), so an edited draft can never smuggle an arbitrary base.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { workspaceDataDir } from '../git/repoStore';

const BASE_IMAGE = process.env.WS_BASE_IMAGE ?? 'workspaces/base:0.1.0';

export interface DraftReadResult { ok: boolean; dockerfile: string; error?: string }
export interface DraftSaveResult { ok: boolean; error?: string }

function draftPath(workspaceId: string): string {
  return path.join(workspaceDataDir(workspaceId), 'draft.Dockerfile');
}

//? The draft's FIRST `FROM` must be our L1 base (a `# syntax=` directive before it is fine).
//? NOTE: `dockerfileGen.ts` + `imageBuild.ts` each carry an identical local copy of this
//? guard; a later cleanup could import this one (reported, not refactored here).
export function extendsBase(dockerfile: string): boolean {
  const firstFrom = dockerfile.split('\n').map((l) => l.trim()).find((l) => /^FROM\s/i.test(l));
  return firstFrom?.toLowerCase().startsWith(`from ${BASE_IMAGE.toLowerCase()}`) ?? false;
}

//? Read the persisted draft so the review UI survives a reload without paying another
//? (slow) AI turn. Returns a typed `dockerfile.noDraft` when none has been generated yet.
export function readDockerfileDraft(workspaceId: string): DraftReadResult {
  const file = draftPath(workspaceId);
  if (!existsSync(file)) return { ok: false, dockerfile: '', error: 'dockerfile.noDraft' };
  return { ok: true, dockerfile: readFileSync(file, 'utf8') };
}

//? Persist the user's edited draft back to the file `buildProjectImage` reads. Rejects an
//? empty draft or one whose first `FROM` is not the L1 base before writing.
export function saveDockerfileDraft(workspaceId: string, dockerfile: string): DraftSaveResult {
  const content = dockerfile.trim();
  if (content.length === 0) return { ok: false, error: 'dockerfile.empty' };
  if (!extendsBase(content)) return { ok: false, error: 'dockerfile.invalidBase' };
  const file = draftPath(workspaceId);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, 'utf8');
  return { ok: true };
}
