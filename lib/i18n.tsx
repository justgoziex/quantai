"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DICT } from "./dictionary";

/*
  Lightweight bilingual layer (English + Simplified Chinese). Client components
  call useI18n().t("English string"); server components use tt() from
  ./i18n-server. Locale lives in the `quantai_lang` cookie so the server can
  read it too — switching calls router.refresh() so server-rendered strings
  update as well. Untranslated strings fall back to English.
*/
export type Locale = "en" | "zh";
export const LANG_COOKIE = "quantai_lang";

export function translate(locale: Locale, s: string): string {
  if (locale !== "zh") return s;
  return DICT[s] ?? s;
}

type I18nValue = { locale: Locale; setLocale: (l: Locale) => void; t: (s: string) => string };
const I18nContext = createContext<I18nValue>({ locale: "en", setLocale: () => {}, t: (s) => s });

export function I18nProvider({
  children,
  initialLocale = "en",
}: {
  children: React.ReactNode;
  initialLocale?: Locale;
}) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  // Pages are CDN-cached, so the server can't reliably vary on the language
  // cookie. Read the user's choice on the client and correct after hydration —
  // client components (nav, screener, trade panel, …) then render in it.
  useEffect(() => {
    try {
      const m = document.cookie.match(/(?:^|;\s*)quantai_lang=(en|zh)/);
      const saved = (m?.[1] as Locale) || (localStorage.getItem("quantai:lang") as Locale | null);
      if (saved && saved !== locale) setLocaleState(saved);
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    // whole-page translation for everything not wrapped in t()
    let cancelled = false;
    (async () => {
      const { applyTranslation, revertTranslation } = await import("./dom-translate");
      if (cancelled) return;
      if (locale === "zh") applyTranslation();
      else revertTranslation();
    })();
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const setLocale = useCallback(
    (l: Locale) => {
      setLocaleState(l);
      try {
        document.cookie = `${LANG_COOKIE}=${l};path=/;max-age=31536000;samesite=lax`;
        localStorage.setItem("quantai:lang", l);
      } catch {
        /* ignore */
      }
      document.documentElement.lang = l === "zh" ? "zh-CN" : "en";
      // re-render server components with the new cookie
      router.refresh();
    },
    [router],
  );

  const t = useCallback((s: string) => translate(locale, s), [locale]);

  return <I18nContext.Provider value={{ locale, setLocale, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
