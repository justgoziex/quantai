import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/marketing/nav";
import { Footer } from "@/components/marketing/footer";
import { Button } from "@/components/ui/button";
import { getLocale, tt } from "@/lib/i18n-server";

export const metadata: Metadata = {
  alternates: { canonical: "/developers/docs" },
  title: "Listing docs",
  description:
    "How tokens get on Quant AI: automatic indexing, developer listing, screening, promoted slots, and fees.",
};

/*
  Reference page for project teams. Written as statements rather than steps —
  the portal itself is three clicks, so a walkthrough would be longer than the
  thing it describes. Bilingual via the shared dictionary: a large share of the
  traders reading this are on 中文.
*/
export default async function DevDocsPage() {
  const locale = await getLocale();
  const T = (s: string) => tt(locale, s);

  /*
    Value and note are separate nodes on purpose. Translation runs client-side
    over whole text nodes, so a value like "0.002 ETH — free if already indexed"
    would match no dictionary key and stay English. Split, each half translates.
  */
  const facts: [string, string, string?][] = [
    [T("Chains"), "Ethereum · BNB Chain · Base · Robinhood"],
    [T("Token standard"), "ERC-20 / BEP-20"],
    [T("Requirement"), "", T("A live liquidity pool with real trades")],
    [T("Listing fee"), "0.002 ETH", T("free if already indexed")],
    [T("Promoted slot"), "0.3 ETH", T("per day")],
    [T("Trading fee"), "0.75%", T("charged to traders, not to you")],
  ];

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-wrap px-6 pb-24">
        <header className="border-b border-line py-12">
          <p className="text-label mb-4">{T("For developers")}</p>
          <h1 className="text-display-lg mb-4 text-bone" style={{ textWrap: "balance" }}>
            {T("Listing on Quant AI")}
          </h1>
          <p className="max-w-2xl text-base text-muted">
            {T(
              "Every token here is screened before anyone sees it. That is the point — traders arrive already knowing your contract passed, and the ones that pass get watched.",
            )}
          </p>
        </header>

        {/* the facts, up front */}
        <section className="border-b border-line py-10">
          <div className="overflow-hidden rounded-md border border-line">
            {facts.map(([k, v, note]) => (
              <div
                key={k}
                className="grid grid-cols-1 gap-1 border-b border-line bg-panel px-5 py-3.5 last:border-0 sm:grid-cols-[220px_1fr] sm:gap-5"
              >
                <span className="font-mono text-data-sm uppercase tracking-[0.1em] text-muted">{k}</span>
                <span className="text-sm text-bone">
                  {v ? <span>{v}</span> : null}
                  {v && note ? <span className="text-muted"> · </span> : null}
                  {note ? <span className={v ? "text-muted" : undefined}>{note}</span> : null}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="border-b border-line py-10">
          <h2 className="text-h1 mb-4 text-bone">{T("Most tokens are already here")}</h2>
          <p className="max-w-2xl text-base text-muted">
            {T(
              "Pairs are indexed automatically once they have liquidity and trades. Search your contract address — if it returns a page, you are listed and there is nothing to pay.",
            )}
          </p>
        </section>

        <section className="border-b border-line py-10">
          <h2 className="text-h1 mb-4 text-bone">{T("Listing what we miss")}</h2>
          <p className="mb-4 max-w-2xl text-base text-muted">
            {T(
              "New pairs, thin pools and quieter chains can fall through. The dev portal covers those: connect the wallet you deployed from and sign a message — no gas, no transaction — and every token that wallet created shows up.",
            )}
          </p>
          <p className="max-w-2xl text-base text-muted">
            {T("A one-time fee of 0.002 ETH.")}
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/developers">{T("Open the dev portal")}</Link>
            </Button>
          </div>
        </section>

        <section className="border-b border-line py-10">
          <h2 className="text-h1 mb-4 text-bone">{T("What waiting costs you")}</h2>
          <p className="mb-6 max-w-2xl text-base text-muted">
            {T(
              "An unindexed token is not ranked lower — it is absent. Not from one feature, from all of Quant AI:",
            )}
          </p>
          <div className="overflow-hidden rounded-md border border-line">
            {[
              [T("Token page"), T("Reads as not listed. No price, chart, score or analysis.")],
              [T("Screener & search"), T("Does not appear, and cannot be found by address.")],
              [T("Trading"), T("Not buyable on the site or in the Telegram bot.")],
              [T("Alerts & watchlists"), T("Traders cannot track it or set a price alert.")],
              [T("Channel calls"), T("Never eligible, however well it trades.")],
              [T("Promoted slots"), T("Cannot be bought — there is nothing to promote.")],
            ].map(([k, v]) => (
              <div
                key={k}
                className="grid grid-cols-1 gap-1 border-b border-line bg-panel px-5 py-3.5 last:border-0 sm:grid-cols-[220px_1fr] sm:gap-5"
              >
                <span className="font-mono text-data-sm uppercase tracking-[0.1em] text-muted">{k}</span>
                <span className="text-sm text-bone">{v}</span>
              </div>
            ))}
          </div>
          <p className="mt-6 max-w-2xl text-base text-muted">
            {T(
              "The crawler finds most pairs eventually. Listing decides when — and it has to be your deployer wallet, because the signature is what proves the token is yours to list.",
            )}
          </p>
        </section>

        <section className="border-b border-line py-10">
          <h2 className="text-h1 mb-4 text-bone">{T("Screening is not optional")}</h2>
          <p className="mb-4 max-w-2xl text-base text-muted">
            {T(
              "Ten gates run against the contract — honeypot simulation, LP lock, mint authority, holder concentration, taxes, depth, ownership, momentum. The result is a 0–100 score printed next to your token everywhere it appears.",
            )}
          </p>
          <p className="max-w-2xl text-base text-muted">
            {T(
              "A clean contract scores well and is treated accordingly. A contract that fails the honeypot simulation never reaches the feed. Listing does not change the score, and paying does not raise it.",
            )}
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button variant="secondary" asChild>
              <Link href="/scoring">{T("How scoring works")}</Link>
            </Button>
          </div>
        </section>

        <section className="border-b border-line py-10">
          <h2 className="text-h1 mb-4 text-bone">{T("Getting called")}</h2>
          <p className="max-w-2xl text-base text-muted">
            {T(
              "Tokens that hold up — real volume, healthy liquidity against market cap, buying that outweighs selling — get posted to the Quant AI channel on their own. Nobody buys a call. When one runs, the channel is told again at 2x, 3x, 5x.",
            )}
          </p>
        </section>

        <section className="border-b border-line py-10">
          <h2 className="text-h1 mb-4 text-bone">{T("Promoted slots")}</h2>
          <p className="max-w-2xl text-base text-muted">
            {T(
              "A paid banner rotates across the screener and every token page. It is marked as promoted and your real score still shows next to it — the placement is bought, the number is not.",
            )}
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button variant="secondary" asChild>
              <Link href="/developers/promote">{T("Buy a slot")}</Link>
            </Button>
          </div>
        </section>

        <section className="py-10">
          <h2 className="text-h1 mb-4 text-bone">{T("Anything else")}</h2>
          <p className="max-w-2xl text-base text-muted">
            {T("Terms, privacy and the risk disclaimer are linked in the footer.")}
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}
