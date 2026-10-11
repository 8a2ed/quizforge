import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getMaterialById, updateMaterial, deleteMaterial } from "@/lib/aiStorage";

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

// GET /api/groups/[groupId]/curriculum/materials/[materialId]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string; materialId: string }> }
) {
  const { groupId, materialId } = await params;
  const userId = await checkAuth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const material = await getMaterialById(groupId, materialId);
  if (!material) {
    return NextResponse.json({ error: "المادة الدراسية غير موجودة" }, { status: 404 });
  }

  return NextResponse.json({ material });
}

// PUT /api/groups/[groupId]/curriculum/materials/[materialId]
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string; materialId: string }> }
) {
  const { groupId, materialId } = await params;
  const userId = await checkAuth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (body.title !== undefined && !String(body.title).trim()) {
      return NextResponse.json(
        { error: "عنوان المنهج الدراسي مطلوب ولا يمكن تركه فارغاً" },
        { status: 400 }
      );
    }

    if (
      (body.cleanedText !== undefined || body.rawText !== undefined) &&
      !String(body.cleanedText || body.rawText || "").trim()
    ) {
      return NextResponse.json(
        { error: "نص ومحتوى المنهج الدراسي مطلوب ولا يمكن تركه فارغاً" },
        { status: 400 }
      );
    }

    const updated = await updateMaterial(groupId, materialId, body);
    if (!updated) {
      return NextResponse.json(
        { error: "المادة الدراسية غير موجودة أو لا تملك صلاحية تعديلها" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      material: updated,
      message: "تم تحديث المنهج الدراسي وحفظ التعديلات بنجاح",
    });
  } catch (err: unknown) {
    console.error("[Update Material Error]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "فشل تحديث المادة الدراسية" },
      { status: 500 }
    );
  }
}

// PATCH /api/groups/[groupId]/curriculum/materials/[materialId]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string; materialId: string }> }
) {
  return PUT(req, { params });
}

// DELETE /api/groups/[groupId]/curriculum/materials/[materialId]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string; materialId: string }> }
) {
  const { groupId, materialId } = await params;
  const userId = await checkAuth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const success = await deleteMaterial(groupId, materialId);
  if (!success) {
    return NextResponse.json({ error: "لم يتم العثور على المادة لحذفها" }, { status: 404 });
  }

  return NextResponse.json({ success: true, message: "تم حذف المادة بنجاح" });
}
