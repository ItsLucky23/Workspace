//? RS-C (COMPLETION nav/i18n) — locale integrity gate. Locks down: (1) every locale parses;
//? (2) NO mojibake byte-sequences remain (double-encoded UTF-8 like Ã¼/â€"/Â·); (3) nl/de/fr cover
//? every key en.json defines (missing-key drift — the 9 board keys were absent in de/fr). Keeps the
//? "a non-technical user can follow the whole app in their language" goal from silently regressing.

import { readFileSync } from 'node:fs';
import { assert, eq, report } from '../_helpers.mts';

const LOCALES = ['en', 'nl', 'de', 'fr'] as const;
//? Genuine double-encoding leaders (C3.., C2.., E2...) — NOT single correct Latin-1 chars (é/è/à),
//? which are legitimate. A match is mojibake only if latin1->utf8 reinterpret is clean (no U+FFFD).
const MOJIBAKE = /Ã[-¿]|Â[-¿]|â[-¿][-¿]/g;

function flatKeys(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => flatKeys(v, prefix ? `${prefix}.${k}` : k));
}

try {
  const parsed: Record<string, unknown> = {};
  for (const loc of LOCALES) {
    const raw = readFileSync(`src/_locales/${loc}.json`, 'utf8');
    const json = JSON.parse(raw) as unknown;
    parsed[loc] = json;
    //? Mojibake check — a hit is only real double-encoding when it reinterprets cleanly.
    const hits = (raw.match(MOJIBAKE) ?? []).filter((m) => !Buffer.from(m, 'latin1').toString('utf8').includes('�'));
    eq(hits.length, 0, `${loc}.json has no mojibake sequences${hits.length ? ` (e.g. ${JSON.stringify(hits[0])})` : ''}`);
  }
  //? Key-completeness: en is the reference; every other locale must define each key.
  const enKeys = new Set(flatKeys(parsed.en));
  for (const loc of ['nl', 'de', 'fr'] as const) {
    const locKeys = new Set(flatKeys(parsed[loc]));
    const missing = [...enKeys].filter((k) => !locKeys.has(k));
    eq(missing.length, 0, `${loc}.json covers every en key${missing.length ? ` (missing ${String(missing.length)}, e.g. ${missing.slice(0, 3).join(', ')})` : ''}`);
  }
  assert(true, 'all locales parse, are mojibake-free, and key-complete');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
}

report('tests/unit/localeIntegrity.test.mts');
