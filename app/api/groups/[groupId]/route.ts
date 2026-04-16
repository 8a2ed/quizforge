import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

async function authorize(req: NextRequest, groupId: string) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;
  const { payload } = await jwtVerify(token, JWT_SECRET).catch(() => ({ payload: null }));
  if (!payload) return null;
  const userId = (payload as { sub: string }).sub;
  return withRetry(() => prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId } },
    include: { group: true },
  }));
}

// GET /api/groups/[groupId] — get group details
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const membership = await authorize(req, groupId);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const group = await withRetry(() => prisma.group.findUnique({
    where: { id: groupId },
    include: {
      _count: { select: { quizzes: true, members: true } },
      botConfig: true,
    },
  }));

  return NextResponse.json({ group, role: membership.role });
}

// DELETE /api/groups/[groupId] — remove self from group (or delete group if last owner)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { payload } = await jwtVerify(token, JWT_SECRET).catch(() => ({ payload: null }));
  if (!payload) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (payload as { sub: string }).sub;

  const membership = await withRetry(() => prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId } },
    include: { group: true },
  }));
  if (!membership) return NextResponse.json({ error: "Not a member" }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { deleteGroup?: boolean };

  // Only owners can fully delete a group
  if (body.deleteGroup && membership.role !== "OWNER") {
    return NextResponse.json({ error: "Only the group owner can delete the group." }, { status: 403 });
  }

  if (body.deleteGroup) {
    // Hard delete: remove all related data in order
    await withRetry(() => prisma.pollAnswer.deleteMany({ where: { quiz: { groupId } } }));
    await withRetry(() => prisma.quiz.deleteMany({ where: { groupId } }));
    await withRetry(() => prisma.topic.deleteMany({ where: { groupId } }));
    await withRetry(() => prisma.groupMember.deleteMany({ where: { groupId } }));
    await withRetry(() => prisma.botConfig.deleteMany({ where: { groupId } }));
    await withRetry(() => prisma.group.delete({ where: { id: groupId } }));
    return NextResponse.json({ ok: true, deleted: true });
  }

  // Soft: just remove this user from the group
  await withRetry(() => prisma.groupMember.delete({
    where: { userId_groupId: { userId, groupId } },
  }));
  return NextResponse.json({ ok: true, left: true });
}
