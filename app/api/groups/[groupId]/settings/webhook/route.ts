import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/db";
import { telegram } from "@/lib/telegram";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { payload } = await jwtVerify(token, JWT_SECRET).catch(() => ({ payload: null }));
  if (!payload) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const config = await prisma.botConfig.findUnique({ where: { groupId } });
  if (!config) return NextResponse.json({ error: "Config not found" }, { status: 404 });

  const webhookUrl = `${process.env.WEBHOOK_BASE_URL}/api/webhook`;

  try {
    await telegram.setWebhook(webhookUrl, config.webhookSecret);
    return NextResponse.json({ ok: true, url: webhookUrl });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Failed" });
  }
}
