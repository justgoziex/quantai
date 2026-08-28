import { NextResponse } from "next/server";

/*
  Surface the real failure.

  An uncaught throw inside a route returns an empty 500 — the browser shows
  "Request failed (500)" and the cause is invisible on both sides. That has
  cost hours: every diagnosis became a guess about which line threw, when the
  error itself was sitting right there unlogged.

  Wrapping a handler means the exception is written to the server log AND
  returned to the caller, so a failure names itself the first time it happens.
*/
export function withErrors<T extends (...args: never[]) => Promise<Response | undefined>>(
  name: string,
  handler: T,
): T {
  return (async (...args: Parameters<T>) => {
    try {
      const out = await handler(...args);
      // a handler that falls through without returning is itself a bug worth
      // reporting rather than a silent empty response
      if (!out) throw new Error("handler returned nothing");
      return out;
    } catch (e) {
      const err = e as Error;
      // eslint-disable-next-line no-console
      console.error(`[${name}] ${err?.message}`, err?.stack);
      return NextResponse.json(
        {
          error: err?.message ? `${name}: ${err.message}`.slice(0, 300) : `${name} failed.`,
        },
        { status: 500 },
      );
    }
  }) as T;
}
