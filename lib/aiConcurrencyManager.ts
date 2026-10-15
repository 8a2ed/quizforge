/**
 * AI Concurrency, Rate Limiting, Key Rotation & Intelligent Question Pooling Manager
 *
 * Designed to handle extreme high-concurrency loads smoothly without delays,
 * preventing Gemini 429 errors and delivering instant (zero-latency) quizzes
 * under peak student traffic.
 */

import { ValidatedQuestion } from "./questionValidator";

// ─── 1. Multi-Key Load Balancer & Rotator ─────────────────────────────────────

interface KeyHealth {
  key: string;
  cooldownUntil: number;
  failureCount: number;
  activeRequests: number;
  totalSuccess: number;
}

class ApiKeyManager {
  private keys: Map<string, KeyHealth> = new Map();
  private roundRobinIdx = 0;

  /**
   * Parses and registers one or multiple Gemini API keys (comma, semicolon, or newline separated).
   */
  public registerKeys(rawInput?: string): string[] {
    if (!rawInput) return [];
    const split = rawInput
      .split(/[\n,;]+/g)
      .map((k) => k.trim())
      .filter((k) => k.length >= 20 && !k.includes("...") && !k.includes("•••"));

    for (const key of split) {
      if (!this.keys.has(key)) {
        this.keys.set(key, {
          key,
          cooldownUntil: 0,
          failureCount: 0,
          activeRequests: 0,
          totalSuccess: 0,
        });
      }
    }
    return split;
  }

  /**
   * Selects the healthiest, least-busy available API key.
   */
  public acquireKey(preferredKey?: string): string {
    const now = Date.now();
    if (preferredKey) {
      this.registerKeys(preferredKey);
    }

    const allKeys = Array.from(this.keys.values());
    if (allKeys.length === 0) {
      return preferredKey?.trim() || process.env.GEMINI_API_KEY?.trim() || "";
    }

    // Filter available keys (not in 429 cooldown)
    const available = allKeys.filter((k) => k.cooldownUntil <= now);
    const candidates = available.length > 0 ? available : allKeys;

    // Sort by least active requests, then least failure count
    candidates.sort((a, b) => {
      if (a.activeRequests !== b.activeRequests) {
        return a.activeRequests - b.activeRequests;
      }
      return a.failureCount - b.failureCount;
    });

    const selected = candidates[0];
    selected.activeRequests++;
    return selected.key;
  }

  public releaseKey(key: string, success: boolean, isRateLimitError: boolean = false) {
    const health = this.keys.get(key);
    if (!health) return;

    health.activeRequests = Math.max(0, health.activeRequests - 1);
    if (success) {
      health.failureCount = 0;
      health.totalSuccess++;
      health.cooldownUntil = 0;
    } else {
      health.failureCount++;
      if (isRateLimitError) {
        // Cooldown for 45s on 429 quota exhaustion so other keys take traffic
        health.cooldownUntil = Date.now() + 45_000;
        console.warn(`[ApiKeyManager] Key ending in ...${key.slice(-6)} placed in cooldown for 45s due to rate limit.`);
      }
    }
  }

  public markFailure(key: string, statusCodeOrIsRateLimit: number | boolean = true) {
    const isRateLimit = typeof statusCodeOrIsRateLimit === "number" ? statusCodeOrIsRateLimit === 429 : !!statusCodeOrIsRateLimit;
    this.releaseKey(key, false, isRateLimit);
  }

  public getAllRegisteredKeys(): string[] {
    return Array.from(this.keys.keys());
  }
}

export const apiKeyManager = new ApiKeyManager();

// ─── 2. Adaptive Concurrency Limiter & Priority Queue ─────────────────────────

type TaskResolver<T> = (value: T | PromiseLike<T>) => void;
type TaskRejector = (reason?: any) => void;

interface QueuedTask<T> {
  id: string;
  execute: () => Promise<T>;
  resolve: TaskResolver<T>;
  reject: TaskRejector;
  priority: number; // Higher is processed first
  enqueuedAt: number;
  onPositionUpdate?: (position: number, totalQueued: number) => void;
}

class AdaptiveConcurrencyQueue {
  private activeCount = 0;
  // Maximum concurrent Gemini API requests to prevent 429 spikes
  private maxConcurrency = 4;
  private queue: QueuedTask<any>[] = [];

