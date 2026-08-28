import type * as Web3 from "@solana/web3.js";

/*
  One way to reach the Solana library, so its interop quirk is handled once.

  It ships as CommonJS. Depending on how a route is bundled, importing it
  yields either the module itself or a wrapper with everything under `default`
  — and destructuring the wrong one gives `undefined` for every class, so
  `new Connection(...)` fails with "is not a constructor". That surfaces as an
  uncaught throw and an empty 500, which says nothing about the cause.

  Importing at module scope has the same problem in reverse: the classes aren't
  ready when a route file is first evaluated. So it loads on use, through here,
  and unwraps whichever shape it arrives in.
*/

let cached: typeof Web3 | null = null;

export async function web3(): Promise<typeof Web3> {
  if (cached) return cached;
  const mod = (await import("@solana/web3.js")) as unknown as {
    default?: typeof Web3;
  } & typeof Web3;

  /*
    Pick whichever shape actually carries the classes. Checking for a known
    export is more reliable than guessing from the module's own flags, which
    differ between bundlers.
  */
  const resolved =
    typeof mod?.PublicKey === "function"
      ? mod
      : typeof mod?.default?.PublicKey === "function"
        ? mod.default
        : null;

  if (!resolved) throw new Error("Solana library unavailable in this runtime.");
  cached = resolved;
  return resolved;
}
