//? The production unit locks Docker and Claude CLI state outside the systemd-protected home directory.

import { readFile } from 'node:fs/promises';

import { assert, report } from '../_helpers.mts';

const [unit, baseImage] = await Promise.all([
  readFile('deploy/systemd/workspaces-app.service', 'utf8'),
  readFile('docker/base.Dockerfile', 'utf8'),
]);

assert(unit.includes('ProtectHome=true'), 'the app service keeps the operator home hidden');
assert(unit.includes('Environment=DOCKER_CONFIG=/run/workspaces-app'), 'Docker CLI config uses an explicit runtime directory');
assert(unit.includes('RuntimeDirectory=workspaces-app'), 'systemd creates the Docker config runtime directory for the app user');
assert(!unit.includes('DOCKER_CONFIG=/home/'), 'Docker config never points back into the protected home');
assert(unit.includes('Environment=CLAUDE_CONFIG_DIR=/var/lib/workspaces/auth'), 'Claude subscription auth uses the dedicated protected-home-safe projection');
assert(!unit.includes('CLAUDE_CONFIG_DIR=/home/'), 'Claude auth never depends on the hidden operator home');

const workOwner = 'install -d -o agent -g agent /work';
assert(baseImage.includes(workOwner), 'the image seeds /work as the non-root agent before a named volume copies it');
assert(baseImage.indexOf(workOwner) < baseImage.indexOf('USER agent'), '/work ownership is established before dropping root');

report('tests/unit/productionAppService.test.mts');
