import { NextRequest, NextResponse } from "next/server";
import { getApprovedGroupMember } from "@/lib/groupAuth";
import { prisma } from "@/lib/db";
import { telegram } from "@/lib/telegram";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const membership = await getApprovedGroupMember(req, groupId);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const config = await prisma.botConfig.findUnique({ where: { groupId } });
  if (!config) return NextResponse.json({ error: "Config not found" }, { status: 404 });

  const configuredBaseUrl = process.env.WEBHOOK_BASE_URL || process.env.NEXTAUTH_URL;
  if (!configuredBaseUrl) {
    return NextResponse.json({ ok: false, error: "Webhook base URL is not configured" }, { status: 503 });
  }

  try {
    const baseUrl = new URL(configuredBaseUrl);
    if (baseUrl.username || baseUrl.password || (process.env.NODE_ENV === "production" && baseUrl.protocol !== "https:")) {
      return NextResponse.json({ ok: false, error: "Invalid webhook base URL" }, { status: 500 });
    }
    const webhookUrl = new URL("/api/webhook", baseUrl).toString();
    await telegram.setWebhook(webhookUrl, config.webhookSecret);
    const info = await telegram.getWebhookInfo().catch(() => null);
    return NextResponse.json({ ok: true, url: webhookUrl, info });
  } catch (error) {
    console.error("[settings/webhook] Registration failed:", error);
    return NextResponse.json({ ok: false, error: "Webhook registration failed" }, { status: 502 });
  }
}
