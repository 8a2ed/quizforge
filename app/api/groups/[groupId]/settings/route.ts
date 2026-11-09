import { getAuthSecret } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/db";
import { telegram } from "@/lib/telegram";

const JWT_SECRET = getAuthSecret();

async function authorize(req: NextRequest, groupId: string) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;
  const { payload } = await jwtVerify(token, JWT_SECRET).catch(() => ({ payload: null }));
  if (!payload) return null;
  const userId = (payload as { sub: string }).sub;
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId } },
    include: { group: true },
  });
  return membership?.approved ? membership : null;
}

function redactAISettings<T extends { geminiApiKey?: string | null }>(settings: T | null) {
  if (!settings) return null;
  const { geminiApiKey, ...safeSettings } = settings;
  return { ...safeSettings, hasApiKey: Boolean(geminiApiKey) };
}

import { getGroupAISettings, updateGroupAISettings, isValidApiKeyCandidate } from "@/lib/aiStorage";
import { normalizeModelName } from "@/lib/gemini";
import { readJsonObject } from "@/lib/http";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const membership = await authorize(req, groupId);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [config, webhookStatus, aiSettings] = await Promise.all([
    prisma.botConfig.findUnique({ where: { groupId } }),
    telegram.getWebhookInfo().catch(() => null),
    getGroupAISettings(groupId).catch(() => null),
  ]);

  let botInfo = null;
  try {
    botInfo = await telegram.getMe();
  } catch {}

  const safeConfig = config
    ? {
        id: config.id,
        groupId: config.groupId,
        defaultAnonymous: config.defaultAnonymous,
        allowMultiple: config.allowMultiple,
        defaultType: config.defaultType,
        defaultOpenPeriod: config.defaultOpenPeriod,
        webhookSecretConfigured: Boolean(config.webhookSecret),
      }
    : null;

  return NextResponse.json({ config: safeConfig, botInfo, webhookStatus, aiSettings: redactAISettings(aiSettings) });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const membership = await authorize(req, groupId);
  if (!membership || (membership.role !== "OWNER" && membership.role !== "ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await readJsonObject(req);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  if (body.defaultAnonymous !== undefined && typeof body.defaultAnonymous !== "boolean") {
    return NextResponse.json({ error: "defaultAnonymous must be a boolean" }, { status: 400 });
  }
  if (body.allowMultiple !== undefined && typeof body.allowMultiple !== "boolean") {
    return NextResponse.json({ error: "allowMultiple must be a boolean" }, { status: 400 });
  }
  if (body.defaultType !== undefined && body.defaultType !== "QUIZ" && body.defaultType !== "POLL") {
    return NextResponse.json({ error: "defaultType must be QUIZ or POLL" }, { status: 400 });
  }
  if (body.defaultOpenPeriod !== undefined && (
    typeof body.defaultOpenPeriod !== "number" || !Number.isInteger(body.defaultOpenPeriod) ||
    body.defaultOpenPeriod < 0 || body.defaultOpenPeriod > 600
  )) {
    return NextResponse.json({ error: "defaultOpenPeriod must be between 0 and 600 seconds" }, { status: 400 });
  }

  // Also support updating AI curriculum settings if provided
  let updatedAISettings = null;
  if (body.aiSettings !== undefined && (!body.aiSettings || typeof body.aiSettings !== "object" || Array.isArray(body.aiSettings))) {
    return NextResponse.json({ error: "aiSettings must be an object" }, { status: 400 });
  }
  const aiData = (body.aiSettings || body) as Record<string, unknown>;
  const aiUpdates: Parameters<typeof updateGroupAISettings>[1] = {};

  if (aiData.geminiApiKey !== undefined) {
    if (typeof aiData.geminiApiKey !== "string") return NextResponse.json({ error: "geminiApiKey must be a string" }, { status: 400 });
    const key = aiData.geminiApiKey.trim();
    if (key && !isValidApiKeyCandidate(key)) return NextResponse.json({ error: "Invalid Gemini API key format" }, { status: 400 });
    if (key) aiUpdates.geminiApiKey = key;
  }
  if (aiData.defaultModel !== undefined) {
    if (typeof aiData.defaultModel !== "string" || aiData.defaultModel.length > 120) {
      return NextResponse.json({ error: "defaultModel must be a valid model name" }, { status: 400 });
    }
    aiUpdates.defaultModel = normalizeModelName(aiData.defaultModel);
  }
  if (aiData.defaultDifficulty !== undefined) {
    if (!(["mixed", "easy", "medium", "hard"] as const).includes(aiData.defaultDifficulty as "mixed" | "easy" | "medium" | "hard")) {
      return NextResponse.json({ error: "Invalid defaultDifficulty" }, { status: 400 });
    }
    aiUpdates.defaultDifficulty = aiData.defaultDifficulty as "mixed" | "easy" | "medium" | "hard";
  }
  if (aiData.defaultCount !== undefined) {
    const count = Number(aiData.defaultCount);
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      return NextResponse.json({ error: "defaultCount must be between 1 and 50" }, { status: 400 });
    }
    aiUpdates.defaultCount = count;
  }
  if (aiData.strictGrounding !== undefined) {
    if (typeof aiData.strictGrounding !== "boolean") return NextResponse.json({ error: "strictGrounding must be a boolean" }, { status: 400 });
    aiUpdates.strictGrounding = aiData.strictGrounding;
  }
  if (aiData.systemInstruction !== undefined) {
    if (typeof aiData.systemInstruction !== "string" || aiData.systemInstruction.length > 8_000) {
      return NextResponse.json({ error: "systemInstruction must be 8000 characters or less" }, { status: 400 });
    }
    aiUpdates.systemInstruction = aiData.systemInstruction;
  }

  const updated = await prisma.botConfig.update({
    where: { groupId },
    data: {
      defaultAnonymous:  body.defaultAnonymous  ?? undefined,
      allowMultiple:     body.allowMultiple      ?? undefined,
      defaultType:       body.defaultType        ?? undefined,
      defaultOpenPeriod: body.defaultOpenPeriod  ?? undefined,
    },
  });

  if (Object.keys(aiUpdates).length > 0) {
    try {
      updatedAISettings = await updateGroupAISettings(groupId, aiUpdates);
    } catch (e) {
      console.warn("[settings PATCH] AI settings update notice:", e);
    }
  }

  const { webhookSecret, ...safeConfig } = updated;
  return NextResponse.json({
    ok: true,
    config: { ...safeConfig, webhookSecretConfigured: Boolean(webhookSecret) },
    aiSettings: redactAISettings(updatedAISettings),
  });
}
