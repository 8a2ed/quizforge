import fs from "fs/promises";
import path from "path";
import { ValidatedQuestion } from "./questionValidator";

export interface CurriculumMaterial {
  id: string;
  groupId: string;
  title: string;
  subject: string;
  grade: string;
  fileName: string;
  fileType: "pdf" | "docx" | "txt" | "manual" | "image";
  fileSize: number;
  rawText: string;
  cleanedText: string;
  wordCount: number;
  charCount: number;
  topics: string[];
  sections: Array<{ id: string; title: string; content: string; wordCount: number }>;
  uploadedBy: {
    id: string;
    name: string;
    username?: string;
    photoUrl?: string;
  };
  ocrUsed?: boolean;
  digitalFallback?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GenerationLog {
  id: string;
  groupId: string;
  userId: string;
  userName: string;
  userUsername?: string;
  userPhoto?: string;
  materialId?: string;
  materialTitle: string;
  questionCount: number;
  modelUsed: string;
  estimatedTokens: number;
  difficulty: string;
  timestamp: string;
  success: boolean;
  questionsSummary: Array<{
    question: string;
    difficulty: string;
    topic: string;
  }>;
}

export interface AISettings {
  groupId: string;
  geminiApiKey?: string;
  defaultModel: string;
  defaultDifficulty: "mixed" | "easy" | "medium" | "hard";
  defaultCount: number;
  strictGrounding: boolean;
  systemInstruction?: string;
  updatedAt: string;
}

export interface AIAnalyticsSummary {
  totalGenerations: number;
  totalQuestions: number;
  totalTokens: number;
  activeUsersCount: number;
  studentParticipants: number;
  averageScore: number;
  passRate: number;
  broadcastedQuizzesCount: number;
  examsCreatedCount: number;
  userLeaderboard: Array<{
    userId: string;
    userName: string;
    userUsername?: string;
    userPhoto?: string;
    generationsCount: number;
    questionsCount: number;
    lastActive: string;
  }>;
  materialsUsage: Array<{
    materialTitle: string;
    generationsCount: number;
    questionsCount: number;
  }>;
  difficultyBreakdown: {
    EASY: number;
    MEDIUM: number;
    HARD: number;
  };
  recentLogs: GenerationLog[];
}

const DATA_DIR = path.join(process.cwd(), "data", "ai_curriculum");
const MATERIALS_FILE = path.join(DATA_DIR, "materials.json");
const LOGS_FILE = path.join(DATA_DIR, "generation_logs.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

// Sequential write lock to avoid concurrent write collisions on Windows
let writeLock: Promise<void> = Promise.resolve();

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch {}
}

async function safeReadJson<T>(filePath: string, fallback: T): Promise<T> {
  await ensureDataDir();
  // Attempt to read with retry in case of transient Windows file lock (EBUSY/EPERM)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await fs.readFile(filePath, "utf-8");
      if (!data || !data.trim()) return fallback;
      return JSON.parse(data) as T;
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        return fallback;
      }
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 60 * (attempt + 1)));
      }
    }
  }

  // Backup fallback: if reading primary file failed, attempt reading .bak file
  try {
    const bakPath = `${filePath}.bak`;
    const bakData = await fs.readFile(bakPath, "utf-8");
    if (bakData && bakData.trim()) {
      return JSON.parse(bakData) as T;
    }
  } catch {}

  return fallback;
}

