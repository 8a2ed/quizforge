import { getApprovedGroupMember } from "@/lib/groupAuth";
import { NextRequest, NextResponse } from "next/server";
import { getGroupAISettings, updateGroupAISettings, isValidApiKeyCandidate } from "@/lib/aiStorage";
import { testGeminiConnection, DEFAULT_GEMINI_MODEL } from "@/lib/gemini";
import { readJsonObject } from "@/lib/http";

// POST /api/groups/[groupId]/curriculum/settings/test
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const membership = await getApprovedGroupMember(req, groupId);
  if (!membership) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await readJsonObject(req);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  let apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : DEFAULT_GEMINI_MODEL;
  if (model.length > 120) return NextResponse.json({ error: "Invalid model name" }, { status: 400 });

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

  const autoSave = body.autoSave === true;
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
