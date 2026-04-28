import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = (payload as { sub: string }).sub;

    const membership = await withRetry(() => prisma.groupMember.findUnique({
      where: { userId_groupId: { userId, groupId } },
    }));

    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // Fetch distinct tags used in this group
    // Using raw SQL for efficiency to get distinct tags from the string array column
    type TagRow = { tag: string };
    const rows = await prisma.$queryRaw<TagRow[]>`
      SELECT DISTINCT unnest(tags) as tag
      FROM quizzes
      WHERE "groupId" = ${groupId}
      ORDER BY tag ASC
    `;

    const tags = rows.map((r) => r.tag).filter(Boolean);

    return NextResponse.json({ tags });
  } catch (error) {
    console.error("[Tags API] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
