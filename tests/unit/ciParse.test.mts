//? Unit test for the real CI YAML parser (server/ci/parse, C4). No DB. Verifies the documented
//? `jobs:`-wrapped shape STILL parses (backward compat) AND a real `.gitlab-ci.yml` (top-level jobs,
//? `stages:`/`script:` as block sequences, snake_case `allow_failure`) is honoured — the thing the
//? old fixed-indent mini-subset parser dropped. Plus the raw `parseYamlSubset` tree + error cases.

import { assert, eq, report } from '../_helpers.mts';

const { parseCiYaml, parseYamlSubset } = await import('../../server/ci/parse.ts');

// 1) backward compat — the documented inline shape
{
  const r = parseCiYaml(`version: 1
stages: [lint, test]
jobs:
  lint:
    script: ["npm run lint"]
  test:
    stage: test
    needs: [lint]
    script: ["npm test"]`);
  assert(r.ok, 'documented jobs:-wrapped shape still parses');
  eq(r.ok ? r.spec.jobs.length : 0, 2, 'both jobs extracted');
  eq(r.ok ? r.spec.jobs[1]?.needs : [], ['lint'], 'needs DAG edge read');
}

// 2) a REAL .gitlab-ci.yml — top-level jobs, block-sequence stages + script, snake_case allow_failure
{
  const r = parseCiYaml(`stages:
  - build
  - test

variables:
  NODE_ENV: ci

build-job:
  stage: build
  image: node:20
  script:
    - npm ci
    - npm run build

test-job:
  stage: test
  needs: [build-job]
  allow_failure: true
  script:
    - npm test`);
  assert(r.ok, 'a real .gitlab-ci.yml parses');
  eq(r.ok ? r.spec.stages : [], ['build', 'test'], 'block-sequence stages read');
  const build = r.ok ? r.spec.jobs.find((j) => j.name === 'build-job') : undefined;
  eq(build?.script, ['npm ci', 'npm run build'], 'block-sequence script read (multi-line, NOT dropped)');
  eq(build?.image, 'node:20', 'job image read');
  const test = r.ok ? r.spec.jobs.find((j) => j.name === 'test-job') : undefined;
  eq(test?.needs, ['build-job'], 'inline needs read');
  assert(test?.allowFailure === true, 'snake_case allow_failure honoured');
  //? `variables:` is a reserved top-level key → NOT treated as a job.
  assert((r.ok ? r.spec.jobs : []).every((j) => j.name !== 'variables'), 'reserved top-level keys are not jobs');
}

// 3) raw tree shape
{
  const tree = parseYamlSubset(`a: 1
b:
  c: two
  d:
    - x
    - y`);
  const obj = tree as Record<string, unknown>;
  eq(obj.a, '1', 'scalar');
  eq((obj.b as Record<string, unknown>).c, 'two', 'nested map scalar');
  eq((obj.b as Record<string, unknown>).d, ['x', 'y'], 'nested block sequence');
}

// 4) error cases
{
  assert(!parseCiYaml('').ok, 'empty → error');
  assert(!parseCiYaml('version: 1\nstages: [x]').ok, 'no jobs → error');
  assert(!parseCiYaml('build:\n  script:\n    - go build').ok, 'no stages → error');
}

report('tests/unit/ciParse.test.mts');
