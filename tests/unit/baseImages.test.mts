//? S1 — the per-stack base-image catalog + the relaxed Dockerfile-trust guard (any-stack). Pure. Verifies:
//? `baseImageFor` maps each stack to its L1 image (node = the agent base, others = `workspaces/base-<stack>`);
//? `resolveProjectBaseImage` prefers a built L2 `baseImageRef` else the stack base; and `extendsAllowedBase`
//? accepts ANY `workspaces/base*` family image (agent base + every stack variant) but rejects an arbitrary FROM.

import { assert, eq, report } from '../_helpers.mts';
import { baseImageFor, resolveProjectBaseImage, extendsAllowedBase, isBaseStack, BASE_STACKS } from '../../server/container/baseImages.ts';

// catalog: node = the agent base; others = workspaces/base-<stack>
{
  assert(baseImageFor('node').startsWith('workspaces/base:'), 'node → the agent base image');
  assert(baseImageFor('python') === 'workspaces/base-python:0.1.0', 'python → workspaces/base-python');
  assert(baseImageFor('go').startsWith('workspaces/base-go:'), 'go → workspaces/base-go');
  assert(baseImageFor('rust').startsWith('workspaces/base-rust:'), 'rust → workspaces/base-rust');
  assert(baseImageFor('java').startsWith('workspaces/base-java:'), 'java → workspaces/base-java');
  assert(baseImageFor(null).startsWith('workspaces/base:'), 'null stack → node base (default)');
  assert(baseImageFor('cobol').startsWith('workspaces/base:'), 'an unknown stack falls back to node base');
  eq(BASE_STACKS.length, 5, 'five stacks catalogued');
  assert(isBaseStack('python') && !isBaseStack('cobol'), 'isBaseStack gates the catalog');
}

// resolveProjectBaseImage: L2 baseImageRef wins, else the stack base
{
  eq(resolveProjectBaseImage({ baseImageRef: 'workspaces/proj-x:5', stack: 'python' }), 'workspaces/proj-x:5', 'a built L2 image wins over the stack base');
  eq(resolveProjectBaseImage({ baseImageRef: '', stack: 'go' }), baseImageFor('go'), 'no L2 image → the stack base');
  eq(resolveProjectBaseImage({ stack: 'rust' }), baseImageFor('rust'), 'stack-only project → its stack base');
  assert(resolveProjectBaseImage(null).startsWith('workspaces/base:'), 'null project → node base');
}

// the relaxed guard: any workspaces/base* family FROM is allowed; arbitrary is rejected
{
  assert(extendsAllowedBase('FROM workspaces/base:0.1.0\nRUN echo hi'), 'the agent base is allowed');
  assert(extendsAllowedBase('# syntax=docker/dockerfile:1\nFROM workspaces/base-python:0.1.0'), 'a syntax directive before a stack FROM is fine');
  assert(extendsAllowedBase('FROM workspaces/base-rust:0.1.0'), 'a stack variant base is allowed');
  assert(!extendsAllowedBase('FROM ubuntu:22.04'), 'an arbitrary upstream FROM is rejected');
  assert(!extendsAllowedBase('FROM python:3.12-slim'), 'even a real stack image (not our family) is rejected — supply-chain gate');
  assert(!extendsAllowedBase('RUN echo no from'), 'no FROM → rejected');
  assert(!extendsAllowedBase('FROM evil/workspaces-base'), 'a look-alike (not workspaces/base*) is rejected');
}

report('tests/unit/baseImages.test.mts');