async function safeWriteJson<T>(filePath: string, data: T): Promise<void> {
  await ensureDataDir();
  const serialized = JSON.stringify(data, null, 2);

  const writeOperation = async () => {
    // Keep a .bak backup of the existing valid file before modifying
    try {
      await fs.copyFile(filePath, `${filePath}.bak`);
    } catch {}

    const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 6)}`;
    try {
      await fs.writeFile(tempPath, serialized, "utf-8");
      try {
        await fs.rename(tempPath, filePath);
      } catch {
        // Windows file locking fallback: copyFile atomically overwrites then clean up temp
        await fs.copyFile(tempPath, filePath);
        await fs.unlink(tempPath).catch(() => {});
      }
    } catch (writeErr) {
      console.error("[safeWriteJson error, attempting direct write fallback]", writeErr);
      try {
        await fs.writeFile(filePath, serialized, "utf-8");
        await fs.unlink(tempPath).catch(() => {});
      } catch (directErr) {
        console.error("[safeWriteJson direct write failed]", directErr);
      }
    }
  };

  writeLock = writeLock.then(writeOperation, writeOperation);
  await writeLock;
}

// ─── Default Sample Educational Materials ──────────────────────────────────────
const SAMPLE_MATERIALS: CurriculumMaterial[] = [
  {
    id: "sample-science-ar",
    groupId: "global",
    title: "الوحدة الأولى: القوى والحركة (السرعة النسبية والقانون الأول لنيوتن)",
    subject: "العلوم والفيزياء",
    grade: "المرحلة الإعدادية / الثانوية",
    fileName: "sample_unit1_physics.txt",
    fileType: "manual",
    fileSize: 4200,
    rawText: `الفصل الأول: الحركة في اتجاه واحد والسرعة
تعتبر الحركة هي تغير موضع الجسم بمرور الزمن بالنسبة لموضع جسم آخر ثابت.
السرعة هي المسافة المقطوعة خلال وحدة الزمن، أو المعدل الزمني للتغير في المسافة.
وحدة قياس السرعة في النظام الدولي هي المتر لكل ثانية (م/ث) أو الكيلومتر لكل ساعة (كم/س).
السرعة المنتظمة (الثابتة) هي السرعة التي يتحرك بها الجسم عندما يقطع مسافات متساوية في أزمنة متساوية.
أما السرعة غير المنتظمة فتحدث عندما يقطع الجسم مسافات متساوية في أزمنة غير متساوية، أو مسافات غير متساوية في أزمنة متساوية.

السرعة المتوسطة:
هي حاصل قسمة المسافة الكلية التي يقطعها الجسم المتحرك مقسومة على الزمن الكلي المستغرق لقطع هذه المسافة.
السرعة النسبية:
هي سرعة جسم متحرك بالنسبة لمراقب ساكن أو متحرك. إذا كان المراقب ساكناً، فإن السرعة النسبية تساوي السرعة الفعلية للجسم.
إذا تحرك المراقب في نفس اتجاه حركة الجسم، فإن السرعة النسبية تساوي الفرق بين السرعتين (السرعة الفعلية - سرعة المراقب).
إذا تحرك المراقب في عكس اتجاه حركة الجسم، فإن السرعة النسبية تساوي مجموع السرعتين.

قوانين نيوتن للحركة:
القانون الأول لنيوتن: يظل الجسم الساكن ساكناً، والجسم المتحرك في خط مستقيم بسرعة منتظمة متحركاً، ما لم تؤثر عليه قوة محصلة تغير من حالته.
يُعرف هذا القانون أيضاً بخاصية القصور الذاتي، وهي مقاومة الجسم لتغيير حالته الحركية.`,
    cleanedText: `الفصل الأول: الحركة في اتجاه واحد والسرعة
تعتبر الحركة هي تغير موضع الجسم بمرور الزمن بالنسبة لموضع جسم آخر ثابت.
السرعة هي المسافة المقطوعة خلال وحدة الزمن، أو المعدل الزمني للتغير في المسافة.
وحدة قياس السرعة في النظام الدولي هي المتر لكل ثانية (م/ث) أو الكيلومتر لكل ساعة (كم/س).
السرعة المنتظمة (الثابتة) هي السرعة التي يتحرك بها الجسم عندما يقطع مسافات متساوية في أزمنة متساوية.
أما السرعة غير المنتظمة فتحدث عندما يقطع الجسم مسافات متساوية في أزمنة غير متساوية، أو مسافات غير متساوية في أزمنة متساوية.

