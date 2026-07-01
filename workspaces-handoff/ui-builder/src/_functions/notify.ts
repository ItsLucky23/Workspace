import { toast } from "sonner";
import { translate } from "src/_components/TranslationProvider";
import nlJson from "src/_locales/nl.json";
import enJson from "src/_locales/en.json";
import deJson from "src/_locales/de.json";
import frJson from "src/_locales/fr.json";
import { getCurrentSession } from "src/_providers/SessionProvider";
// import Translator from "./translator";

const Translator = () => {
  const session = getCurrentSession();
  if (!session) { return }

  switch (session.language) {
    case "nl": return nlJson;
    case "en": return enJson;
    case "de": return deJson;
    case "fr": return frJson;
    default: return enJson;
  }
}

const notify = {
  success: ({ key, params }: { key: string, params?: { key: string, value: string | number | boolean }[]}) => {
    const translationList = Translator();
    if (translationList) {toast.success(translate({ translationList, key, params })); }
  },
  error: ({ key, params }: { key: string, params?: { key: string, value: string | number | boolean }[]}) => {
    const translationList = Translator();
    if (translationList) {toast.error(translate({ translationList, key, params })); }
  },
  info: ({ key, params }: { key: string, params?: { key: string, value: string | number | boolean }[]}) => {
    const translationList = Translator();
    if (translationList) {toast.info(translate({ translationList, key, params })); }
  },
  warning: ({ key, params }: { key: string, params?: { key: string, value: string | number | boolean }[]}) => {
    const translationList = Translator();
    if (translationList) {toast.warning(translate({ translationList, key, params })); }
  },
}

export default notify;