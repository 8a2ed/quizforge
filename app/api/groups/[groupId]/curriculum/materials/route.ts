import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/db";
import { extractTextFromBuffer } from "@/lib/textExtractor";
import { getMaterials, saveMaterial, getGroupAISettings, updateGroupAISettings, CurriculumMaterial } from "@/lib/aiStorage";

export const maxDuration = 300;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

async function getAuthorizedUser(req: NextRequest, groupId: string) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = (payload as { sub: string }).sub;

    let userObj: { id: string; firstName: string; username?: string | null; photoUrl?: string | null } | null = null;
    try {
      const membership = await prisma.groupMember.findUnique({
        where: { userId_groupId: { userId, groupId } },
        include: { user: true },
      });
      if (membership && membership.approved) {
        userObj = membership.user;
      }
    } catch {
      // If DB transient or offline in dev, fall back to token payload
    }

    if (!userObj) {
      userObj = {
        id: userId,
        firstName: (payload as { firstName?: string }).firstName || "المعلم",
        username: (payload as { username?: string }).username || undefined,
        photoUrl: (payload as { photoUrl?: string }).photoUrl || undefined,
      };
    }

    return {
      userId,
      user: userObj,
    };
  } catch {
    return null;
  }
}

// GET /api/groups/[groupId]/curriculum/materials
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const auth = await getAuthorizedUser(req, groupId);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const materials = await getMaterials(groupId);
  return NextResponse.json({ materials });
}

// POST /api/groups/[groupId]/curriculum/materials
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const auth = await getAuthorizedUser(req, groupId);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = req.headers.get("content-type") || "";

  let title = "";
  let subject = "";
  let grade = "";
  let fileName = "";
  let fileType: "pdf" | "docx" | "txt" | "manual" | "image" = "manual";
  let mimeType = "application/octet-stream";
  let buffer: Buffer | null = null;
  let customText = "";
  let topics: string[] = [];
  let forceOcr = false;
  let clientApiKey = "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    title = (formData.get("title") as string) || "";
    subject = (formData.get("subject") as string) || "عام";
    grade = (formData.get("grade") as string) || "";
    const rawTopics = (formData.get("topics") as string) || "";
    topics = rawTopics.split(",").map((t) => t.trim()).filter(Boolean);
    clientApiKey = ((formData.get("apiKey") as string) || "").trim();

    if (!file) {
      return NextResponse.json({ error: "لم يتم تحديد أي ملف للرفع" }, { status: 400 });
    }

    fileName = file.name;
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    if (ext === "pdf") {
      fileType = "pdf";
      mimeType = "application/pdf";
    } else if (ext === "docx") {
      fileType = "docx";
      mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    } else if (ext === "txt" || ext === "md") {
      fileType = "txt";
      mimeType = "text/plain";
    } else if (["png", "jpg", "jpeg", "webp"].includes(ext)) {
      fileType = "image";
      if (ext === "png") mimeType = "image/png";
      else if (ext === "webp") mimeType = "image/webp";
      else mimeType = "image/jpeg";
    } else {
      return NextResponse.json(
        {
          error:
            "نوع الملف غير مدعوم. الصيغ المدعومة هي: PDF, DOCX, TXT، أو الصور ومستندات خط اليد (PNG, JPG, JPEG, WEBP)",
        },
        { status: 400 }
      );
    }

    const rawForceOcr = formData.get("forceOcr");
    forceOcr = rawForceOcr === "true" || rawForceOcr === "1";

    const arrayBuffer = await file.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
    if (!title) {
      title = fileName.replace(/\.[^/.]+$/, "");
    }
  } else {
    // JSON body (direct manual text input)
    const body = await req.json();
    title = body.title?.trim() || "";
    subject = body.subject?.trim() || "عام";
    grade = body.grade?.trim() || "";
    customText = body.text?.trim() || "";
    fileName = body.fileName || "custom_curriculum.txt";
    fileType = "manual";
    topics = Array.isArray(body.topics) ? body.topics : [];
    clientApiKey = (body.apiKey || "").trim();

    if (!customText) {
      return NextResponse.json({ error: "نص المنهج الدراسي مطلوب" }, { status: 400 });
    }

    buffer = Buffer.from(customText, "utf-8");
  }

  if (!buffer || buffer.length === 0) {
    return NextResponse.json({ error: "محتوى الملف فارغ" }, { status: 400 });
  }

  if (buffer.length > 50 * 1024 * 1024) {
    return NextResponse.json(
      {
        error: `حجم الملف (${(buffer.length / (1024 * 1024)).toFixed(1)} ميجابايت) يتجاوز الحد الأقصى المسموح به للخادم (50 ميجابايت). يرجى تقليل حجم الكتاب أو ضغطه أو تقسيمه.`,
      },
      { status: 413 }
    );
  }

  try {
    let apiKey = clientApiKey;
    let aiModel = "gemini-3.8-flash";
    try {
      const aiSettings = await getGroupAISettings(groupId);
      if (!apiKey) apiKey = aiSettings.geminiApiKey || process.env.GEMINI_API_KEY || "";
      if (aiSettings.defaultModel) aiModel = aiSettings.defaultModel;
    } catch {
      if (!apiKey) apiKey = process.env.GEMINI_API_KEY || "";
    }

    // Auto-persist valid clientApiKey if group had none
    if (clientApiKey && clientApiKey.length > 8 && !clientApiKey.includes("••••")) {
      try {
        await updateGroupAISettings(groupId, { geminiApiKey: clientApiKey });
      } catch {}
    }

    const extraction = await extractTextFromBuffer(buffer, fileType, {
      apiKey,
      model: aiModel,
      fileName,
      mimeType,
      forceOcr,
    });

    if (!extraction.cleanedText || extraction.cleanedText.length < 15) {
      return NextResponse.json(
        {
          error:
            "لم يتم العثور على نص كافٍ في الملف. تأكد من وضوح المحتوى، وإذا كان المستند ممسوحاً ضوئياً أو خط يد فتأكد من تفعيل مفتاح Google Gemini API Key في تبويب 'إعدادات الذكاء الاصطناعي'.",
        },
        { status: 400 }
      );
    }

    const combinedTopics = Array.from(
      new Set([...topics, ...extraction.suggestedTopics])
    ).slice(0, 10);

    const material: CurriculumMaterial = {
      id: `mat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      groupId,
      title: title || "منهج دراسي جديد",
      subject: subject || "عام",
      grade: grade || "",
      fileName,
      fileType,
      fileSize: buffer.length,
      rawText: extraction.rawText,
      cleanedText: extraction.cleanedText,
      wordCount: extraction.wordCount,
      charCount: extraction.charCount,
      topics: combinedTopics,
      sections: extraction.sections,
      ocrUsed: extraction.ocrUsed,
      digitalFallback: extraction.digitalFallback,
      uploadedBy: {
        id: auth.userId,
        name: auth.user.firstName || "المعلم",
        username: auth.user.username || undefined,
        photoUrl: auth.user.photoUrl || undefined,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await saveMaterial(material);

    return NextResponse.json({
      success: true,
      material,
      notice: extraction.notice,
      digitalFallback: extraction.digitalFallback,
      message: extraction.notice || "تم رفع واستخراج النص من المنهج بنجاح!",
    });
  } catch (err: unknown) {
    console.error("[Materials API Error]", err);
    const msg = err instanceof Error ? err.message : "فشل استخراج وتحليل الملف";
    const status =
      msg.includes("50 ميجابايت") ||
      msg.includes("يتجاوز الحد الأقصى") ||
      msg.toLowerCase().includes("too large")
        ? 413
        : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