السرعة المتوسطة:
هي حاصل قسمة المسافة الكلية التي يقطعها الجسم المتحرك مقسومة على الزمن الكلي المستغرق لقطع هذه المسافة.
السرعة النسبية:
هي سرعة جسم متحرك بالنسبة لمراقب ساكن أو متحرك. إذا كان المراقب ساكناً، فإن السرعة النسبية تساوي السرعة الفعلية للجسم.
إذا تحرك المراقب في نفس اتجاه حركة الجسم، فإن السرعة النسبية تساوي الفرق بين السرعتين (السرعة الفعلية - سرعة المراقب).
إذا تحرك المراقب في عكس اتجاه حركة الجسم، فإن السرعة النسبية تساوي مجموع السرعتين.

قوانين نيوتن للحركة:
القانون الأول لنيوتن: يظل الجسم الساكن ساكناً، والجسم المتحرك في خط مستقيم بسرعة منتظمة متحركاً، ما لم تؤثر عليه قوة محصلة تغير من حالته.
يُعرف هذا القانون أيضاً بخاصية القصور الذاتي، وهي مقاومة الجسم لتغيير حالته الحركية.`,
    wordCount: 185,
    charCount: 1250,
    topics: ["السرعة المنتظمة", "السرعة النسبية", "قوانين نيوتن", "القصور الذاتي"],
    sections: [
      {
        id: "sec-1",
        title: "الدرس الأول: مفهوم الحركة والسرعة وأنواعها",
        content: `تعتبر الحركة هي تغير موضع الجسم بمرور الزمن بالنسبة لموضع جسم آخر ثابت. السرعة هي المسافة المقطوعة خلال وحدة الزمن. وحدة قياس السرعة هي متر/ثانية أو كيلومتر/ساعة.`,
        wordCount: 35,
      },
      {
        id: "sec-2",
        title: "الدرس الثاني: السرعة المتوسطة والسرعة النسبية",
        content: `السرعة المتوسطة هي حاصل قسمة المسافة الكلية على الزمن الكلي. السرعة النسبية بالنسبة لمراقب في نفس الاتجاه تساوي الفرق بين السرعتين، وفي عكس الاتجاه تساوي مجموع السرعتين.`,
        wordCount: 40,
      },
      {
        id: "sec-3",
        title: "الدرس الثالث: قانون نيوتن الأول والقصور الذاتي",
        content: `القانون الأول لنيوتن: يظل الجسم على حالته من سكون أو حركة منتظمة ما لم تؤثر عليه قوة محصلة خارجية. يسمى بخاصية القصور الذاتي.`,
        wordCount: 30,
      },
    ],
    uploadedBy: {
      id: "system",
      name: "QuizForge المنهج النموذجي",
      username: "curriculum_bot",
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "sample-cs-en",
    groupId: "global",
    title: "Chapter 1: Foundations of Computer Networks & HTTP Protocol",
    subject: "Computer Science",
    grade: "Undergraduate / High School",
    fileName: "sample_networking.txt",
    fileType: "manual",
    fileSize: 3800,
    rawText: `Chapter 1: Networking Fundamentals and Protocols
Computer networks enable interconnected devices to exchange data and share resources over transmission media.

The OSI Reference Model:
The Open Systems Interconnection model defines 7 distinct abstraction layers:
1. Physical Layer: Deals with transmission of raw bit streams over physical media like fiber or copper wire.
2. Data Link Layer: Manages node-to-node data transfer and frame synchronization (MAC addressing).
3. Network Layer: Responsible for packet routing and forwarding across logical networks (IP addressing).
4. Transport Layer: Delivers end-to-end communication services such as TCP (reliable, connection-oriented) and UDP (connectionless, low-latency).
5. Session Layer: Controls dialogues and connections between computers.
6. Presentation Layer: Formats, encrypts, and compresses data (e.g. TLS/SSL, ASCII).
7. Application Layer: Interacts directly with software applications (HTTP, DNS, SMTP, FTP).

HTTP vs HTTPS:
Hypertext Transfer Protocol (HTTP) transmits data in plain text, typically on port 80.
HTTPS (HTTP Secure) uses TLS encryption over port 443 to secure communication against eavesdropping and tampering.
HTTP Status Codes:
- 200 OK: Successful request.
- 301 Moved Permanently: Resource redirected.
- 400 Bad Request: Malformed request syntax.
- 404 Not Found: Server cannot find the requested resource.
- 500 Internal Server Error: Generic server-side failure.`,
    cleanedText: `Chapter 1: Networking Fundamentals and Protocols
