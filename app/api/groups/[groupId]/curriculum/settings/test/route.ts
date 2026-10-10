import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getGroupAISettings, updateGroupAISettings, isValidApiKeyCandidate } from "@/lib/aiStorage";
import { testGeminiConnection, DEFAULT_GEMINI_MODEL } from "@/lib/gemini";

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

// POST /api/groups/[groupId]/curriculum/settings/test
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const userId = await checkAuth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  let apiKey = body.apiKey ? String(body.apiKey).trim() : "";
  const model = body.model ? String(body.model).trim() : DEFAULT_GEMINI_MODEL;

  // If user passed placeholder or invalid candidate, read from saved group settings
  if (!isValidApiKeyCandidate(apiKey)) {
    const settings = await getGroupAISettings(groupId);
    apiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY || "";
  }

  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,
        message: "لم يتم تقديم أي مفتاح API لفحصه. يرجى إدخال المفتاح أولاً.",
        activeModel: model || DEFAULT_GEMINI_MODEL,
        availableModels: [],
      },
      { status: 400 }
    );
  }

  const autoSave = Boolean(body.autoSave);
  const result = await testGeminiConnection(apiKey, model);

  // If connection succeeded and either autoSave was requested (e.g. from Auto-detect Models)
  // or a fallback was used because the requested model was deprecated,
  // automatically update the group's saved setting to the working model.
  if (result.success && result.activeModel && (autoSave || result.fallbackUsed)) {
    try {
      await updateGroupAISettings(groupId, { defaultModel: result.activeModel });
    } catch (e) {
      console.warn("[SettingsTest] Auto-persisting working model warning:", e);
    }
  }

  return NextResponse.json(result);
}
