import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/db";
import { telegram } from "@/lib/telegram";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

async function requireMember(req: NextRequest, groupId: string) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;
  const { payload } = await jwtVerify(token, JWT_SECRET).catch(() => ({ payload: null }));
  if (!payload) return null;
  const userId = (payload as { sub: string }).sub;
  const m = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId } },
    include: { group: true },
  });
  return m ? { userId, membership: m } : null;
}

// GET — list admins (Telegram group admins + DB-only members)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const auth = await requireMember(req, groupId);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const group = auth.membership.group;

  // Fetch live admins from Telegram
  let telegramAdmins: Array<{
    status: string;
    user: { id: number; first_name: string; username?: string; is_bot?: boolean };
  }> = [];
  try {
    telegramAdmins = await telegram.getChatAdministrators(group.chatId);
  } catch { /* ignore — bot might not be admin */ }

  // Get DB members
  const dbMembers = await prisma.groupMember.findMany({
    where: { groupId },
    include: { user: true },
  });

  // Build Telegram admin rows
  const nonBotAdmins = telegramAdmins.filter((a) => !a.user.is_bot);
  const telegramRows = await Promise.all(
    nonBotAdmins.map(async (admin) => {
      const dbUser = await prisma.user.findUnique({
        where: { telegramId: String(admin.user.id) },
      });
      const dbMember = dbMembers.find(
        (m) => m.user.telegramId === String(admin.user.id)
      );
      return {
        telegramId: String(admin.user.id),
        firstName: admin.user.first_name,
        username: admin.user.username || null,
        telegramStatus: admin.status,
        inDashboard: !!dbUser,
        dashboardRole: dbMember?.role || null,
        approved: dbMember?.approved ?? null,
        userId: dbUser?.id || null,
        source: "telegram" as const,
      };
    })
  );

  // Dashboard-only members (added by @username, not Telegram admins)
  const dashboardOnly = dbMembers
    .filter(
      (m) =>
        !nonBotAdmins.some((a) => String(a.user.id) === m.user.telegramId)
    )
    .map((m) => ({
      telegramId: m.user.telegramId || null,
      firstName: m.user.firstName,
      username: m.user.username || null,
      telegramStatus: null as string | null,
      inDashboard: true,
      dashboardRole: m.role,
      approved: m.approved,
      userId: m.user.id,
      source: "dashboard" as const,
    }));

  return NextResponse.json({
    admins: [...telegramRows, ...dashboardOnly],
    groupTitle: group.title,
  });
}

// POST — add a user by their Telegram @username
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const auth = await requireMember(req, groupId);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.membership.role !== "OWNER") {
    return NextResponse.json({ error: "Only owners can add admins" }, { status: 403 });
  }

  const body = await req.json();
  const raw = String(body.telegramUsername || "").replace(/^@/, "").trim();
  if (!raw) {
    return NextResponse.json({ error: "telegramUsername is required" }, { status: 400 });
  }

  // Find user by Telegram username — try exact case-insensitive first, then fuzzy
  let user = await prisma.user.findFirst({
    where: { username: { equals: raw, mode: "insensitive" } },
  });

  // Fallback 1: strip underscores for fuzzy match
  if (!user) {
    const allUsers = await prisma.user.findMany({
      where: { username: { not: null } },
      select: { id: true, firstName: true, username: true },
    });
    user = allUsers.find(
      (u) => u.username?.toLowerCase().replace(/_/g, "") === raw.toLowerCase().replace(/_/g, "")
    ) || null;
  }

  // Fallback 2: search by firstName (for users with no public Telegram username)
  if (!user) {
    user = await prisma.user.findFirst({
      where: { firstName: { contains: raw, mode: "insensitive" } },
    });
  }

  if (!user) {
    return NextResponse.json({
      error: `No account found for "${raw}". Make sure they log in at quiz.agridmulms.me/login with Telegram first. You can also search by their first name if their Telegram username is private.`,
      notFound: true,
    }, { status: 404 });
  }

  // Already a member? Just ensure they're approved
  const existing = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: user.id, groupId } },
  });
  if (existing) {
    if (existing.approved) {
      return NextResponse.json({
        error: `${user.firstName} (@${user.username}) is already an active member of this group.`,
        alreadyMember: true,
      }, { status: 409 });
    }
    // Re-approve if they were revoked
    await prisma.groupMember.update({
      where: { userId_groupId: { userId: user.id, groupId } },
      data: { approved: true, role: "ADMIN" },
    });
    return NextResponse.json({
      ok: true,
      restored: true,
      user: { id: user.id, firstName: user.firstName, username: user.username },
    });
  }

  await prisma.groupMember.create({
    data: { userId: user.id, groupId, role: "ADMIN", approved: true },
  });

  return NextResponse.json({
    ok: true,
    user: { id: user.id, firstName: user.firstName, username: user.username },
  });
}

// PATCH — update role / approval
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const auth = await requireMember(req, groupId);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.membership.role !== "OWNER") {
    return NextResponse.json({ error: "Only owners can manage admins" }, { status: 403 });
  }

  const { targetUserId, approved, role } = await req.json();
  await prisma.groupMember.update({
    where: { userId_groupId: { userId: targetUserId, groupId } },
    data: {
      approved: approved !== undefined ? approved : undefined,
      role: role !== undefined ? role : undefined,
    },
  });

  return NextResponse.json({ ok: true });
}

// DELETE — remove a user from this group
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const auth = await requireMember(req, groupId);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.membership.role !== "OWNER") {
    return NextResponse.json({ error: "Only owners can remove admins" }, { status: 403 });
  }

  const { targetUserId } = await req.json();
  if (!targetUserId) {
    return NextResponse.json({ error: "targetUserId required" }, { status: 400 });
  }

  await prisma.groupMember.deleteMany({
    where: { userId: targetUserId, groupId },
  });

  return NextResponse.json({ ok: true });
}
