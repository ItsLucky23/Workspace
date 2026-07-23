import assert from 'node:assert/strict';

import {
  getLocalizedNormalizer,
  isLocalizedNormalizerRegistered,
} from '@luckystack/core';

await import('../../server/utils/responseNormalizer.ts');

assert.equal(isLocalizedNormalizerRegistered(), true);

const normalizer = getLocalizedNormalizer();
assert.equal(normalizer.resolveErrorMessage({
  errorCode: 'api.notFound',
  errorParams: [{ key: 'name', value: 'tickets/list' }],
  preferredLocale: 'en',
}), "API 'tickets/list' was not found.");
assert.equal(normalizer.resolveErrorMessage({
  errorCode: 'auth.required',
  preferredLocale: 'nl-NL,nl;q=0.9',
}), 'Je moet ingelogd zijn.');
assert.equal(normalizer.resolveErrorMessage({
  errorCode: 'unknown.translation.key',
  preferredLocale: 'fr',
}), 'unknown.translation.key');

console.log('localized normalizer registration unit tests passed');