  constructor(maxConcurrency = 4) {
    this.maxConcurrency = maxConcurrency;
  }

  public setMaxConcurrency(val: number) {
    this.maxConcurrency = Math.max(1, Math.min(val, 16));
  }

  public getStats() {
    return {
      active: this.activeCount,
      queued: this.queue.length,
      maxConcurrency: this.maxConcurrency,
    };
  }

  /**
   * Enqueues a task to run within concurrency limits.
   */
  public run<T>(
    task: () => Promise<T>,
    options?: {
      priority?: number;
      taskId?: string;
      onPositionUpdate?: (position: number, totalQueued: number) => void;
    }
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const queuedItem: QueuedTask<T> = {
        id: options?.taskId || `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        execute: task,
        resolve,
        reject,
        priority: options?.priority ?? 0,
        enqueuedAt: Date.now(),
        onPositionUpdate: options?.onPositionUpdate,
      };

      // If under limit, execute immediately
      if (this.activeCount < this.maxConcurrency) {
        this.executeTask(queuedItem);
      } else {
        // Enqueue sorted by priority
        this.queue.push(queuedItem);
        this.queue.sort((a, b) => b.priority - a.priority || a.enqueuedAt - b.enqueuedAt);
        this.notifyPositions();
      }
    });
  }

  private async executeTask<T>(item: QueuedTask<T>) {
    this.activeCount++;
    try {
      const result = await item.execute();
      item.resolve(result);
    } catch (err) {
      item.reject(err);
    } finally {
      this.activeCount--;
      this.processNext();
    }
  }

  private processNext() {
    if (this.queue.length === 0 || this.activeCount >= this.maxConcurrency) {
      return;
    }

    const nextItem = this.queue.shift();
    if (nextItem) {
      this.notifyPositions();
      this.executeTask(nextItem);
    }
  }

  private notifyPositions() {
    for (let i = 0; i < this.queue.length; i++) {
      const item = this.queue[i];
      if (item.onPositionUpdate) {
        try {
          item.onPositionUpdate(i + 1, this.queue.length);
        } catch {}
      }
    }
  }
}

export const geminiConcurrencyQueue = new AdaptiveConcurrencyQueue(4);

// ─── 3. Dynamic Question Pool Cache (Zero-Latency Under High Load) ────────────

interface PooledQuestionItem {
  question: ValidatedQuestion;
  materialId: string;
  sectionId?: string;
  difficulty: string;
  addedAt: number;
  useCount: number;
}

declare global {
  var __qfQuestionPool: Map<string, PooledQuestionItem[]> | undefined;
  var __qfSingleFlightMap: Map<string, Promise<any>> | undefined;
}

const questionPool: Map<string, PooledQuestionItem[]> =
  (globalThis.__qfQuestionPool ??= new Map());

const singleFlightMap: Map<string, Promise<any>> =
  (globalThis.__qfSingleFlightMap ??= new Map());

function buildPoolKey(materialId: string, sectionId?: string, difficulty?: string): string {
  const s = sectionId && sectionId !== "all" ? sectionId : "all";
  const d = difficulty || "mixed";
  return `${materialId}:${s}:${d}`;
}

export class QuestionPoolManager {
  private static MAX_POOL_SIZE = 120;
  private static TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Adds newly generated validated questions into the active pool.
   */
  public static addQuestions(
    materialId: string,
    sectionIdOrQuestions: string | undefined | ValidatedQuestion[] | any[],
    difficultyOrSectionId?: string,
    questionsOrDifficulty?: ValidatedQuestion[] | any[] | string
  ): void {
    if (!materialId) return;

    let sectionId: string | undefined;
    let difficulty: string | undefined;
    let questions: ValidatedQuestion[] = [];

    if (Array.isArray(sectionIdOrQuestions)) {
      questions = sectionIdOrQuestions;
      sectionId = typeof difficultyOrSectionId === "string" ? difficultyOrSectionId : undefined;
      difficulty = typeof questionsOrDifficulty === "string" ? questionsOrDifficulty : undefined;
    } else {
      sectionId = sectionIdOrQuestions;
      difficulty = typeof difficultyOrSectionId === "string" ? difficultyOrSectionId : undefined;
      questions = Array.isArray(questionsOrDifficulty) ? questionsOrDifficulty : [];
    }

    if (!questions || questions.length === 0) return;
    const key = buildPoolKey(materialId, sectionId, difficulty);
    const existing = questionPool.get(key) || [];

    const seenText = new Set(existing.map((e) => e.question.question.trim().toLowerCase()));

    for (const q of questions) {
      const norm = q.question.trim().toLowerCase();
      if (!seenText.has(norm)) {
        seenText.add(norm);
        existing.push({
          question: q,
          materialId,
          sectionId,
          difficulty: difficulty || "mixed",
          addedAt: Date.now(),
          useCount: 0,
        });
      }
    }

    // Keep within reasonable pool size to prevent memory bloat
    if (existing.length > this.MAX_POOL_SIZE) {
      existing.sort((a, b) => a.useCount - b.useCount || b.addedAt - a.addedAt);
      existing.length = this.MAX_POOL_SIZE;
    }

    questionPool.set(key, existing);
  }

  /**
   * Tries to immediately acquire a batch of unique, randomized questions from the active pool.
   * Shuffles options and assigns unique IDs to prevent students from memorizing static choices.
   */
  public static acquireFromPool(
    materialId: string,
    requestedCount: number,
    sectionId?: string,
    difficulty?: string,
    excludeQuestionTexts: Set<string> = new Set()
  ): ValidatedQuestion[] | null {
    return this.tryAcquireBatch(materialId, sectionId, difficulty, requestedCount, excludeQuestionTexts);
  }

  public static tryAcquireBatch(
    materialId: string,
    sectionId: string | undefined,
    difficulty: string | undefined,
    requestedCount: number,
    excludeQuestionTexts: Set<string> = new Set()
  ): ValidatedQuestion[] | null {
    const key = buildPoolKey(materialId, sectionId, difficulty);
    let items = questionPool.get(key);

    // If section was specific but pool is empty, check fallback to "all" section pool
    if ((!items || items.length < requestedCount) && sectionId && sectionId !== "all") {
      const globalKey = buildPoolKey(materialId, "all", difficulty);
      const fallbackItems = questionPool.get(globalKey);
      if (fallbackItems && fallbackItems.length >= requestedCount) {
        items = fallbackItems;
      }
    }

    if (!items || items.length === 0) return null;

    // Clean expired items
    const now = Date.now();
    items = items.filter((it) => now - it.addedAt < this.TTL_MS);
    questionPool.set(key, items);

    // Filter out already seen questions for this student
    const available = items.filter(
      (it) => !excludeQuestionTexts.has(it.question.question.trim().toLowerCase())
    );

    if (available.length < requestedCount) {
      return null;
    }

    // Random sampling favoring less frequently used questions
    available.sort(() => Math.random() - 0.5);
    available.sort((a, b) => a.useCount - b.useCount);

    const selectedSlice = available.slice(0, requestedCount);
    for (const it of selectedSlice) {
      it.useCount++;
    }

    // Return randomized clone with shuffled options to maintain academic freshness
    return selectedSlice.map((it, idx) => {
      const q = it.question;
      const optsWithOrigIdx = q.options.map((opt, oIdx) => ({
        text: opt,
        isCorrect: oIdx === q.correctOptionId,
      }));

      // Shuffle options randomly
      optsWithOrigIdx.sort(() => Math.random() - 0.5);
      const newCorrectIdx = optsWithOrigIdx.findIndex((o) => o.isCorrect);

      return {
        ...q,
        id: `q_pool_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`,
        options: optsWithOrigIdx.map((o) => o.text),
        correctOptionId: newCorrectIdx >= 0 ? newCorrectIdx : 0,
      };
    });
  }

  public static getPoolCount(materialId: string, sectionId?: string, difficulty?: string): number {
    const key = buildPoolKey(materialId, sectionId, difficulty);
    return questionPool.get(key)?.length || 0;
  }
}

// ─── 4. Singleflight Request Deduplication ─────────────────────────────────────

/**
 * Deduplicates concurrent identical generation requests (e.g. multiple students
 * requesting the exact same chapter and difficulty at the exact same second).
 */
export async function runSingleflight<T>(
  key: string,
  factory: () => Promise<T>
): Promise<T> {
  const existing = singleFlightMap.get(key);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    try {
      return await factory();
    } finally {
      singleFlightMap.delete(key);
    }
  })();

  singleFlightMap.set(key, promise);
  return promise;
}
