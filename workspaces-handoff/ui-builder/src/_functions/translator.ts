// useTranslator.ts
import { useTranslation, translate } from "src/_components/TranslationProvider";

export const useTranslator = () => {
  const translations = useTranslation();
  return ({ key, params }: { key: string; params?: { key: string; value: string | number | boolean }[] }) =>
    translate({ translationList: translations, key, params });
};