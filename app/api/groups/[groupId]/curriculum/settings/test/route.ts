import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getGroupAISettings } from "@/lib/aiStorage";
import { testGeminiConnection } from "@/lib/gemini";

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
  const model = body.model ? String(body.model).trim() : "gemini-2.0-flash";

  // If user passed placeholder or empty, read from saved group settings
  if (!apiKey || apiKey.includes("••••")) {
    const settings = await getGroupAISettings(groupId);
    apiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY || "";
  }

  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,
        message: "لم يتم تقديم أي مفتاح API لفحصه. يرجى إدخال المفتاح أولاً.",
      },
      { status: 400 }
    );
  }

  const result = await testGeminiConnection(apiKey, model);
  return NextResponse.json(result);
}
