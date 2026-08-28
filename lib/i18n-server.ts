import { cookies } from "next/headers";
import { DICT } from "./dictionary";
import { LANG_COOKIE, type Locale } from "./i18n";

/*
  Server-side counterpart to lib/i18n. Reads the locale cookie so Server
  Components render in the viewer's language. Pair with a client I18nProvider
  seeded from the same cookie to keep hydration consistent.
*/
export async function getLocale(): Promise<Locale> {
  const c = (await cookies()).get(LANG_COOKIE)?.value;
  return c === "zh" ? "zh" : "en";
}

export function tt(locale: Locale, s: string): string {
  if (locale !== "zh") return s;
  return DICT[s] ?? s;
}
