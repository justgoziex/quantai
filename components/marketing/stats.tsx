import { NumberTicker } from "@/components/motion/number-ticker";

const STATS = [
  { value: 12400, suffix: "+", label: "pairs screened weekly" },
  { value: 9, suffix: "", label: "risk gates per token" },
  { value: 60, prefix: "<", suffix: "s", label: "from pair creation to score" },
  { value: 0, suffix: "", label: "keys held in custody" },
] as const;

export function Stats() {
  return (
    <section className="border-b border-line">
      <div className="mx-auto grid max-w-wrap grid-cols-2 lg:grid-cols-4">
        {STATS.map((s, i) => (
          <div
            key={s.label}
            className={
              "px-6 py-8 " +
              (i > 0 ? "border-l border-line " : "") +
              (i >= 2 ? "border-t border-line lg:border-t-0 " : "") +
              (i === 2 ? "border-l-0 lg:border-l " : "")
            }
          >
            <p className="font-mono text-data-lg text-bone sm:text-[2rem]">
              <NumberTicker
                value={s.value}
                prefix={"prefix" in s ? s.prefix : ""}
                suffix={s.suffix}
              />
            </p>
            <p className="mt-1.5 text-xs text-muted">{s.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
