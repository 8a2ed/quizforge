import { jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import { getAuthSecret } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function getApprovedGroupMember(
  req: NextRequest,
  groupId: string
): Promise<{ userId: string; role: string } | null> {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getAuthSecret());
    if (typeof payload.sub !== "string") return null;
    const membership = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: payload.sub, groupId } },
      select: { approved: true, role: true },
    });
    return membership?.approved ? { userId: payload.sub, role: membership.role } : null;
  } catch {
    return null;
  }
}
