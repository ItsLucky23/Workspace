import assert from 'node:assert/strict';

import { isDbHealthCheckRegistered } from '@luckystack/core';

await import('../../luckystack/core/clients.ts');

assert.equal(isDbHealthCheckRegistered(), true);

console.log('database health registration unit tests passed');
