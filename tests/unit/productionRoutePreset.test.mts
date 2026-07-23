import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { collectServerRequestFunctionFiles } from '../../scripts/serverRequestFunctions.ts';
import servicesConfig from '../../services.config.ts';

const srcRoot = path.resolve('src');

const containsProductionRoute = (directory: string): boolean => {
  if (!existsSync(directory)) return false;
  for (const entry of readdirSync(directory)) {
    if (entry === 'playground') continue;
    const absolute = path.join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      if (containsProductionRoute(absolute)) return true;
      continue;
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.tests.ts')
      && (absolute.includes(`${path.sep}_api${path.sep}`) || absolute.includes(`${path.sep}_sync${path.sep}`))) return true;
  }
  return false;
};

const routeServices = new Set<string>();
if (containsProductionRoute(path.join(srcRoot, '_api')) || containsProductionRoute(path.join(srcRoot, '_sync'))) {
  routeServices.add('system');
}
for (const entry of readdirSync(srcRoot)) {
  if (entry.startsWith('_') || entry === 'playground') continue;
  const absolute = path.join(srcRoot, entry);
  if (statSync(absolute).isDirectory() && containsProductionRoute(absolute)) routeServices.add(entry);
}

const bundledServices = new Set(servicesConfig.presets.default.services);
assert.deepEqual([...bundledServices].toSorted(), [...routeServices].toSorted(), 'the default production preset must bundle every route service');
for (const service of routeServices) assert.ok(servicesConfig.services[service], `missing service definition for ${service}`);

const injectedFunctionFiles = collectServerRequestFunctionFiles().map((filePath) => path.relative(process.cwd(), filePath).split(path.sep).join('/'));
assert.ok(injectedFunctionFiles.includes('shared/tryCatch.ts'), 'production injection must include functions.tryCatch');
assert.ok(injectedFunctionFiles.includes('shared/sleep.ts'), 'production injection must include functions.sleep');
assert.ok(injectedFunctionFiles.includes('functions/db.ts'), 'production injection must include consumer function shims');

console.log('production route preset unit tests passed');
