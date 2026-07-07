//? E5 — user-defined custom AI tasks. A named, re-runnable prompt-template the user authors; running it renders
//? the template with the given variables + runs it through the provider abstraction (feature 'custom-generate',
//? provider-per-feature-overridable via P1). It stays PROPOSE/GENERATE: the run only stores `lastOutput` for the
//? user to read — it never writes authoritative state, never a new write verb (single-writer + frozen-verbs).

import type { PrismaClient } from '@prisma/client';

import { runAiCompletion } from './registry';

//? Substitute `{{name}}` placeholders with the given variables (missing → empty). Unmatched braces are left
//? as-is. Pure + exported for tests.
export function renderTaskPrompt(template: string, vars: Record<string, string> = {}): string {
  return template.replaceAll(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, key: string) => (typeof vars[key] === 'string' ? vars[key] : ''));
}

export interface CustomTaskResult { ok: boolean; output?: string; error?: string }

//? Run a stored custom task: render its template + generate, then persist the output (read-only). Never writes
//? authoritative state. Best-effort — a provider failure records nothing new + returns an error.
export async function runCustomTask(prisma: PrismaClient, workspaceId: string, taskId: string, vars: Record<string, string> = {}): Promise<CustomTaskResult> {
  const task = await prisma.customAiTask.findFirst({ where: { workspaceId, id: taskId } });
  if (!task) return { ok: false, error: 'customTask.notFound' };
  const prompt = renderTaskPrompt(task.promptTemplate, vars);
  const completion = await runAiCompletion('custom-generate', { prompt, workspaceId, label: `Custom task · ${task.name}` });
  if (!completion.ok || completion.text.trim().length === 0) return { ok: false, error: completion.error ?? 'customTask.emptyResponse' };
  await prisma.customAiTask.update({ where: { id: task.id }, data: { lastOutput: completion.text, lastRunAt: new Date() } });
  return { ok: true, output: completion.text };
}
