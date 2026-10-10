import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getGroupAISettings, updateGroupAISettings, isValidApiKeyCandidate } from "@/lib/aiStorage";
import { DEFAULT_GEMINI_MODEL, normalizeModelName } from "@/lib/gemini";

export const dynamic = "force-dynamic";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

async function checkAuth(req: NextRequest) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return (payload as { sub: string }).sub;
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
  const userId = await checkAuth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await getGroupAISettings(groupId);
  const rawKey = settings.geminiApiKey || "";

  return NextResponse.json({
    settings: {
      ...settings,
      geminiApiKey: rawKey,
      defaultModel: settings.defaultModel || DEFAULT_GEMINI_MODEL,
      hasApiKey: !!rawKey,
      maskedApiKey: rawKey,
    },
  });
}

// PATCH /api/groups/[groupId]/curriculum/settings
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const userId = await checkAuth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
  const rawKey = updated.geminiApiKey || "";

  return NextResponse.json({
    success: true,
    message: "تم حفظ إعدادات الذكاء الاصطناعي بنجاح!",
    settings: {
      ...updated,
      geminiApiKey: rawKey,
      hasApiKey: !!rawKey,
      maskedApiKey: rawKey,
    },
  });
}
