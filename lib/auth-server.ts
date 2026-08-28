import { createRemoteJWKSet, jwtVerify } from "jose";

/*
  Server-side verification of Privy access tokens.
  Privy signs ES256 JWTs verifiable against the app's public JWKS —
  no app secret required. `sub` is the stable privy DID (did:privy:…).
*/
const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

const jwks = APP_ID
  ? createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${APP_ID}/jwks.json`))
  : null;

export type AuthedIdentity = { privyId: string };

export async function verifyBearer(req: Request): Promise<AuthedIdentity | null> {
  if (!jwks || !APP_ID) return null;
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const { payload } = await jwtVerify(header.slice(7), jwks, {
      issuer: "privy.io",
      audience: APP_ID,
    });
    if (typeof payload.sub !== "string") return null;
    return { privyId: payload.sub };
  } catch {
    return null;
  }
}
