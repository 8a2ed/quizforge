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

// In-memory cache with atomic file sync
let materialsCache: CurriculumMaterial[] | null = null;
let logsCache: GenerationLog[] | null = null;
let settingsCache: Record<string, AISettings> | null = null;

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch {}
}

async function safeReadJson<T>(filePath: string, fallback: T): Promise<T> {
  await ensureDataDir();
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data) as T;
  } catch {
    return fallback;
  }
}

async function safeWriteJson<T>(filePath: string, data: T): Promise<void> {
  await ensureDataDir();
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  try {
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf-8");
    await fs.rename(tempPath, filePath);
  } catch {
    // Windows file locking fallback
    try {
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
      await fs.unlink(tempPath).catch(() => {});
    } catch (writeErr) {
      console.error("[safeWriteJson error]", writeErr);
    }
  }
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
  if (!materialsCache) {
    materialsCache = await safeReadJson<CurriculumMaterial[]>(MATERIALS_FILE, []);
  }

  // Ensure sample materials are populated and up to date
  let needsSync = false;
  for (const sample of SAMPLE_MATERIALS) {
    const idx = materialsCache.findIndex((m) => m.id === sample.id);
    if (idx === -1) {
      materialsCache.push(sample);
      needsSync = true;
    } else if (materialsCache[idx].cleanedText.includes("...")) {
      materialsCache[idx] = sample;
      needsSync = true;
    }
  }

  if (needsSync) {
    await safeWriteJson(MATERIALS_FILE, materialsCache);
  }

  // Include group-specific materials and global sample materials
  return materialsCache.filter(
    (m) => m.groupId === groupId || m.groupId === "global"
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
  if (!materialsCache) {
    materialsCache = await safeReadJson<CurriculumMaterial[]>(MATERIALS_FILE, []);
  }

  const existingIndex = materialsCache.findIndex((m) => m.id === material.id);
  if (existingIndex >= 0) {
    materialsCache[existingIndex] = material;
  } else {
    materialsCache.unshift(material);
  }

  await safeWriteJson(MATERIALS_FILE, materialsCache);
}

export async function deleteMaterial(groupId: string, materialId: string): Promise<boolean> {
  if (!materialsCache) {
    materialsCache = await safeReadJson<CurriculumMaterial[]>(MATERIALS_FILE, []);
  }

  const initialLength = materialsCache.length;
  // Disallow deleting global sample materials; only group-owned materials can be deleted
  materialsCache = materialsCache.filter(
    (m) => !(m.id === materialId && m.groupId === groupId)
  );

  if (materialsCache.length !== initialLength) {
    await safeWriteJson(MATERIALS_FILE, materialsCache);
    return true;
  }
  return false;
}

// ─── AI Generation Logs & Analytics ───────────────────────────────────────────

export async function recordGenerationLog(log: GenerationLog): Promise<void> {
  if (!logsCache) {
    logsCache = await safeReadJson<GenerationLog[]>(LOGS_FILE, []);
  }

  logsCache.unshift(log);
  // Keep last 1,000 logs to maintain speed
  if (logsCache.length > 1000) {
    logsCache = logsCache.slice(0, 1000);
  }

  await safeWriteJson(LOGS_FILE, logsCache);
}

export async function getAIAnalytics(groupId: string): Promise<AIAnalyticsSummary> {
  if (!logsCache) {
    logsCache = await safeReadJson<GenerationLog[]>(LOGS_FILE, []);
  }

  const groupLogs = logsCache.filter((l) => l.groupId === groupId);

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

export async function getGroupAISettings(groupId: string): Promise<AISettings> {
  if (!settingsCache) {
    settingsCache = await safeReadJson<Record<string, AISettings>>(SETTINGS_FILE, {});
  }

  const existing = settingsCache[groupId];
  if (existing) {
    return {
      ...existing,
      // If no group key set, reflect if env key is available (masked)
      geminiApiKey: existing.geminiApiKey || process.env.GEMINI_API_KEY || "",
    };
  }

  const defaultSettings: AISettings = {
    groupId,
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    defaultModel: "gemini-3.8-flash",
    defaultDifficulty: "mixed",
    defaultCount: 5,
    strictGrounding: true,
    systemInstruction: "",
    updatedAt: new Date().toISOString(),
  };

  return defaultSettings;
}

export async function updateGroupAISettings(
  groupId: string,
  partial: Partial<AISettings>
): Promise<AISettings> {
  if (!settingsCache) {
    settingsCache = await safeReadJson<Record<string, AISettings>>(SETTINGS_FILE, {});
  }

  const current = await getGroupAISettings(groupId);
  const updated: AISettings = {
    ...current,
    ...partial,
    groupId,
    updatedAt: new Date().toISOString(),
  };

  settingsCache[groupId] = updated;
  await safeWriteJson(SETTINGS_FILE, settingsCache);

  return updated;
}