Computer networks enable interconnected devices to exchange data and share resources over transmission media.

The OSI Reference Model:
The Open Systems Interconnection model defines 7 distinct abstraction layers:
1. Physical Layer: Deals with transmission of raw bit streams over physical media like fiber or copper wire.
2. Data Link Layer: Manages node-to-node data transfer and frame synchronization (MAC addressing).
3. Network Layer: Responsible for packet routing and forwarding across logical networks (IP addressing).
4. Transport Layer: Delivers end-to-end communication services such as TCP (reliable, connection-oriented) and UDP (connectionless, low-latency).
5. Session Layer: Controls dialogues and connections between computers.
6. Presentation Layer: Formats, encrypts, and compresses data (e.g. TLS/SSL, ASCII).
7. Application Layer: Interacts directly with software applications (HTTP, DNS, SMTP, FTP).

HTTP vs HTTPS:
Hypertext Transfer Protocol (HTTP) transmits data in plain text, typically on port 80.
HTTPS (HTTP Secure) uses TLS encryption over port 443 to secure communication against eavesdropping and tampering.
HTTP Status Codes:
- 200 OK: Successful request.
- 301 Moved Permanently: Resource redirected.
- 400 Bad Request: Malformed request syntax.
- 404 Not Found: Server cannot find the requested resource.
- 500 Internal Server Error: Generic server-side failure.`,
    wordCount: 190,
    charCount: 1400,
    topics: ["OSI Model", "Transport Layer", "TCP/UDP", "HTTP & Status Codes"],
    sections: [
      {
        id: "sec-1",
        title: "The OSI 7-Layer Reference Model",
        content: "The OSI model consists of 7 layers: Physical, Data Link, Network, Transport, Session, Presentation, Application.",
        wordCount: 20,
      },
      {
        id: "sec-2",
        title: "Transport Protocols and HTTP Status Codes",
        content: "TCP is connection-oriented; UDP is connectionless. HTTP uses port 80, HTTPS uses port 443. 200 is OK, 404 is Not Found, 500 is Internal Server Error.",
        wordCount: 30,
      },
    ],
    uploadedBy: {
      id: "system",
      name: "QuizForge English Curriculum",
      username: "curriculum_bot",
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

// ─── Materials CRUD ────────────────────────────────────────────────────────────

export async function getMaterials(groupId: string): Promise<CurriculumMaterial[]> {
  // Always read from file to avoid cross-worker / reload state desynchronization
  let allMaterials = await safeReadJson<CurriculumMaterial[]>(MATERIALS_FILE, []);

  // Only seed sample materials on first initialization if file does not exist on disk
  if (allMaterials.length === 0) {
    try {
      const stat = await fs.stat(MATERIALS_FILE).catch(() => null);
      if (!stat || stat.size === 0) {
        allMaterials = [...SAMPLE_MATERIALS];
        await safeWriteJson(MATERIALS_FILE, allMaterials);
      }
    } catch {}
  }

  const cleanGid = String(groupId || "").trim();

  // Combine stored materials with global sample materials in memory without mutating disk
  const combined = [...allMaterials];
  for (const sample of SAMPLE_MATERIALS) {
    if (!combined.some((m) => m.id === sample.id)) {
      combined.push(sample);
    }
  }

  // Include group-specific materials and global sample materials
  return combined.filter(
    (m) => String(m.groupId || "").trim() === cleanGid || m.groupId === "global"
  );
}

export async function getMaterialById(
  groupId: string,
  materialId: string
): Promise<CurriculumMaterial | null> {
  const materials = await getMaterials(groupId);
  return materials.find((m) => m.id === materialId) || null;
}

export async function saveMaterial(material: CurriculumMaterial): Promise<void> {
  const allMaterials = await safeReadJson<CurriculumMaterial[]>(MATERIALS_FILE, []);

  const existingIndex = allMaterials.findIndex((m) => m.id === material.id);
  if (existingIndex >= 0) {
    allMaterials[existingIndex] = material;
  } else {
    allMaterials.unshift(material);
  }

  await safeWriteJson(MATERIALS_FILE, allMaterials);
}

export async function deleteMaterial(groupId: string, materialId: string): Promise<boolean> {
  const allMaterials = await safeReadJson<CurriculumMaterial[]>(MATERIALS_FILE, []);
  const initialLength = allMaterials.length;
  const cleanGid = String(groupId || "").trim();

  // Disallow deleting global sample materials; only group-owned materials matching groupId can be deleted
  const filtered = allMaterials.filter(
    (m) => !(m.id === materialId && String(m.groupId || "").trim() === cleanGid && m.groupId !== "global")
  );

  if (filtered.length !== initialLength) {
    await safeWriteJson(MATERIALS_FILE, filtered);
    return true;
  }
  return false;
}

// ─── AI Generation Logs & Analytics ───────────────────────────────────────────

export async function recordGenerationLog(log: GenerationLog): Promise<void> {
  const logs = await safeReadJson<GenerationLog[]>(LOGS_FILE, []);

  logs.unshift(log);
  // Keep last 1,000 logs to maintain speed
  const trimmedLogs = logs.length > 1000 ? logs.slice(0, 1000) : logs;

  await safeWriteJson(LOGS_FILE, trimmedLogs);
}

export async function getAIAnalytics(groupId: string): Promise<AIAnalyticsSummary> {
  const allLogs = await safeReadJson<GenerationLog[]>(LOGS_FILE, []);
  const cleanGid = String(groupId || "").trim();
  const groupLogs = allLogs.filter((l) => String(l.groupId || "").trim() === cleanGid);

  const totalGenerations = groupLogs.length;
  const totalQuestions = groupLogs.reduce((acc, l) => acc + (l.questionCount || 0), 0);
  const totalTokens = groupLogs.reduce((acc, l) => acc + (l.estimatedTokens || 0), 0);

  // Group by user
  const userMap = new Map<
    string,
    {
      userId: string;
      userName: string;
      userUsername?: string;
      userPhoto?: string;
      generationsCount: number;
      questionsCount: number;
      lastActive: string;
    }
  >();

  // Materials breakdown
  const materialsMap = new Map<
    string,
    { materialTitle: string; generationsCount: number; questionsCount: number }
  >();

  // Difficulty breakdown
  const difficultyBreakdown = { EASY: 0, MEDIUM: 0, HARD: 0 };

  for (const log of groupLogs) {
    // User stats
    const existingUser = userMap.get(log.userId) || {
      userId: log.userId,
      userName: log.userName || "مستخدم غير معروف",
      userUsername: log.userUsername,
      userPhoto: log.userPhoto,
      generationsCount: 0,
      questionsCount: 0,
      lastActive: log.timestamp,
    };
    existingUser.generationsCount += 1;
    existingUser.questionsCount += log.questionCount;
    if (new Date(log.timestamp) > new Date(existingUser.lastActive)) {
      existingUser.lastActive = log.timestamp;
    }
    userMap.set(log.userId, existingUser);

    // Material stats
    const title = log.materialTitle || "نص مخصص مباشر";
    const existingMat = materialsMap.get(title) || {
      materialTitle: title,
      generationsCount: 0,
      questionsCount: 0,
    };
    existingMat.generationsCount += 1;
    existingMat.questionsCount += log.questionCount;
    materialsMap.set(title, existingMat);

    // Difficulty
    if (Array.isArray(log.questionsSummary)) {
      for (const q of log.questionsSummary) {
        const d = (q.difficulty || "MEDIUM").toUpperCase();
        if (d === "EASY") difficultyBreakdown.EASY += 1;
        else if (d === "HARD") difficultyBreakdown.HARD += 1;
        else difficultyBreakdown.MEDIUM += 1;
      }
    }
  }

  const userLeaderboard = Array.from(userMap.values()).sort(
    (a, b) => b.questionsCount - a.questionsCount
  );

  const materialsUsage = Array.from(materialsMap.values()).sort(
    (a, b) => b.questionsCount - a.questionsCount
  );

  return {
    totalGenerations,
    totalQuestions,
    totalTokens,
    activeUsersCount: userMap.size,
    studentParticipants: 0,
    averageScore: 0,
    passRate: 0,
    broadcastedQuizzesCount: 0,
    examsCreatedCount: 0,
    userLeaderboard,
    materialsUsage,
    difficultyBreakdown,
    recentLogs: groupLogs.slice(0, 50),
  };
}

// ─── AI Group Settings ─────────────────────────────────────────────────────────

const GLOBAL_SETTINGS_KEY = "__global__";

export async function getGroupAISettings(groupId: string): Promise<AISettings> {
  const cleanGid = String(groupId || "").trim();
  const allSettings = await safeReadJson<Record<string, AISettings>>(SETTINGS_FILE, {});
  const existing = allSettings[cleanGid];

  // Global key fallback: check __global__, then any group with a saved key, then process.env
  let globalFallbackKey = allSettings[GLOBAL_SETTINGS_KEY]?.geminiApiKey || "";
  if (!globalFallbackKey) {
    for (const val of Object.values(allSettings)) {
      if (val && val.geminiApiKey && typeof val.geminiApiKey === "string" && val.geminiApiKey.trim()) {
        globalFallbackKey = val.geminiApiKey.trim();
        break;
      }
    }
  }
  if (!globalFallbackKey) {
    globalFallbackKey = process.env.GEMINI_API_KEY?.trim() || "";
  }

  if (existing) {
    return {
      ...existing,
      // If group has key, prioritize it; otherwise fallback to global / env
      geminiApiKey: existing.geminiApiKey || globalFallbackKey,
    };
  }

  const defaultSettings: AISettings = {
    groupId: cleanGid,
    geminiApiKey: globalFallbackKey,
    defaultModel: "gemini-3.8-flash",
    defaultDifficulty: "mixed",
    defaultCount: 5,
    strictGrounding: true,
    systemInstruction: "",
    updatedAt: new Date().toISOString(),
  };

  return defaultSettings;
}

/**
 * Validate candidate API keys before persisting to storage.
 * Protection rules:
 * - Must be at least 20 characters long
 * - Must not contain masking bullets ("••••")
 * - Must not contain ellipsis abbreviation ("..." or "…")
 * - Must not contain asterisks ("***")
 */
export function isValidApiKeyCandidate(key?: string | null): boolean {
  if (!key) return false;
  const trimmed = String(key).trim();
  if (trimmed.length < 20) return false;
  if (trimmed.includes("••••") || trimmed.includes("•")) return false;
  if (trimmed.includes("...") || trimmed.includes("…")) return false;
  if (trimmed.includes("***") || trimmed.includes("*")) return false;
  if (trimmed === "undefined" || trimmed === "null") return false;
  return true;
}

export async function updateGroupAISettings(
  groupId: string,
  partial: Partial<AISettings>
): Promise<AISettings> {
  const cleanGid = String(groupId || "").trim();
  const allSettings = await safeReadJson<Record<string, AISettings>>(SETTINGS_FILE, {});
  const current = await getGroupAISettings(cleanGid);

  // CRITICAL RULE: Never overwrite an existing saved key if partial.geminiApiKey is invalid, empty, or masked!
  let resolvedKey = current.geminiApiKey || "";
  if (partial.geminiApiKey !== undefined) {
    const candidate = String(partial.geminiApiKey).trim();
    if (isValidApiKeyCandidate(candidate)) {
      resolvedKey = candidate;
    }
  }

  const updated: AISettings = {
    ...current,
    ...partial,
    groupId: cleanGid,
    geminiApiKey: resolvedKey,
    updatedAt: new Date().toISOString(),
  };

  allSettings[cleanGid] = updated;

  // If a valid key exists, also update the global fallback so other groups automatically inherit it
  if (resolvedKey) {
    allSettings[GLOBAL_SETTINGS_KEY] = {
      ...(allSettings[GLOBAL_SETTINGS_KEY] || updated),
      groupId: GLOBAL_SETTINGS_KEY,
      geminiApiKey: resolvedKey,
      updatedAt: new Date().toISOString(),
    };
  }

  await safeWriteJson(SETTINGS_FILE, allSettings);

  return updated;
}
