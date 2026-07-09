//? S2 — the greenfield template catalog now yields a BUILDABLE, CI-gated, stack-tagged codebase (not just a file
//? skeleton). Verifies every template declares a valid stack, carries a `.workspaces/Dockerfile` that `FROM`s its
//? own stack base image (S1), a `.workspaces/ci.yml` build gate, and real source files; and that the new Go
//? template exercises the Go stack. Pure.

import { assert, eq, report } from '../_helpers.mts';
import { listTemplates, getTemplate } from '../../server/scaffold/templates.ts';
import { baseImageFor, isBaseStack } from '../../server/container/baseImages.ts';

const list = listTemplates();
assert(list.length >= 4, 'the catalog has at least the 4 curated templates (incl. Go)');
assert(list.every((t) => isBaseStack(t.stack)), 'every listed template declares a valid stack');
assert(list.some((t) => t.key === 'go-api' && t.stack === 'go'), 'the Go template is catalogued on the go stack');

for (const { key } of list) {
  const t = getTemplate(key);
  assert(t !== null, `getTemplate(${key}) resolves`);
  if (!t) continue;

  const paths = t.files.map((f) => f.path);
  // every seed carries the S2 build + CI files
  const dockerfile = t.files.find((f) => f.path === '.workspaces/Dockerfile');
  const ci = t.files.find((f) => f.path === '.workspaces/ci.yml');
  assert(dockerfile !== undefined, `${key} seeds a .workspaces/Dockerfile`);
  assert(ci !== undefined, `${key} seeds a .workspaces/ci.yml`);

  // the Dockerfile FROMs the template's OWN stack base (S1 catalog) — a buildable L2 image
  assert((dockerfile?.content ?? '').includes(`FROM ${baseImageFor(t.stack)}`), `${key}'s Dockerfile extends its stack base (${t.stack})`);
  assert((ci?.content ?? '').includes('script:'), `${key}'s ci.yml has a build script gate`);

  // real runnable source (not just README/gitignore)
  const source = paths.filter((p) => !p.startsWith('.workspaces/') && p !== 'README.md' && p !== '.gitignore');
  assert(source.length >= 1, `${key} seeds real source files (${String(source.length)})`);
  assert(t.devCommand.trim().length > 0, `${key} declares a dev command`);
}

// spot-check the Go + Python seeds specifically (the new stacks)
const go = getTemplate('go-api');
assert(go?.files.some((f) => f.path === 'main.go' && f.content.includes('net/http')), 'go template has a net/http main.go');
assert(go?.files.some((f) => f.path === 'go.mod'), 'go template has a go.mod');
const py = getTemplate('python-fastapi');
assert(py?.stack === 'python' && (py.files.find((f) => f.path === '.workspaces/Dockerfile')?.content ?? '').includes('base-python'), 'python template builds on the python base');

eq(getTemplate('nonsense'), null, 'an unknown template key resolves to null');

report('tests/unit/templates.test.mts');
