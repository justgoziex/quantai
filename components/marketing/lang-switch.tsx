"use client";

import { useI18n, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/*
  EN / 中文 toggle for the top bar. Sets the locale cookie + refreshes so both
  client and server-rendered copy switch language.
*/
export function LangSwitch({ className }: { className?: string }) {
  const { locale, setLocale } = useI18n();
  const opt = (l: Locale, label: string) => (
    <button
      key={l}
      onClick={() => setLocale(l)}
      aria-pressed={locale === l}
      className={cn(
        "px-2 py-1 font-mono text-data-sm transition-colors duration-fast",
        locale === l ? "bg-raised text-amber" : "text-muted hover:text-bone",
      )}
    >
      {label}
    </button>
  );
  return (
    <div
      className={cn("flex shrink-0 overflow-hidden rounded-md border border-line", className)}
      title="Language · 语言"
    >
      {opt("en", "EN")}
      {opt("zh", "中文")}
    </div>
  );
}
