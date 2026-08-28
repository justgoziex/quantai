import { NextResponse } from "next/server";
import { getLaunchBanner } from "@/lib/config";

export const dynamic = "force-dynamic";

/* Public: is the launch modal still running? */
export async function GET() {
  try {
    const cfg = await getLaunchBanner();
    return NextResponse.json(
      { enabled: cfg.enabled === true },
      { headers: { "cache-control": "public, max-age=60, s-maxage=60" } },
    );
  } catch {
    // a config blip must never make the modal appear unexpectedly
    return NextResponse.json({ enabled: false });
  }
}
