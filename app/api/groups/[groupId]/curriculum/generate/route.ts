import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/db";
import {
  getMaterialById,
  getGroupAISettings,
  updateGroupAISettings,
  recordGenerationLog,
  GenerationLog,
} from "@/lib/aiStorage";
import { generateCurriculumQuestions, DEFAULT_GEMINI_MODEL } from "@/lib/gemini";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

async function getAuthorizedUser(req: NextRequest, groupId: string) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = (payload as { sub: string }).sub;

    let userObj: { id: string; firstName: string; username?: string | null; photoUrl?: string | null } | null = null;
    try {
      const member = await prisma.groupMember.findUnique({
        where: { userId_groupId: { userId, groupId } },
        include: { user: true },
      });
      if (member && member.approved) {
        userObj = member.user;
      }
    } catch {}

    if (!userObj) {
      userObj = {
        id: userId,
        firstName: (payload as { firstName?: string }).firstName || "المعلم",
        username: (payload as { username?: string }).username || undefined,
        photoUrl: (payload as { photoUrl?: string }).photoUrl || undefined,
      };
    }

    return { userId, user: userObj };
  } catch {
    return null;
  }
}

// POST /api/groups/[groupId]/curriculum/generate
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const auth = await getAuthorizedUser(req, groupId);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      materialId,
      customText,
      sectionId,
      topic,
      questionCount = 5,
      difficulty = "mixed",
      customInstructions,
    } = body;

    let textExcerpt = "";
    let materialTitle = "نص مخصص";

    if (materialId) {
      const material = await getMaterialById(groupId, materialId);
      if (!material) {
        return NextResponse.json({ error: "المادة الدراسية المحددة غير موجودة" }, { status: 404 });
      }
      materialTitle = material.title;

      if (sectionId && material.sections) {
        const sec = material.sections.find((s) => s.id === sectionId);
        if (sec) {
          textExcerpt = sec.content;
          materialTitle = `${material.title} (${sec.title})`;
        } else {
          textExcerpt = material.cleanedText;
        }
      } else {
        textExcerpt = material.cleanedText;
      }
    } else if (customText && typeof customText === "string") {
      textExcerpt = customText.trim();
      materialTitle = body.materialTitle?.trim() || "نص مباشر مخصص";
    }

    if (!textExcerpt || textExcerpt.length < 30) {
      return NextResponse.json(
        { error: "النص المصدري قصير جداً أو غير متوفر لتوليد الأسئلة بدقة" },
        { status: 400 }
      );
    }

    // Load AI settings for this group
    const settings = await getGroupAISettings(groupId);
    const clientApiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    const apiKey = clientApiKey || settings.geminiApiKey || process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "لم يتم ضبط مفتاح Gemini API Key بعد. يرجى إدخال المفتاح في تبويب 'إعدادات الذكاء الاصطناعي' بالأعلى لحفظه واستخدامه.",
          missingKey: true,
        },
        { status: 400 }
      );
    }

    // If client supplied a valid key and group had none, auto-persist it
    if (clientApiKey && clientApiKey.length > 8 && !clientApiKey.includes("••••") && !settings.geminiApiKey) {
      try {
        await updateGroupAISettings(groupId, { geminiApiKey: clientApiKey });
      } catch {}
    }

    // Call Gemini with strict Zero-Hallucination prompt
    const result = await generateCurriculumQuestions({
      apiKey,
      model: settings.defaultModel || DEFAULT_GEMINI_MODEL,
      textExcerpt,
      materialTitle,
      topic,
      questionCount: Number(questionCount) || 5,
      difficulty,
      strictGrounding: settings.strictGrounding,
      systemInstruction: [settings.systemInstruction, customInstructions].filter(Boolean).join("\n"),
    });

    // If fallback was used to a newer active model, auto-update the group settings
    if (result.modelUsed && result.modelUsed !== settings.defaultModel) {
      try {
        await updateGroupAISettings(groupId, { defaultModel: result.modelUsed });
      } catch (e) {
        console.warn("[CurriculumGenerate] Auto-persisting working model warning:", e);
      }
    }

    // Record audit log and usage metrics
    const log: GenerationLog = {
      id: `gen_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      groupId,
      userId: auth.userId,
      userName: auth.user.firstName || "المعلم",
      userUsername: auth.user.username || undefined,
      userPhoto: auth.user.photoUrl || undefined,
      materialId: materialId || undefined,
      materialTitle,
      questionCount: result.questions.length,
      modelUsed: result.modelUsed,
      estimatedTokens: result.estimatedTokens,
      difficulty,
      timestamp: new Date().toISOString(),
      success: true,
      questionsSummary: result.questions.map((q) => ({
        question: q.question,
        difficulty: q.difficulty,
        topic: q.topic,
      })),
    };

    await recordGenerationLog(log);

    return NextResponse.json({
      success: true,
      questions: result.questions,
      modelUsed: result.modelUsed,
      estimatedTokens: result.estimatedTokens,
      durationMs: result.durationMs,
      materialTitle,
      logId: log.id,
      fallbackUsed: result.fallbackUsed,
    });
  } catch (err: unknown) {
    console.error("[Curriculum Generate Error]", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "فشل توليد الأسئلة بواسطة الذكاء الاصطناعي",
      },
      { status: 500 }
    );
  }
}
