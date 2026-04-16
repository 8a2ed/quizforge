import { NextRequest, NextResponse } from "next/server";
import { telegram } from "@/lib/telegram";

export async function GET(_req: NextRequest) {
  try {
    const bot = await telegram.getMe();
    return NextResponse.json({ ok: true, username: bot.username, id: bot.id });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Failed" });
  }
}
