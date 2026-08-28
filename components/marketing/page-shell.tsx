import { Nav } from "./nav";
import { Footer } from "./footer";

/*
  Shell for document pages (terms, privacy, disclaimer). Prose is hand-set:
  ~65ch measure, generous line-height, hairline-separated sections.
*/
export function DocPage({
  label,
  title,
  updated,
  children,
}: {
  label: string;
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-wrap px-6 pb-24">
        <header className="border-b border-line py-12">
          <p className="text-label mb-4">{label}</p>
          <h1 className="text-display-lg mb-3 text-bone" style={{ textWrap: "balance" }}>
            {title}
          </h1>
          <p className="font-mono text-data-sm text-faint">Last updated {updated}</p>
        </header>
        <div className="max-w-2xl pt-4">{children}</div>
      </main>
      <Footer />
    </>
  );
}

export function DocSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line py-8 last:border-0">
      <h2 className="text-h2 mb-3 text-bone">{title}</h2>
      <div className="flex flex-col gap-3 text-base text-muted [&_strong]:font-medium [&_strong]:text-bone">
        {children}
      </div>
    </section>
  );
}
