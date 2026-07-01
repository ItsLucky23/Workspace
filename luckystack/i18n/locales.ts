//? Locale registration overlay. Bundles the consumer's translation JSON
//? files and the language source (= `session.language`) into the
//? framework. Imported as a side-effect from `src/main.tsx`.
//?
//? Adding a new language:
//?   1. Drop `<lang>.json` into `src/_locales/`.
//?   2. Import it here and add it to the `registerLocales` map.
//?   3. Add the new locale code to your `SessionLayout['language']` union
//?      in `config.ts` so the type system follows.

import { registerLocales, registerLanguageSource } from '@luckystack/core/client';

import deJson from 'src/_locales/de.json';
import enJson from 'src/_locales/en.json';
import frJson from 'src/_locales/fr.json';
import nlJson from 'src/_locales/nl.json';

import { getCurrentSession } from 'src/_providers/SessionProvider';

registerLocales({
  en: enJson,
  nl: nlJson,
  de: deJson,
  fr: frJson,
});

registerLanguageSource(() => getCurrentSession()?.language ?? null);
