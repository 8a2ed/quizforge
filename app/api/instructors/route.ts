import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";
import bcrypt from "bcryptjs";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

async function requireOwner(req: NextRequest) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = (payload as { sub: string }).sub;
    // Must be OWNER of at least one group
    const ownership = await prisma.groupMember.findFirst({
      where: { userId, role: "OWNER" },
    });
    return ownership ? userId : null;
  } catch {
    return null;
  }
}

// GET — list all instructor accounts
export async function GET(req: NextRequest) {
  const userId = await requireOwner(req);
  if (!userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const credentials = await withRetry(() =>
    prisma.instructorCredential.findMany({
      include: { user: { select: { id: true, firstName: true, username: true, createdAt: true } } },
      orderBy: { createdAt: "desc" },
    })
  );

  return NextResponse.json({ credentials });
}

// POST — create a new instructor account
export async function POST(req: NextRequest) {
  const userId = await requireOwner(req);
  if (!userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { username, password, firstName, groupId } = await req.json();

  if (!username || !password || !firstName) {
    return NextResponse.json({ error: "username, password, and firstName are required" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  const existing = await prisma.instructorCredential.findUnique({
    where: { username: username.trim().toLowerCase() },
  });
  if (existing) {
    return NextResponse.json({ error: "Username already taken" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  // Create user + credential in a transaction
  const result = await withRetry(() =>
    prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          firstName: firstName.trim(),
          telegramId: null,
          credential: {
            create: {
              username: username.trim().toLowerCase(),
              passwordHash,
            },
          },
        },
      });

      // Optionally add to a group
      if (groupId) {
        await tx.groupMember.create({
          data: { userId: user.id, groupId, role: "ADMIN", approved: true },
        });
      }

      return user;
    })
  );

  return NextResponse.json({
    ok: true,
    user: { id: result.id, firstName: result.firstName, username: username.trim().toLowerCase() },
  });
}

// DELETE — remove an instructor account
export async function DELETE(req: NextRequest) {
  const userId = await requireOwner(req);
  if (!userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { instructorUserId } = await req.json();
  if (!instructorUserId) return NextResponse.json({ error: "instructorUserId required" }, { status: 400 });

  await withRetry(() => prisma.user.delete({ where: { id: instructorUserId } }));
  return NextResponse.json({ ok: true });
}

// PATCH — reset password
export async function PATCH(req: NextRequest) {
  const userId = await requireOwner(req);
  if (!userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { instructorUserId, newPassword } = await req.json();
  if (!instructorUserId || !newPassword) {
    return NextResponse.json({ error: "instructorUserId and newPassword required" }, { status: 400 });
  }
  if (newPassword.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await withRetry(() =>
    prisma.instructorCredential.update({
      where: { userId: instructorUserId },
      data: { passwordHash },
    })
  );

  return NextResponse.json({ ok: true });
}
