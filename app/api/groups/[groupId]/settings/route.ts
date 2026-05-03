import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/db";
import { telegram } from "@/lib/telegram";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

async function authorize(req: NextRequest, groupId: string) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;
  const { payload } = await jwtVerify(token, JWT_SECRET).catch(() => ({ payload: null }));
  if (!payload) return null;
  const userId = (payload as { sub: string }).sub;
  return prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId } },
    include: { group: true },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const membership = await authorize(req, groupId);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [config, webhookStatus] = await Promise.all([
    prisma.botConfig.findUnique({ where: { groupId } }),
    telegram.getWebhookInfo().catch(() => null),
  ]);

  let botInfo = null;
  try {
    botInfo = await telegram.getMe();
  } catch {}

  return NextResponse.json({ config, botInfo, webhookStatus });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const membership = await authorize(req, groupId);
  if (!membership || membership.role === "VIEWER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const updated = await prisma.botConfig.update({
    where: { groupId },
    data: {
      defaultAnonymous:  body.defaultAnonymous  ?? undefined,
      allowMultiple:     body.allowMultiple      ?? undefined,
      defaultType:       body.defaultType        ?? undefined,
      defaultOpenPeriod: body.defaultOpenPeriod  ?? undefined,
    },
  });

  return NextResponse.json({ ok: true, config: updated });
}
