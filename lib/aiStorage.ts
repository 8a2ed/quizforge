import fs from "fs/promises";
import path from "path";
import { ValidatedQuestion } from "./questionValidator";
import { cleanText, splitIntoSections } from "./textCleaner";

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
  questionsSummary?: Array<{
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

const IS_SERVERLESS = Boolean(
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.NETLIFY
);

const DATA_DIR = IS_SERVERLESS
  ? path.join("/tmp", "ai_curriculum")
  : path.join(process.cwd(), "data", "ai_curriculum");

const STATIC_SEED_DIR = path.join(process.cwd(), "data", "ai_curriculum");
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
        if (IS_SERVERLESS) {
          try {
            const seedPath = path.join(STATIC_SEED_DIR, path.basename(filePath));
            const seedData = await fs.readFile(seedPath, "utf-8");
            if (seedData && seedData.trim()) {
              const parsed = JSON.parse(seedData) as T;
              try {
                await fs.writeFile(filePath, seedData, "utf-8");
              } catch {}
              return parsed;
            }
          } catch {}
        }
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

// ─── Materials CRUD (PostgreSQL + Serverless File Fallback) ───────────────────

let dbTablesInitialized = false;
let dbInitAttempted = false;

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim());
}

async function ensureAiDatabaseTables(prismaClient: any): Promise<boolean> {
  if (dbTablesInitialized) return true;
  if (!isDatabaseConfigured()) return false;
  if (dbInitAttempted) return false;
  try {
    await prismaClient.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ai_curriculum_materials (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        title TEXT NOT NULL,
        subject TEXT,
        grade TEXT,
        file_name TEXT,
        file_type TEXT,
        file_size INT,
        raw_text TEXT,
        cleaned_text TEXT,
        word_count INT,
        char_count INT,
        topics JSONB,
        sections JSONB,
        uploaded_by JSONB,
        ocr_used BOOLEAN DEFAULT false,
        digital_fallback BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await prismaClient.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_ai_curriculum_materials_group ON ai_curriculum_materials(group_id)
    `);

    // Settings table for multi-instance & telegram webhook synchronization
    await prismaClient.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ai_curriculum_settings (
        group_id TEXT PRIMARY KEY,
        gemini_api_key TEXT,
        default_model TEXT,
        default_difficulty TEXT,
        default_count INT,
        strict_grounding BOOLEAN DEFAULT true,
        system_instruction TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Generation logs table for persistent analytics across dashboard and telegram
    await prismaClient.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ai_generation_logs (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        user_name TEXT NOT NULL,
        user_username TEXT,
        user_photo TEXT,
        material_id TEXT,
        material_title TEXT NOT NULL,
        question_count INT DEFAULT 0,
        model_used TEXT NOT NULL,
        estimated_tokens INT DEFAULT 0,
        difficulty TEXT NOT NULL,
        timestamp TIMESTAMPTZ DEFAULT NOW(),
        success BOOLEAN DEFAULT true,
        questions_summary JSONB
      )
    `);
    await prismaClient.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_ai_generation_logs_group ON ai_generation_logs(group_id)
    `);

    dbTablesInitialized = true;
    return true;
  } catch (err) {
    dbInitAttempted = true;
    console.warn("[aiStorage] Failed to ensure DB table:", err);
    return false;
  }
}

function parseJsonField<T>(val: any, fallback: T): T {
  if (val === null || val === undefined) return fallback;
  if (typeof val === "object") return val as T;
  if (typeof val === "string") {
    try {
      return JSON.parse(val) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function mapDbRowToMaterial(r: any): CurriculumMaterial {
  return {
    id: r.id,
    groupId: r.group_id,
    title: r.title,
    subject: r.subject || "عام",
    grade: r.grade || "",
    fileName: r.file_name || "",
    fileType: r.file_type || "manual",
    fileSize: Number(r.file_size) || 0,
    rawText: r.raw_text || "",
    cleanedText: r.cleaned_text || "",
    wordCount: Number(r.word_count) || 0,
    charCount: Number(r.char_count) || 0,
    topics: parseJsonField<string[]>(r.topics, []),
    sections: parseJsonField<any[]>(r.sections, []),
    uploadedBy: parseJsonField<any>(r.uploaded_by, { id: "system", name: "المعلم" }),
    ocrUsed: Boolean(r.ocr_used),
    digitalFallback: Boolean(r.digital_fallback),
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
  };
}

export async function getMaterials(groupId: string): Promise<CurriculumMaterial[]> {
  const cleanGid = String(groupId || "").trim();

  // 1. Try reading from PostgreSQL database first (shared across all Vercel instances & bot webhooks)
  if (isDatabaseConfigured()) {
    try {
      const { prisma } = await import("./db");
      const ready = await ensureAiDatabaseTables(prisma);
      if (ready) {
        const rows = await prisma.$queryRawUnsafe<any[]>(
          `SELECT * FROM ai_curriculum_materials WHERE group_id = $1 ORDER BY created_at DESC`,
          cleanGid
        );
        if (Array.isArray(rows) && rows.length > 0) {
          return rows.map(mapDbRowToMaterial);
        }
      }
    } catch (dbErr) {
      console.warn("[aiStorage] DB query error (falling back to disk):", dbErr);
    }
  }

  // 2. Fallback to local files
  let allMaterials = await safeReadJson<CurriculumMaterial[]>(MATERIALS_FILE, []);
  const customGroupMaterials = allMaterials.filter(
    (m) => String(m.groupId || "").trim() === cleanGid && m.groupId !== "global"
  );
  if (customGroupMaterials.length > 0) {
    return customGroupMaterials;
  }

  // 3. Fallback to sample materials only if zero custom materials exist
  return allMaterials.filter((m) => m.groupId === "global");
}

export async function getAllCurriculumMaterials(groupId?: string): Promise<CurriculumMaterial[]> {
  const cleanGid = String(groupId || "").trim();

  // 1. Try reading from PostgreSQL database first
  if (isDatabaseConfigured()) {
    try {
      const { prisma } = await import("./db");
      const ready = await ensureAiDatabaseTables(prisma);
      if (ready) {
        if (cleanGid) {
          const rows = await prisma.$queryRawUnsafe<any[]>(
            `SELECT * FROM ai_curriculum_materials WHERE group_id = $1 ORDER BY created_at DESC`,
            cleanGid
          );
          if (Array.isArray(rows) && rows.length > 0) {
            return rows.map(mapDbRowToMaterial);
          }
        }

        // If no group specified or group had no custom materials, check all custom materials in DB
        const allRows = await prisma.$queryRawUnsafe<any[]>(
          `SELECT * FROM ai_curriculum_materials ORDER BY created_at DESC LIMIT 30`
        );
        if (Array.isArray(allRows) && allRows.length > 0) {
          return allRows.map(mapDbRowToMaterial);
        }
      }
    } catch (dbErr) {
      console.warn("[aiStorage] DB query error (falling back to disk):", dbErr);
    }
  }

  // 2. Fallback to local files
  const allMaterials = await safeReadJson<CurriculumMaterial[]>(MATERIALS_FILE, []);
  if (cleanGid) {
    const groupMaterials = allMaterials.filter(
      (m) => String(m.groupId || "").trim() === cleanGid && m.groupId !== "global"
    );
    if (groupMaterials.length > 0) return groupMaterials;
  }

  const anyCustom = allMaterials.filter((m) => m.groupId !== "global");
  if (anyCustom.length > 0) return anyCustom;

  // 3. Last-resort fallback to sample materials
  return SAMPLE_MATERIALS;
}

export async function getAnyMaterialById(materialId: string): Promise<CurriculumMaterial | null> {
  const sample = SAMPLE_MATERIALS.find((m) => m.id === materialId);
  if (sample) return sample;
  const all = await getAllCurriculumMaterials();
  const found = all.find((m) => m.id === materialId);
  if (found) return found;
  return null;
}

export async function getMaterialById(
  groupId: string,
  materialId: string
): Promise<CurriculumMaterial | null> {
  const materials = await getMaterials(groupId);
  const found = materials.find((m) => m.id === materialId);
  if (found) return found;
  const sample = SAMPLE_MATERIALS.find((m) => m.id === materialId);
  if (sample) return sample;
  return getAnyMaterialById(materialId);
}

export async function saveMaterial(material: CurriculumMaterial): Promise<void> {
  // 1. Persist to PostgreSQL database (ensures Vercel serverless persistence across all instances & bot webhooks)
  if (isDatabaseConfigured()) {
    try {
      const { prisma } = await import("./db");
      const ready = await ensureAiDatabaseTables(prisma);
      if (ready) {
        try {
          await prisma.$executeRawUnsafe(
            `INSERT INTO ai_curriculum_materials (
              id, group_id, title, subject, grade, file_name, file_type, file_size,
              raw_text, cleaned_text, word_count, char_count, topics, sections,
              uploaded_by, ocr_used, digital_fallback, created_at, updated_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8,
              $9, $10, $11, $12, CAST($13 AS jsonb), CAST($14 AS jsonb),
              CAST($15 AS jsonb), $16, $17, $18, $19
            )
            ON CONFLICT (id) DO UPDATE SET
              title = EXCLUDED.title,
              subject = EXCLUDED.subject,
              grade = EXCLUDED.grade,
              raw_text = EXCLUDED.raw_text,
              cleaned_text = EXCLUDED.cleaned_text,
              word_count = EXCLUDED.word_count,
              char_count = EXCLUDED.char_count,
              topics = EXCLUDED.topics,
              sections = EXCLUDED.sections,
              ocr_used = EXCLUDED.ocr_used,
              digital_fallback = EXCLUDED.digital_fallback,
              updated_at = NOW()`,
            material.id,
            material.groupId,
            material.title,
            material.subject || "عام",
            material.grade || "",
            material.fileName || "",
            material.fileType || "manual",
            material.fileSize || 0,
            material.rawText || "",
            material.cleanedText || "",
            material.wordCount || 0,
            material.charCount || 0,
            JSON.stringify(material.topics || []),
            JSON.stringify(material.sections || []),
            JSON.stringify(material.uploadedBy || {}),
            Boolean(material.ocrUsed),
            Boolean(material.digitalFallback),
            new Date(material.createdAt || Date.now()),
            new Date(material.updatedAt || Date.now())
          );
        } catch {
          // Fallback query without jsonb cast if column type differs
          await prisma.$executeRawUnsafe(
            `INSERT INTO ai_curriculum_materials (
              id, group_id, title, subject, grade, file_name, file_type, file_size,
              raw_text, cleaned_text, word_count, char_count, topics, sections,
              uploaded_by, ocr_used, digital_fallback, created_at, updated_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8,
              $9, $10, $11, $12, $13, $14,
              $15, $16, $17, $18, $19
            )
            ON CONFLICT (id) DO UPDATE SET
              title = EXCLUDED.title,
              subject = EXCLUDED.subject,
              grade = EXCLUDED.grade,
              raw_text = EXCLUDED.raw_text,
              cleaned_text = EXCLUDED.cleaned_text,
              word_count = EXCLUDED.word_count,
              char_count = EXCLUDED.char_count,
              topics = EXCLUDED.topics,
              sections = EXCLUDED.sections,
              ocr_used = EXCLUDED.ocr_used,
              digital_fallback = EXCLUDED.digital_fallback,
              updated_at = NOW()`,
            material.id,
            material.groupId,
            material.title,
            material.subject || "عام",
            material.grade || "",
            material.fileName || "",
            material.fileType || "manual",
            material.fileSize || 0,
            material.rawText || "",
            material.cleanedText || "",
            material.wordCount || 0,
            material.charCount || 0,
            JSON.stringify(material.topics || []),
            JSON.stringify(material.sections || []),
            JSON.stringify(material.uploadedBy || {}),
            Boolean(material.ocrUsed),
            Boolean(material.digitalFallback),
            new Date(material.createdAt || Date.now()),
            new Date(material.updatedAt || Date.now())
          );
        }
      }
    } catch (dbErr) {
      console.warn("[aiStorage] DB save error (falling back to disk):", dbErr);
    }
  }

  // 2. Also write to local file storage
  const allMaterials = await safeReadJson<CurriculumMaterial[]>(MATERIALS_FILE, []);
  const existingIndex = allMaterials.findIndex((m) => m.id === material.id);
  if (existingIndex >= 0) {
    allMaterials[existingIndex] = material;
  } else {
    allMaterials.unshift(material);
  }
  await safeWriteJson(MATERIALS_FILE, allMaterials);
}

export async function updateMaterial(
  groupId: string,
  materialId: string,
  updates: Partial<CurriculumMaterial>
): Promise<CurriculumMaterial | null> {
  const cleanGid = String(groupId || "").trim();
  const existing = await getMaterialById(cleanGid, materialId);
  if (!existing) return null;

  const isGlobal = existing.groupId === "global" || SAMPLE_MATERIALS.some((s) => s.id === existing.id);

  // Cross-group authorization check: if not global and belongs to another group, reject
  if (!isGlobal && existing.groupId && existing.groupId !== cleanGid) {
    return null;
  }

  // If editing a global sample material, create a group-specific copy so global remains pristine
  const targetId = isGlobal ? `mat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}` : existing.id;
  const targetGroupId = isGlobal ? cleanGid : existing.groupId;

  // Validate title if provided
  let newTitle = existing.title;
  if (updates.title !== undefined) {
    const trimmedTitle = String(updates.title).trim();
    if (trimmedTitle) {
      newTitle = trimmedTitle;
    }
  }

  // Compute text updates
  let newCleanedText = existing.cleanedText;
  let newRawText = existing.rawText;

  if (updates.cleanedText !== undefined || updates.rawText !== undefined) {
    const rawInput = updates.rawText !== undefined ? String(updates.rawText) : String(updates.cleanedText || "");
    const cleanedInput = cleanText(updates.cleanedText !== undefined ? String(updates.cleanedText) : rawInput);
    if (cleanedInput) {
      newCleanedText = cleanedInput;
      newRawText = rawInput || cleanedInput;
    }
  }

  // Recalculate wordCount & charCount
  const wordCount = newCleanedText
    ? newCleanedText.split(/\s+/).filter(Boolean).length
    : existing.wordCount;
  const charCount = newCleanedText ? newCleanedText.length : existing.charCount;

  // Process sections
  let newSections = updates.sections !== undefined ? updates.sections : existing.sections;
  if (Array.isArray(newSections) && newSections.length > 0) {
    newSections = newSections
      .map((s: any, idx: number) => {
        const c = cleanText(String(s.content || ""));
        return {
          id: String(s.id || `sec-${idx + 1}`),
          title: String(s.title || `القسم ${idx + 1}`).trim() || `القسم ${idx + 1}`,
          content: c,
          wordCount:
            typeof s.wordCount === "number" && s.wordCount > 0
              ? s.wordCount
              : c
              ? c.split(/\s+/).filter(Boolean).length
              : 0,
        };
      })
      .filter((s) => s.content.length > 0 || (s.title && s.title.trim().length > 0));
  }

  if (!Array.isArray(newSections) || newSections.length === 0) {
    newSections = splitIntoSections(newCleanedText);
  }

  // Process topics
  let newTopics = existing.topics;
  if (updates.topics !== undefined) {
    newTopics = Array.isArray(updates.topics)
      ? updates.topics.map((t: any) => String(t).trim()).filter(Boolean)
      : typeof updates.topics === "string"
      ? (updates.topics as string).split(",").map((t: string) => t.trim()).filter(Boolean)
      : existing.topics;
  }

  const updated: CurriculumMaterial = {
    ...existing,
    id: targetId,
    groupId: targetGroupId,
    title: newTitle,
    subject: updates.subject !== undefined && String(updates.subject).trim() ? String(updates.subject).trim() : existing.subject,
    grade: updates.grade !== undefined ? String(updates.grade).trim() : existing.grade,
    fileName: updates.fileName !== undefined && String(updates.fileName).trim() ? String(updates.fileName).trim() : existing.fileName,
    rawText: newRawText,
    cleanedText: newCleanedText,
    wordCount,
    charCount,
    topics: newTopics,
    sections: newSections,
    updatedAt: new Date().toISOString(),
  };

  await saveMaterial(updated);
  return updated;
}

export async function deleteMaterial(groupId: string, materialId: string): Promise<boolean> {
  const cleanGid = String(groupId || "").trim();
  let dbDeleted = false;

  // 1. Delete from PostgreSQL database
  if (isDatabaseConfigured()) {
    try {
      const { prisma } = await import("./db");
      const ready = await ensureAiDatabaseTables(prisma);
      if (ready) {
        const count = await prisma.$executeRawUnsafe(
          `DELETE FROM ai_curriculum_materials WHERE id = $1 AND group_id = $2`,
          materialId,
          cleanGid
        );
        if (typeof count === "number" && count > 0) {
          dbDeleted = true;
        }
      }
    } catch (dbErr) {
      console.warn("[aiStorage] DB delete error:", dbErr);
    }
  }

  // 2. Delete from local cache
  const allMaterials = await safeReadJson<CurriculumMaterial[]>(MATERIALS_FILE, []);
  const initialLength = allMaterials.length;

  // Disallow deleting global sample materials; only group-owned materials matching groupId can be deleted
  const filtered = allMaterials.filter(
    (m) => !(m.id === materialId && String(m.groupId || "").trim() === cleanGid && m.groupId !== "global")
  );

  let fileDeleted = false;
  if (filtered.length !== initialLength) {
    await safeWriteJson(MATERIALS_FILE, filtered);
    fileDeleted = true;
  }
  return dbDeleted || fileDeleted;
}

// ─── AI Generation Logs & Analytics ───────────────────────────────────────────

function mapDbRowToLog(r: any): GenerationLog {
  return {
    id: r.id,
    groupId: r.group_id,
    userId: r.user_id,
    userName: r.user_name || "المعلم",
    userUsername: r.user_username || undefined,
    userPhoto: r.user_photo || undefined,
    materialId: r.material_id || undefined,
    materialTitle: r.material_title || "نص مخصص",
    questionCount: Number(r.question_count) || 0,
    modelUsed: r.model_used || "gemini-3.8-flash",
    estimatedTokens: Number(r.estimated_tokens) || 0,
    difficulty: r.difficulty || "mixed",
    timestamp: r.timestamp ? new Date(r.timestamp).toISOString() : new Date().toISOString(),
    success: Boolean(r.success),
    questionsSummary: parseJsonField<any[]>(r.questions_summary, []),
  };
}

export async function recordGenerationLog(log: GenerationLog): Promise<void> {
  // 1. Persist to PostgreSQL database (ensures shared analytics across all lambdas & Telegram webhooks)
  if (isDatabaseConfigured()) {
    try {
      const { prisma } = await import("./db");
      const ready = await ensureAiDatabaseTables(prisma);
      if (ready) {
        try {
          await prisma.$executeRawUnsafe(
            `INSERT INTO ai_generation_logs (
              id, group_id, user_id, user_name, user_username, user_photo,
              material_id, material_title, question_count, model_used,
              estimated_tokens, difficulty, timestamp, success, questions_summary
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CAST($15 AS jsonb)
            )
            ON CONFLICT (id) DO NOTHING`,
            log.id,
            log.groupId,
            log.userId,
            log.userName,
            log.userUsername || null,
            log.userPhoto || null,
            log.materialId || null,
            log.materialTitle,
            log.questionCount || 0,
            log.modelUsed,
            log.estimatedTokens || 0,
            log.difficulty,
            new Date(log.timestamp || Date.now()),
            Boolean(log.success),
            JSON.stringify(log.questionsSummary || [])
          );
        } catch {
          await prisma.$executeRawUnsafe(
            `INSERT INTO ai_generation_logs (
              id, group_id, user_id, user_name, user_username, user_photo,
              material_id, material_title, question_count, model_used,
              estimated_tokens, difficulty, timestamp, success, questions_summary
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
            )
            ON CONFLICT (id) DO NOTHING`,
            log.id,
            log.groupId,
            log.userId,
            log.userName,
            log.userUsername || null,
            log.userPhoto || null,
            log.materialId || null,
            log.materialTitle,
            log.questionCount || 0,
            log.modelUsed,
            log.estimatedTokens || 0,
            log.difficulty,
            new Date(log.timestamp || Date.now()),
            Boolean(log.success),
            JSON.stringify(log.questionsSummary || [])
          );
        }
      }
    } catch (dbErr) {
      console.warn("[aiStorage] DB insert log notice (falling back to disk):", dbErr);
    }
  }

  // 2. Also write to local file storage
  const logs = await safeReadJson<GenerationLog[]>(LOGS_FILE, []);
  logs.unshift(log);
  // Keep last 1,000 logs to maintain speed
  const trimmedLogs = logs.length > 1000 ? logs.slice(0, 1000) : logs;
  await safeWriteJson(LOGS_FILE, trimmedLogs);
}

export async function getAIAnalytics(groupId: string): Promise<AIAnalyticsSummary> {
  const cleanGid = String(groupId || "").trim();
  let groupLogs: GenerationLog[] = [];

  // 1. Try reading from PostgreSQL database first
  if (isDatabaseConfigured()) {
    try {
      const { prisma } = await import("./db");
      const ready = await ensureAiDatabaseTables(prisma);
      if (ready) {
        const rows = await prisma.$queryRawUnsafe<any[]>(
          `SELECT * FROM ai_generation_logs WHERE group_id = $1 ORDER BY timestamp DESC LIMIT 1000`,
          cleanGid
        );
        if (Array.isArray(rows) && rows.length > 0) {
          groupLogs = rows.map(mapDbRowToLog);
        }
      }
    } catch (dbErr) {
      console.warn("[aiStorage] DB query logs notice (falling back to disk):", dbErr);
    }
  }

  // 2. Fallback to local files if no DB logs found
  if (groupLogs.length === 0) {
    const allLogs = await safeReadJson<GenerationLog[]>(LOGS_FILE, []);
    groupLogs = allLogs.filter((l) => String(l.groupId || "").trim() === cleanGid);
  }

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
    if (log.userUsername && !existingUser.userUsername) {
      existingUser.userUsername = log.userUsername;
    }
    if (log.userPhoto && !existingUser.userPhoto) {
      existingUser.userPhoto = log.userPhoto;
    }
    if (log.userName && log.userName !== "مستخدم غير معروف") {
      existingUser.userName = log.userName;
    }
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

    // Difficulty breakdown (from question summary or fallback to log difficulty)
    if (Array.isArray(log.questionsSummary) && log.questionsSummary.length > 0) {
      for (const q of log.questionsSummary) {
        const d = (q.difficulty || "MEDIUM").toUpperCase();
        if (d === "EASY") difficultyBreakdown.EASY += 1;
        else if (d === "HARD") difficultyBreakdown.HARD += 1;
        else difficultyBreakdown.MEDIUM += 1;
      }
    } else if (log.questionCount > 0) {
      const d = (log.difficulty || "MEDIUM").toUpperCase();
      if (d === "EASY") difficultyBreakdown.EASY += log.questionCount;
      else if (d === "HARD") difficultyBreakdown.HARD += log.questionCount;
      else difficultyBreakdown.MEDIUM += log.questionCount;
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

function mapDbRowToSettings(r: any): AISettings {
  return {
    groupId: r.group_id,
    geminiApiKey: r.gemini_api_key || undefined,
    defaultModel: r.default_model || "gemini-3.8-flash",
    defaultDifficulty: (r.default_difficulty as any) || "mixed",
    defaultCount: Number(r.default_count) || 5,
    strictGrounding: r.strict_grounding !== false,
    systemInstruction: r.system_instruction || "",
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
  };
}

export async function getGroupAISettings(groupId: string): Promise<AISettings> {
  const cleanGid = String(groupId || "").trim();

  // Global key fallback from process.env
  let globalEnvKey = process.env.GEMINI_API_KEY?.trim() || "";

  // 1. Try reading from PostgreSQL database first
  if (isDatabaseConfigured()) {
    try {
      const { prisma } = await import("./db");
      const ready = await ensureAiDatabaseTables(prisma);
      if (ready) {
        const rows = await prisma.$queryRawUnsafe<any[]>(
          `SELECT * FROM ai_curriculum_settings WHERE group_id = $1 OR group_id = $2`,
          cleanGid,
          GLOBAL_SETTINGS_KEY
        );
        if (Array.isArray(rows) && rows.length > 0) {
          const groupRow = rows.find((r) => r.group_id === cleanGid);
          const globalRow = rows.find((r) => r.group_id === GLOBAL_SETTINGS_KEY);
          const globalKey = globalRow?.gemini_api_key || globalEnvKey;

          if (groupRow) {
            return {
              ...mapDbRowToSettings(groupRow),
              geminiApiKey: groupRow.gemini_api_key || globalKey,
            };
          }
        }
      }
    } catch (dbErr) {
      console.warn("[aiStorage] DB query settings notice (falling back to disk):", dbErr);
    }
  }

  // 2. Fallback to local file storage
  const allSettings = await safeReadJson<Record<string, AISettings>>(SETTINGS_FILE, {});
  const existing = allSettings[cleanGid];

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
    globalFallbackKey = globalEnvKey;
  }

  if (existing) {
    return {
      ...existing,
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

  // 1. Persist to PostgreSQL database (ensures multi-instance & telegram webhook synchronization)
  if (isDatabaseConfigured()) {
    try {
      const { prisma } = await import("./db");
      const ready = await ensureAiDatabaseTables(prisma);
      if (ready) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO ai_curriculum_settings (
            group_id, gemini_api_key, default_model, default_difficulty, default_count,
            strict_grounding, system_instruction, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
          ON CONFLICT (group_id) DO UPDATE SET
            gemini_api_key = EXCLUDED.gemini_api_key,
            default_model = EXCLUDED.default_model,
            default_difficulty = EXCLUDED.default_difficulty,
            default_count = EXCLUDED.default_count,
            strict_grounding = EXCLUDED.strict_grounding,
            system_instruction = EXCLUDED.system_instruction,
            updated_at = NOW()`,
          cleanGid,
          resolvedKey || null,
          updated.defaultModel,
          updated.defaultDifficulty,
          updated.defaultCount,
          updated.strictGrounding,
          updated.systemInstruction || ""
        );

        if (resolvedKey) {
          await prisma.$executeRawUnsafe(
            `INSERT INTO ai_curriculum_settings (
              group_id, gemini_api_key, default_model, default_difficulty, default_count,
              strict_grounding, system_instruction, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
            ON CONFLICT (group_id) DO UPDATE SET
              gemini_api_key = EXCLUDED.gemini_api_key,
              updated_at = NOW()`,
            GLOBAL_SETTINGS_KEY,
            resolvedKey,
            updated.defaultModel,
            updated.defaultDifficulty,
            updated.defaultCount,
            updated.strictGrounding,
            updated.systemInstruction || ""
          );
        }
      }
    } catch (dbErr) {
      console.warn("[aiStorage] DB update settings notice (falling back to disk):", dbErr);
    }
  }

  // 2. Also write to local file storage
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
