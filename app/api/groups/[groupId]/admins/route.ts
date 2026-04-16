import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/db";
import { telegram } from "@/lib/telegram";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { payload } = await jwtVerify(token, JWT_SECRET).catch(() => ({ payload: null }));
  if (!payload) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (payload as { sub: string }).sub;
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId } },
    include: { group: true },
  });
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const group = membership.group;

  // Fetch live admins from Telegram
  let telegramAdmins: Array<{ status: string; user: { id: number; first_name: string; username?: string; is_bot?: boolean } }> = [];
  try {
    telegramAdmins = await telegram.getChatAdministrators(group.chatId);
  } catch {
    // ignore
  }

  // Get existing group members from DB
  const dbMembers = await prisma.groupMember.findMany({
    where: { groupId },
    include: { user: true },
  });

  // Merge: auto-add Telegram admins that don't exist yet
  const nonBotAdmins = telegramAdmins.filter((a) => !a.user.is_bot);

  const result = await Promise.all(
    nonBotAdmins.map(async (admin) => {
      const dbUser = await prisma.user.findUnique({ where: { telegramId: String(admin.user.id) } });
      const dbMember = dbMembers.find((m) => m.user.telegramId === String(admin.user.id));

      return {
        telegramId: String(admin.user.id),
        firstName: admin.user.first_name,
        username: admin.user.username || null,
        telegramStatus: admin.status,
        inDashboard: !!dbUser,
        dashboardRole: dbMember?.role || null,
        approved: dbMember?.approved ?? null,
        userId: dbUser?.id || null,
      };
    })
  );

  return NextResponse.json({ admins: result, groupTitle: group.title });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { payload } = await jwtVerify(token, JWT_SECRET).catch(() => ({ payload: null }));
  if (!payload) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (payload as { sub: string }).sub;
  const requesterMembership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId } },
  });
  if (!requesterMembership || requesterMembership.role !== "OWNER") {
    return NextResponse.json({ error: "Only group owners can manage admins" }, { status: 403 });
  }

  const { targetUserId, approved, role } = await req.json();
  await prisma.groupMember.update({
    where: { userId_groupId: { userId: targetUserId, groupId } },
    data: { approved: approved ?? undefined, role: role ?? undefined },
  });

  return NextResponse.json({ ok: true });
}
