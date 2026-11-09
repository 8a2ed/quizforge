import { getAuthSecret } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/db";
import { getGroupAISettings, updateGroupAISettings, isValidApiKeyCandidate } from "@/lib/aiStorage";
import { DEFAULT_GEMINI_MODEL, normalizeModelName } from "@/lib/gemini";

export const dynamic = "force-dynamic";

const JWT_SECRET = getAuthSecret();

async function checkAuth(req: NextRequest, groupId: string) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (typeof payload.sub !== "string") return null;
    const membership = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: payload.sub, groupId } },
      select: { role: true, approved: true },
    });
    return membership?.approved ? { userId: payload.sub, role: membership.role } : null;
  } catch {
    return null;
  }
}

// GET /api/groups/[groupId]/curriculum/settings
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const auth = await checkAuth(req, groupId);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await getGroupAISettings(groupId);
  const { geminiApiKey, ...publicSettings } = settings;

  return NextResponse.json({
    settings: {
      ...publicSettings,
      defaultModel: settings.defaultModel || DEFAULT_GEMINI_MODEL,
      hasApiKey: Boolean(geminiApiKey),
    },
  });
}

// PATCH /api/groups/[groupId]/curriculum/settings
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const auth = await checkAuth(req, groupId);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (auth.role !== "OWNER" && auth.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const updates: Parameters<typeof updateGroupAISettings>[1] = {};

  if (body.geminiApiKey !== undefined) {
    const key = String(body.geminiApiKey).trim();
    if (isValidApiKeyCandidate(key)) {
      updates.geminiApiKey = key;
    }
  }

  if (body.defaultModel) updates.defaultModel = normalizeModelName(body.defaultModel);
  if (body.defaultDifficulty) updates.defaultDifficulty = body.defaultDifficulty;
  if (body.defaultCount) updates.defaultCount = Number(body.defaultCount) || 5;
  if (body.strictGrounding !== undefined) updates.strictGrounding = Boolean(body.strictGrounding);
  if (body.systemInstruction !== undefined) updates.systemInstruction = String(body.systemInstruction);

  const updated = await updateGroupAISettings(groupId, updates);
  const { geminiApiKey, ...publicSettings } = updated;

  return NextResponse.json({
    success: true,
    message: "تم حفظ إعدادات الذكاء الاصطناعي بنجاح!",
    settings: {
      ...publicSettings,
      hasApiKey: Boolean(geminiApiKey),
    },
  });
}
