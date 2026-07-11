//? I1 (demo-video) — capture a running app into an mp4. A one-shot `workspaces/capture` container (Playwright +
//? chromium, `docker/base-capture.Dockerfile`) drives a SCENARIO (navigate/wait/click steps) against a preview
//? URL and records the session to `/out/<name>.mp4`. This produces the raw footage that I3 turns into a montage
//? (the captured mp4 becomes a video ContentAsset → dropped into the timeline). The heavy container run is
//? injectable so the plan + scenario logic are unit-tested without Docker.

import path from 'node:path';
import { existsSync } from 'node:fs';

import { tryCatch } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';

import { docker } from '../container/runtime';
import { MEDIA_DIR } from '../media/store';
import { runAiCompletion } from '../ai/registry';

const CAPTURE_IMAGE = (process.env.WS_CAPTURE_IMAGE ?? '').trim() || 'workspaces/capture:latest';
const NET = process.env.WS_NET ?? 'workspaces-net';

//? A capture scenario: a viewport + an ordered list of steps the driver runs. Kept deliberately small (the
//? three primitives cover a product walkthrough: go to a screen, pause on it, click something).
export interface CaptureStep { goto?: string; waitMs?: number; click?: string }
export interface CaptureScenario { viewport: { width: number; height: number }; steps: CaptureStep[] }

//? Build a default walkthrough scenario from the app's routes: visit each route (relative to the base URL) and
//? hold for `holdMs` so the viewer can read the screen. Pure + exported for tests (I2 replaces this with an
//? AI-authored scenario; this is the deterministic fallback).
export function buildCaptureScenario(routes: { path: string }[], opts: { holdMs?: number; width?: number; height?: number } = {}): CaptureScenario {
  const holdMs = Math.max(500, opts.holdMs ?? 2500);
  const steps: CaptureStep[] = [];
  for (const r of routes) {
    const p = r.path.startsWith('/') ? r.path : `/${r.path}`;
    steps.push({ goto: p }, { waitMs: holdMs });
  }
  if (steps.length === 0) steps.push({ goto: '/' }, { waitMs: holdMs });
  return { viewport: { width: opts.width ?? 1280, height: opts.height ?? 720 }, steps };
}

//? Coerce an unknown value (AI output / client payload) into a valid CaptureScenario — keeps only well-formed
//? steps, clamps the viewport. Returns null when nothing usable is present. Pure + exported for tests.
export function coerceScenario(raw: unknown): CaptureScenario | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const rawSteps = Array.isArray(o.steps) ? o.steps : [];
  const steps: CaptureStep[] = [];
  for (const s of rawSteps) {
    if (s === null || typeof s !== 'object') continue;
    const step = s as Record<string, unknown>;
    const out: CaptureStep = {};
    if (typeof step.goto === 'string') out.goto = step.goto;
    if (typeof step.click === 'string') out.click = step.click;
    if (typeof step.waitMs === 'number') out.waitMs = Math.min(60_000, Math.max(0, step.waitMs));
    if (Object.keys(out).length > 0) steps.push(out);
  }
  if (steps.length === 0) return null;
  const vp = (o.viewport ?? {}) as Record<string, unknown>;
  const width = typeof vp.width === 'number' ? vp.width : 1280;
  const height = typeof vp.height === 'number' ? vp.height : 720;
  return { viewport: { width, height }, steps };
}

//? I2 (walkthrough-driver) — have the AI author a capture scenario from the app's routes + a goal. Reuses the
//? `studio-marketer` role (a marketing/demo task). Returns a validated scenario, or the deterministic
//? route-walk fallback when the AI is unavailable / returns nothing parseable. Never throws.
export async function generateCaptureScenario(prisma: PrismaClient, workspaceId: string, goal: string, routes: { path: string }[]): Promise<CaptureScenario> {
  const fallback = buildCaptureScenario(routes);
  const routeList = routes.map((r) => r.path).join(', ') || '/';
  const system = 'You script short product demo walkthroughs. Output ONLY a JSON object {"viewport":{"width":1280,"height":720},"steps":[...]} where each step is one of {"goto":"/path"} (relative route), {"waitMs":2500} (hold on screen), or {"click":"css-selector"}. Visit the most demo-worthy screens in a logical order, holding ~2.5s on each. No prose, JSON only.';
  const prompt = `App routes: ${routeList}\nDemo goal: ${goal || 'show the main features'}\nProduce the walkthrough scenario JSON.`;
  const [, res] = await tryCatch(() => runAiCompletion('studio-marketer', { prompt, system, workspaceId, label: 'Demo capture scenario', timeoutMs: 60_000 }));
  if (!res?.ok || res.text.trim().length === 0) return fallback;
  const [, parsed] = await tryCatch(() => JSON.parse(res.text.slice(res.text.indexOf('{'), res.text.lastIndexOf('}') + 1)) as unknown);
  return coerceScenario(parsed) ?? fallback;
}

//? The docker args to run the capture container: mount MEDIA_DIR as /out, pass the base URL + the scenario JSON
//? + the output name, on the shared proxy net so it can dial a preview container by name. Pure + exported.
export function buildCaptureRunArgs(baseUrl: string, scenario: CaptureScenario, outName: string): string[] {
  const hostMedia = MEDIA_DIR.replaceAll('\\', '/');
  return ['run', '--rm', '--network', NET, '-v', `${hostMedia}:/out`, CAPTURE_IMAGE,
    'node', '/capture/captureScript.mjs', '--url', baseUrl, '--out', `/out/${outName}`, '--scenario', JSON.stringify(scenario)];
}

export interface CaptureResult { ok: boolean; url?: string; error?: string }

//? Run a capture: launch the container against `baseUrl` following `scenario`, producing a served `/media/<name>.mp4`.
//? Best-effort: no Docker / the image missing / a driver failure → a typed error (never throws). `opts.run` injects
//? the docker transport for tests.
export async function runCapture(baseUrl: string, scenario: CaptureScenario, opts: { run?: (args: string[]) => Promise<{ code: number; err: string }> } = {}): Promise<CaptureResult> {
  const run = opts.run ?? ((args: string[]) => docker(args).then((r) => ({ code: r.code, err: r.err })));
  const outName = `capture-${Date.now().toString(36)}.mp4`;
  const [err, res] = await tryCatch(() => run(buildCaptureRunArgs(baseUrl, scenario, outName)));
  if (err || res?.code !== 0) return { ok: false, error: `capture.failed: ${err ? err.message : (res?.err.slice(0, 150) ?? 'unknown')}` };
  if (!existsSync(path.join(MEDIA_DIR, outName))) return { ok: false, error: 'capture.noOutput' };
  return { ok: true, url: `/media/${outName}` };
}
