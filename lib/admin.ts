import { NextResponse } from "next/server";
import { prisma } from "./db";
import { requireUser } from "./api";

/*
  Admin helpers — role gate on top of requireUser, plus the append-only
  audit trail every mutating admin action must write.
*/
export async function requireAdmin(req: Request) {
  const res = await requireUser(req);
  if ("error" in res) return res;
  if (res.user.role !== "ADMIN") {
    return {
      error: NextResponse.json({ error: "Admin access required." }, { status: 403 }),
    } as const;
  }
  return res;
}

export async function auditLog(
  adminId: string,
  action: string,
  targetType: string,
  targetId?: string,
  meta?: Record<string, string | number | boolean | null>,
) {
  try {
    await prisma.adminActionLog.create({
      data: { adminId, action, targetType, targetId: targetId ?? null, meta: meta ?? {} },
    });
  } catch (e) {
    console.error("audit log failed:", (e as Error).message);
  }
}
