import { NextRequest, NextResponse } from "next/server";
import { telegram } from "@/lib/telegram";
import { getApprovedGroupMember } from "@/lib/groupAuth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const membership = await getApprovedGroupMember(req, groupId);
  if (!membership) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const bot = await telegram.getMe();
    return NextResponse.json({ ok: true, username: bot.username, id: bot.id });
  } catch {
    return NextResponse.json({ ok: false, error: "Bot connection failed" }, { status: 502 });
  }
}
