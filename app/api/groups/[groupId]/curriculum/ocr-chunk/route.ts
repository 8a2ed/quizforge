import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/db";
import { getGroupAISettings, updateGroupAISettings, isValidApiKeyCandidate } from "@/lib/aiStorage";
import { extractChunkTextWithGemini, DEFAULT_GEMINI_MODEL } from "@/lib/gemini";

export const maxDuration = 120;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

async function checkAuth(req: NextRequest, groupId: string) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = (payload as { sub: string }).sub;

    try {
      const membership = await prisma.groupMember.findUnique({
        where: { userId_groupId: { userId, groupId } },
      });
      if (membership && membership.approved) {
        return userId;
      }
    } catch {
      // In offline / transient DB dev mode, fallback to payload sub
    }
    return userId;
  } catch {
    return null;
  }
}

// POST /api/groups/[groupId]/curriculum/ocr-chunk
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const userId = await checkAuth(req, groupId);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { pages, startPage = 1, endPage = 1, apiKey: clientApiKey, documentTitle } = body;

    const validPages = (Array.isArray(pages) ? pages : []).filter(
      (p: any) => typeof p === "string" && p.trim().length > 0
    );

    if (validPages.length === 0) {
      return NextResponse.json(
        { error: "لم يتم استلام أي صفحات صالحة للمعالجة البصرية." },
        { status: 400 }
      );
    }

    const settings = await getGroupAISettings(groupId);
    const cleanClientKey = typeof clientApiKey === "string" ? clientApiKey.trim() : "";
    const validClientKey = isValidApiKeyCandidate(cleanClientKey) ? cleanClientKey : "";
    const effectiveKey = validClientKey || settings.geminiApiKey || process.env.GEMINI_API_KEY || "";

    if (!effectiveKey) {
      return NextResponse.json(
        {
          error:
            "لم يتم العثور على مفتاح Google Gemini API Key. يرجى إدخال المفتاح في تبويب 'إعدادات الذكاء الاصطناعي' أو إضافته في ملف البيئة (GEMINI_API_KEY) لتفعيل ميزة التعرف البصري على الصور والمستندات (OCR).",
          missingKey: true,
        },
        { status: 400 }
      );
    }

    // Auto-persist valid key if group lacked one
    if (validClientKey && !settings.geminiApiKey) {
      try {
        await updateGroupAISettings(groupId, { geminiApiKey: validClientKey });
      } catch {}
    }

    const modelToUse = settings.defaultModel || DEFAULT_GEMINI_MODEL;

    const result = await extractChunkTextWithGemini({
      pages: validPages,
      startPage: Number(startPage) || 1,
      endPage: Number(endPage) || (Number(startPage) || 1) + validPages.length - 1,
      apiKey: effectiveKey,
      model: modelToUse,
      documentTitle,
    });

    return NextResponse.json({
      success: true,
      transcribedText: result.transcribedText,
      sections: result.sections,
      modelUsed: result.modelUsed,
    });
  } catch (err: any) {
    console.error("[OCR Chunk Error]:", err);
    const msg = err instanceof Error ? err.message : String(err);
    const isRateLimit = msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED");
    const isOverloaded = msg.includes("503") || msg.includes("overloaded");
    const status = isRateLimit ? 429 : isOverloaded ? 503 : 500;
    return NextResponse.json(
      {
        error: msg || "فشلت المعالجة البصرية للصفحات المحددة",
      },
      { status }
    );
  }
}
