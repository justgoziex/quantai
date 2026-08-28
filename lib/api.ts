import { NextResponse } from "next/server";
import { prisma, dbConfigured } from "./db";
import { verifyBearer } from "./auth-server";

export function dbUnavailable() {
  return NextResponse.json(
    { error: "Database not configured. Set DATABASE_URL and migrate." },
    { status: 503 },
  );
}

export function unauthorized() {
  return NextResponse.json({ error: "Sign in required." }, { status: 401 });
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/* Verifies the bearer token and loads (without creating) the user row. */
export async function requireUser(req: Request) {
  if (!dbConfigured) return { error: dbUnavailable() } as const;
  const identity = await verifyBearer(req);
  if (!identity) return { error: unauthorized() } as const;
  const user = await prisma.user.findUnique({ where: { privyId: identity.privyId } });
  if (!user) {
    return {
      error: NextResponse.json(
        { error: "Account not synced yet. Call /api/auth/sync first." },
        { status: 404 },
      ),
    } as const;
  }
  if (user.status === "SUSPENDED") {
    return {
      error: NextResponse.json({ error: "Account suspended." }, { status: 403 }),
    } as const;
  }
  return { user } as const;
}

export function makeReferralCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
  let code = "";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  for (let i = 0; i < bytes.length; i++) code += alphabet[bytes[i] % alphabet.length];
  return code;
}
