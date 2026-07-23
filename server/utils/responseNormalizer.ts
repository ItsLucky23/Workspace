//? Registers the server-side localized error normalizer required by LuckyStack production boots.

import {
  createLocalizedNormalizer,
  registerLocalizedNormalizer,
  type ErrorParam,
} from '@luckystack/core';

import de from '../../src/_locales/de.json';
import en from '../../src/_locales/en.json';
import fr from '../../src/_locales/fr.json';
import nl from '../../src/_locales/nl.json';

const locales: Record<string, unknown> = { de, en, fr, nl };
const supportedLanguages = new Set(Object.keys(locales));

const resolveTranslation = (language: string, key: string): string => {
  let value: unknown = locales[language] ?? locales.en;

  for (const part of key.split('.')) {
    if (typeof value !== 'object' || value === null || !(part in value)) return key;
    value = (value as Record<string, unknown>)[part];
  }

  return typeof value === 'string' ? value : key;
};

const interpolate = (translation: string, params?: ErrorParam[]): string => {
  if (!params) return translation;

  let result = translation;
  for (const param of params) {
    const placeholder = `{{${param.key}}}`;
    result = result.replaceAll(placeholder, String(param.value));
  }
  return result;
};

registerLocalizedNormalizer(createLocalizedNormalizer({
  defaultLanguage: 'en',
  isSupportedLanguage: (language) => supportedLanguages.has(language),
  translate: ({ language, key, params }) => interpolate(resolveTranslation(language, key), params),
}));
