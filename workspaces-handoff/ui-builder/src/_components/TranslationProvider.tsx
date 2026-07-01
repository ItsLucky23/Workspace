// src/_components/translationProvider.tsx
import { createContext, Dispatch, ReactNode, SetStateAction, useContext, useEffect, useMemo, useState } from "react";
import { useSession } from "../_providers/SessionProvider";
import nlJson from "src/_locales/nl.json";
import enJson from "src/_locales/en.json";
import deJson from "src/_locales/de.json";
import frJson from "src/_locales/fr.json";
import config from "config";

const TranslationContext = createContext<{
  translations: Record<string, any>,
  setLanguage: Dispatch<SetStateAction<'nl' | 'en' | 'de' | 'fr'>>;
} | null>(null);

const getLanguage = (language: string) => {
  switch (language) {
    case "nl": return nlJson;
    case "en": return enJson;
    case "de": return deJson;
    case "fr": return frJson;
    default: return enJson;
  }
};

export const TranslationProvider = ({ children }: { children: ReactNode }) => {
  const { session } = useSession();
  // const language = session?.language || config.defaultLanguage;
  const [language, setLanguage] = useState<'nl' | 'en' | 'de' | 'fr'>((session?.language || config.defaultLanguage) as 'nl' | 'en' | 'de' | 'fr');
  const translations = useMemo(() => getLanguage(language), [language]);

  useEffect(() => {
    if (session?.language) {
      setLanguage(session.language as 'nl' | 'en' | 'de' | 'fr');
    }
  },  [window.location.pathname, session])

  return (
    <TranslationContext.Provider value={{ translations, setLanguage }}>
      {children}
    </TranslationContext.Provider>
  );
};

export const useTranslation = () => {
  const context = useContext(TranslationContext);
  if (!context) {
    throw new Error("useTranslation must be used within a TranslationProvider");
  }
  return context.translations;
};

export const useUpdateLanguage = () => {
  const context = useContext(TranslationContext);
  if (!context) {
    throw new Error("setLanguage must be used within a TranslationProvider");
  }
  return context.setLanguage;
}

// helper function for dynamic translation
export const translate = ({ translationList, key, params }: {
  translationList: Record<string, any>,
  key: string,
  params?: { key: string, value: string | number | boolean }[]
}) => {
  let result = key.split(".").reduce((acc: any, part) => acc?.[part], translationList);
  if (typeof result !== "string") return key;
  if (!params) return result;

  for (const param of params) {
    if (!param.key) continue;
    if (typeof param.value === "undefined") continue;
    const regex = new RegExp(`{{${param.key}}}`, "g");
    result = result.replace(regex, param.value.toString());
  }
  return result;
};