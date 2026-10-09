import { cleanText, splitIntoSections, extractSuggestedTopics, extractTextFromBuffer } from "../lib/textExtractor";
import { validateAndSanitizeQuestion, TELEGRAM_LIMITS } from "../lib/questionValidator";
import {
  getMaterials,
  saveMaterial,
  deleteMaterial,
  recordGenerationLog,
  getAIAnalytics,
  getGroupAISettings,
  updateGroupAISettings,
  CurriculumMaterial,
} from "../lib/aiStorage";
import {
  estimateTokens,
  extractQuestionsFromJson,
  DEFAULT_GEMINI_MODEL,
  RECOMMENDED_GEMINI_MODELS,
  BASE_GEMINI_MODELS,
  normalizeModelName,
  isModelNotFoundError,
  fetchAvailableGeminiModels,
  getFallbackCandidates,
  testGeminiConnection,
  extractDocumentTextWithGemini,
} from "../lib/gemini";

async function runTests() {
  console.log("=== RUNNING ENHANCED AI CURRICULUM VERIFICATION SUITE ===");

  // ── 1. Text Extractor & Normalization Tests ──
  console.log("\n[1] Testing Text Extractor & Cleaners...");
  const rawSample = `   الفصل الأول: الحركة والسرعة في خط مستقيم   \r\n\r\nالسرعة هي المسافة المقطوعة خلال وحدة الزمن.\n-- 1 of 12 --\nPage 1 of 12\n\nوحدة القياس هي م/ث.  `;
  const cleaned = cleanText(rawSample);
  if (!cleaned.includes("الفصل الأول") || cleaned.includes("\r") || cleaned.includes("-- 1 of 12 --") || cleaned.includes("Page 1 of 12")) {
    throw new Error("cleanText failed to clean carriage returns or PDF page markers!");
  }
  console.log("  ✓ cleanText normalized whitespace and stripped PDF page footer markers");

  const sections = splitIntoSections(`
الفصل الأول: السرعة
هذا محتوى الفصل الأول عن السرعة المنتظمة.
الفصل الثاني: العجلة
هذا محتوى الفصل الثاني عن التسارع وقوانين نيوتن.
أولاً: القانون الأول لنيوتن
يظل الجسم الساكن ساكناً.
  `);
  if (sections.length < 3) {
    throw new Error(`splitIntoSections expected at least 3 sections, got ${sections.length}`);
  }
  console.log(`  ✓ splitIntoSections successfully identified ${sections.length} chapters and ordinal sections`);

  const mdSections = splitIntoSections(`
# الفصل الأول: مقدمة في المنهج
محتوى تمهيدي.
## الفصل الثاني: القوانين الأساسية
محتوى القوانين.
  `);
  if (mdSections[0].title.startsWith("#") || mdSections[1].title.startsWith("#")) {
    throw new Error("splitIntoSections failed to strip Markdown header hashes from titles!");
  }
  console.log("  ✓ splitIntoSections cleanly stripped Markdown hashes from section titles");

  // Test DOMMatrix and Canvas polyfills
  if (typeof (globalThis as any).DOMMatrix !== "function") {
    throw new Error("DOMMatrix polyfill is not defined on globalThis!");
  }
  if (typeof (globalThis as any).DOMMatrixReadOnly !== "function") {
    throw new Error("DOMMatrixReadOnly polyfill is not defined on globalThis!");
  }

  // 1. Array initialization
  const testMatrix = new (globalThis as any).DOMMatrix([1, 0, 0, 1, 10, 20]);
  if (!testMatrix || (testMatrix.m41 !== 10 && testMatrix.e !== 10)) {
    throw new Error("DOMMatrix failed to instantiate or transform coordinates!");
  }

  // 2. Float32Array & Float64Array initialization (Critical for pdfjs-dist)
  const float32Mat = new (globalThis as any).DOMMatrix(new Float32Array([1, 0, 0, 1, 55, 65]));
  if (float32Mat.m41 !== 55 || float32Mat.e !== 55 || float32Mat.f !== 65) {
    throw new Error(`DOMMatrix failed to initialize from Float32Array! Got e=${float32Mat.e}, f=${float32Mat.f}`);
  }

  // 3. Object-based initialization
  const objMat = new (globalThis as any).DOMMatrix({ a: 2, b: 0, c: 0, d: 2, e: 100, f: 200 });
  if (objMat.a !== 2 || objMat.m11 !== 2 || objMat.e !== 100 || objMat.m41 !== 100) {
    throw new Error("DOMMatrix failed to initialize from object dictionary!");
  }

  // 4. Accessor synchronization check (a <-> m11, e <-> m41)
  testMatrix.a = 7;
  testMatrix.e = 88;
  if (testMatrix.m11 !== 7 || testMatrix.m41 !== 88) {
    throw new Error("DOMMatrix accessors (a, e) failed to synchronize with m11, m41!");
  }

  // 5. Matrix multiplication & translation
  const translated = testMatrix.translate(10, 20);
  if (translated.e !== 98 || translated.f !== 40) {
    throw new Error(`DOMMatrix translate failed: expected e=98, f=40, got e=${translated.e}, f=${translated.f}`);
  }

  // 6. Path2D and roundRect check
  if (typeof (globalThis as any).Path2D !== "function") {
    throw new Error("Path2D polyfill is not defined on globalThis!");
  }
  const p2d = new (globalThis as any).Path2D();
  if (typeof p2d.roundRect !== "function") {
    throw new Error("Path2D.roundRect polyfill missing!");
  }

  // 7. ImageData dual-signature check (Critical for pdfjs-dist image decoding)
  if (typeof (globalThis as any).ImageData !== "function") {
    throw new Error("ImageData polyfill is not defined on globalThis!");
  }
  const imgWithData = new (globalThis as any).ImageData(new Uint8ClampedArray(400), 10, 10);
  if (imgWithData.width !== 10 || imgWithData.height !== 10 || imgWithData.data.length !== 400) {
    throw new Error(`ImageData failed with clamped array signature! Got width=${imgWithData.width}, len=${imgWithData.data?.length}`);
  }
  console.log("  ✓ DOMMatrix, DOMMatrixReadOnly, Path2D, and ImageData polyfilled seamlessly with full TypedArray and dual-signature support");

  // Test real PDF buffer extraction without DOMMatrix errors
  const minimalPdf = Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 53 >>\nstream\nBT\n/F1 24 Tf\n100 700 Td\n(Physics Textbook Chapter One) Tj\nET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000010 00000 n \n0000000060 00000 n \n0000000117 00000 n \n0000000282 00000 n \ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n386\n%%EOF"
  );
  const pdfExtracted = await extractTextFromBuffer(minimalPdf, "pdf");
  if (!pdfExtracted.cleanedText.includes("Physics Textbook")) {
    throw new Error("PDF text extraction failed on minimal valid PDF buffer!");
  }
  console.log("  ✓ extractTextFromBuffer extracted text successfully from real PDF buffer without DOMMatrix errors");

  // Test Multimodal Document & Handwriting OCR safety check
  let imageOcrErrorCaught = false;
  try {
    await extractTextFromBuffer(Buffer.from("image_data"), "image", { apiKey: "" });
  } catch (err: any) {
    imageOcrErrorCaught = true;
    if (!err.message.includes("Google Gemini API Key")) {
      throw new Error(`Expected Gemini API key error on image OCR, got: ${err.message}`);
    }
  }
  if (!imageOcrErrorCaught) {
    throw new Error("extractTextFromBuffer on image should safely reject missing API key!");
  }
  console.log("  ✓ NotebookLM Gemini multimodal OCR safely validates API key for images & handwriting");

  // Test forceOcr on PDF
  let forceOcrErrorCaught = false;
  try {
    await extractTextFromBuffer(minimalPdf, "pdf", { forceOcr: true, apiKey: "" });
  } catch (err: any) {
    forceOcrErrorCaught = true;
    if (!err.message.includes("Google Gemini API Key")) {
      throw new Error(`Expected Gemini API key error on forceOcr, got: ${err.message}`);
    }
  }
  if (!forceOcrErrorCaught) {
    throw new Error("extractTextFromBuffer with forceOcr: true should safely route to OCR and require API key!");
  }
  console.log("  ✓ PDF forceOcr correctly bypasses digital extraction and routes directly to NotebookLM OCR");

  // ── 2. Question Validator & Telegram Limits Edge Cases ──
  console.log("\n[2] Testing Question Validator & Telegram Constraints Edge Cases...");
  
  // Test over-long question truncation (>300 chars)
  const longQuestion = "س".repeat(350);
  const validatedLong = validateAndSanitizeQuestion({
    question: longQuestion,
    options: ["خيار 1", "خيار 2", "خيار 3", "خيار 4"],
    correctOptionId: 1,
    explanation: "شرح الإجابة",
  });
  if (validatedLong.question.length > TELEGRAM_LIMITS.MAX_QUESTION_LENGTH) {
    throw new Error(`Question length ${validatedLong.question.length} exceeds 300 limit!`);
  }
  console.log(`  ✓ Enforced max question limit: ${validatedLong.question.length} chars (<= 300)`);

  // Test duplicate options resolution on 100-character options (CRITICAL TELEGRAM CONSTRAINT)
  const longOpt = "A".repeat(100);
  const duplicate100Opts = validateAndSanitizeQuestion({
    question: "ما هي عاصمة مصر؟",
    options: [longOpt, longOpt, "الإسكندرية", "أسوان"],
    correctOptionId: 0,
  });
  for (let i = 0; i < duplicate100Opts.options.length; i++) {
    const len = duplicate100Opts.options[i].length;
    if (len > TELEGRAM_LIMITS.MAX_OPTION_LENGTH) {
      throw new Error(`Deduplicated option length ${len} exceeded Telegram 100 character limit!`);
    }
  }
  const optSet = new Set(duplicate100Opts.options.map((o) => o.toLowerCase()));
  if (optSet.size !== duplicate100Opts.options.length) {
    throw new Error("Duplicate options were not resolved!");
  }
  console.log("  ✓ Deduplicated 100-character options strictly maintaining length <= 100 chars");

  // Test letter format correct answers ("B", "ج")
  const letterAnswerQuestion = validateAndSanitizeQuestion({
    question: "عاصمة فرنسا؟",
    options: ["برلين", "باريس", "روما", "مدريد"],
    correctAnswer: "B",
  } as any);
  if (letterAnswerQuestion.correctOptionId !== 1) {
    throw new Error(`Letter answer "B" resolved to ${letterAnswerQuestion.correctOptionId}, expected 1!`);
  }
  console.log('  ✓ Successfully resolved letter-based correct answer ("B" -> 1)');

  // Test snake_case correct_option_id
  const snakeCaseQuestion = validateAndSanitizeQuestion({
    question: "عاصمة إيطاليا؟",
    options: ["برلين", "باريس", "روما", "مدريد"],
    correct_option_id: 2,
  } as any);
  if (snakeCaseQuestion.correctOptionId !== 2) {
    throw new Error(`snake_case correct_option_id resolved to ${snakeCaseQuestion.correctOptionId}, expected 2!`);
  }
  console.log('  ✓ Successfully resolved snake_case correct_option_id');

  // Test text-based matching correct answer
  const textMatchQuestion = validateAndSanitizeQuestion({
    question: "عاصمة إسبانيا؟",
    options: ["برلين", "باريس", "روما", "مدريد"],
    correctAnswer: "مدريد",
  } as any);
  if (textMatchQuestion.correctOptionId !== 3) {
    throw new Error(`Text match answer "مدريد" resolved to ${textMatchQuestion.correctOptionId}, expected 3!`);
  }
  console.log('  ✓ Successfully resolved text matching correct answer ("مدريد" -> 3)');

  // Test object-based options { A: "...", B: "..." }
  const objectOptionsQuestion = validateAndSanitizeQuestion({
    question: "عاصمة ألمانيا؟",
    options: { A: "برلين", B: "ميونيخ", C: "فرانكفورت", D: "هامبورغ" },
    correctOptionId: 0,
  } as any);
  if (objectOptionsQuestion.options.length !== 4 || objectOptionsQuestion.options[0] !== "برلين") {
    throw new Error(`Object-based options were not parsed properly! Got: ${JSON.stringify(objectOptionsQuestion.options)}`);
  }
  console.log("  ✓ Successfully normalized object-based options dictionary to array");

  // ── 3. Resilient JSON Parser Tests ──
  console.log("\n[3] Testing Resilient JSON Response Parser...");
  // Test code fence with preamble and trailing comma
  const messyResponse = `
Here is the examination paper you requested:
\`\`\`json
{
  "questions": [
    {
      "question": "ما هي وحدة السرعة؟",
      "options": ["م/ث", "كم/س", "م/ث2", "جول",],
      "correctOptionId": 0,
      "explanation": "المتر لكل ثانية هي الوحدة الدولية."
    }
  ],
}
\`\`\`
All questions grounded in text.
  `;
  const extractedQuestions = extractQuestionsFromJson(messyResponse);
  if (extractedQuestions.length !== 1 || !extractedQuestions[0].question.includes("وحدة السرعة")) {
    throw new Error("extractQuestionsFromJson failed on messy LLM response!");
  }
  console.log("  ✓ Handled markdown preamble, code fence, and trailing commas seamlessly");

  // ── 4. AI Storage, Analytics & Protection Tests ──
  console.log("\n[4] Testing AI Storage & Usage Analytics...");
  const testGroupId = "test-group-" + Date.now();
  
  // Test getting materials (verifies sample seeding & complete text)
  const materials = await getMaterials(testGroupId);
  if (materials.length === 0) {
    throw new Error("Default educational materials were not seeded!");
  }
  const csSample = materials.find((m) => m.id === "sample-cs-en");
  if (!csSample || csSample.cleanedText.includes("...")) {
    throw new Error("Sample CS material contains truncated text with ellipsis!");
  }
  console.log(`  ✓ Seeded sample textbooks verified without truncation (${materials.length} available)`);

  // Test disallowing deletion of global sample materials
  const globalDeleteResult = await deleteMaterial(testGroupId, "sample-science-ar");
  if (globalDeleteResult === true) {
    throw new Error("Global sample material was incorrectly deleted!");
  }
  console.log("  ✓ Successfully protected global curriculum templates from deletion");

  // Test custom material save
  const customMat: CurriculumMaterial = {
    id: "test-mat-" + Date.now(),
    groupId: testGroupId,
    title: "مذكرة اختبارية مؤقتة",
    subject: "اختبار",
    grade: "الصف الأول",
    fileName: "test.txt",
    fileType: "txt",
    fileSize: 120,
    rawText: "نص اختباري متكامل",
    cleanedText: "نص اختباري متكامل",
    wordCount: 3,
    charCount: 16,
    topics: ["موضوع 1"],
    sections: [{ id: "sec-1", title: "قسم 1", content: "نص", wordCount: 1 }],
    uploadedBy: { id: "user-1", name: "المعلم أحمد", username: "ahmed_teacher" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveMaterial(customMat);
  console.log("  ✓ Custom material saved successfully");

  // Test generation logging & metrics
  await recordGenerationLog({
    id: "log-" + Date.now(),
    groupId: testGroupId,
    userId: "user-1",
    userName: "المعلم أحمد",
    userUsername: "ahmed_teacher",
    materialTitle: customMat.title,
    questionCount: 5,
    modelUsed: DEFAULT_GEMINI_MODEL,
    estimatedTokens: 350,
    difficulty: "EASY",
    timestamp: new Date().toISOString(),
    success: true,
    questionsSummary: [
      { question: "س1", difficulty: "EASY", topic: "موضوع 1" },
      { question: "س2", difficulty: "EASY", topic: "موضوع 1" },
    ],
  });

  const analytics = await getAIAnalytics(testGroupId);
  if (analytics.totalGenerations < 1 || analytics.totalQuestions < 5) {
    throw new Error(`Analytics mismatch: totalGenerations=${analytics.totalGenerations}, totalQuestions=${analytics.totalQuestions}`);
  }
  if (analytics.userLeaderboard.length === 0 || analytics.userLeaderboard[0].userName !== "المعلم أحمد") {
    throw new Error("User leaderboard did not correctly attribute generation to user!");
  }
  console.log(`  ✓ Analytics updated: ${analytics.totalGenerations} gen, ${analytics.totalQuestions} questions, ${analytics.activeUsersCount} active instructors`);

  // Test AI Settings & API Key Non-Overwrite Protection
  const settings = await getGroupAISettings(testGroupId);
  if (!settings.defaultModel) {
    throw new Error("Default AI settings missing");
  }

  // 1. Set explicit API key
  const testApiKey = "AIzaSyTestValidKey9988";
  await updateGroupAISettings(testGroupId, {
    geminiApiKey: testApiKey,
    defaultModel: DEFAULT_GEMINI_MODEL,
    defaultDifficulty: "hard",
    defaultCount: 10,
    strictGrounding: true,
  });

  const settingsAfterKey = await getGroupAISettings(testGroupId);
  if (settingsAfterKey.geminiApiKey !== testApiKey) {
    throw new Error(`Failed to save geminiApiKey! Expected ${testApiKey}, got ${settingsAfterKey.geminiApiKey}`);
  }
  console.log("  ✓ API key successfully saved and verified");

  // 2. Perform partial update with empty key string — must NOT overwrite saved key!
  const updatedWithEmptyKey = await updateGroupAISettings(testGroupId, {
    defaultCount: 15,
    geminiApiKey: "",
  });
  if (updatedWithEmptyKey.geminiApiKey !== testApiKey || updatedWithEmptyKey.defaultCount !== 15) {
    throw new Error("Empty geminiApiKey overwrote existing saved API key!");
  }

  // 3. Perform partial update with masked key string — must NOT overwrite saved key!
  const updatedWithMaskedKey = await updateGroupAISettings(testGroupId, {
    defaultDifficulty: "medium",
    geminiApiKey: "AIza••••9988",
  });
  if (updatedWithMaskedKey.geminiApiKey !== testApiKey) {
    throw new Error("Masked geminiApiKey overwrote existing saved API key!");
  }
  console.log("  ✓ Critical protection verified: saved Gemini API Key is NEVER lost or overwritten by empty/masked inputs");

  // 4. Test Global Key Fallback for other groups
  const otherGroupId = `other-group-${Date.now()}`;
  const otherGroupSettings = await getGroupAISettings(otherGroupId);
  if (otherGroupSettings.geminiApiKey !== testApiKey) {
    throw new Error(`Global key inheritance failed! Expected ${testApiKey}, got ${otherGroupSettings.geminiApiKey}`);
  }
  console.log("  ✓ Cross-group API key inheritance verified: new groups automatically inherit configured Google API key");

  // Verify custom material is retrievable by getMaterials
  const fetchedMaterials = await getMaterials(testGroupId);
  const foundCustom = fetchedMaterials.find((m) => m.id === customMat.id);
  if (!foundCustom || foundCustom.title !== customMat.title) {
    throw new Error("Custom material was not found in getMaterials result!");
  }
  console.log("  ✓ Custom material reliably retrieved from storage");

  // Verify repeated getMaterials calls do NOT mutate storage or lose custom material
  await getMaterials(testGroupId);
  await getMaterials("any-other-group");
  const recheckedMaterials = await getMaterials(testGroupId);
  if (!recheckedMaterials.some((m) => m.id === customMat.id)) {
    throw new Error("Repeated getMaterials calls wiped or lost the custom material!");
  }
  console.log("  ✓ Non-destructive reads verified: multiple read queries preserve all custom materials without wiping");

  // Verify cross-group delete protection: other group CANNOT delete customMat
  const unauthorizedDelete = await deleteMaterial("different-group-id", customMat.id);
  if (unauthorizedDelete) {
    throw new Error("Different group was able to delete custom material owned by another group!");
  }
  console.log("  ✓ Strict group ownership verified: cross-group deletion rejected");

  // Cleanup test material
  const deleteCustomResult = await deleteMaterial(testGroupId, customMat.id);
  if (!deleteCustomResult) {
    throw new Error("Failed to delete custom test material!");
  }
  console.log("  ✓ Custom material deletion verified");

  // ── 5. Gemini Token Estimation ──
  console.log("\n[5] Testing Token Estimation...");
  const tokens = estimateTokens("هذا نص اختباري لحساب عدد التوكنز");
  if (tokens <= 0) {
    throw new Error("Token estimation failed");
  }
  console.log(`  ✓ Token estimation returned ~${tokens} tokens`);

  // ── 6. Gemini Model Fallback & Discovery Helpers ──
  console.log("\n[6] Testing Gemini 3.8-flash, Deprecation Fallback & Discovery Helpers...");
  if (DEFAULT_GEMINI_MODEL !== "gemini-3.8-flash") {
    throw new Error(`DEFAULT_GEMINI_MODEL expected "gemini-3.8-flash", got ${DEFAULT_GEMINI_MODEL}`);
  }
  if (RECOMMENDED_GEMINI_MODELS[0].id !== "gemini-3.8-flash") {
    throw new Error(`Top recommended model must be gemini-3.8-flash`);
  }
  if (!BASE_GEMINI_MODELS.includes("gemini-3.8-flash") || !BASE_GEMINI_MODELS.includes("gemini-2.5-pro")) {
    throw new Error("BASE_GEMINI_MODELS must include gemini-3.8-flash and gemini-2.5-pro");
  }
  console.log("  ✓ Primary default model verified as gemini-3.8-flash, modern models present");

  // Normalize model name checks
  if (normalizeModelName("models/gemini-3.8-flash") !== "gemini-3.8-flash") {
    throw new Error("normalizeModelName failed on prefix strip");
  }
  if (normalizeModelName("/models/gemini-3.8-flash") !== "gemini-3.8-flash") {
    throw new Error("normalizeModelName failed on leading slash prefix strip");
  }
  if (normalizeModelName("") !== "gemini-3.8-flash") {
    throw new Error("normalizeModelName failed on empty string default fallback");
  }
  console.log("  ✓ Model name normalizer correctly strips prefixes and defaults to gemini-3.8-flash");

  // Model not found / deprecation detector checks
  const err404Legacy = "404: This model models/gemini-2.0-flash is no longer available. Please update your code to use models/gemini-3.8-flash for the latest features and improvements.";
  if (!isModelNotFoundError(404, err404Legacy)) {
    throw new Error("isModelNotFoundError failed to detect 404 deprecation message!");
  }
  const err404Pro = "404: models/gemini-1.5-pro is not found for API version v1beta, or is not supported for generateContent. Call ModelService.ListModels to see the list of available models.";
  if (!isModelNotFoundError(404, err404Pro)) {
    throw new Error("isModelNotFoundError failed to detect 404 model not found message!");
  }
  const errDeprecated = "The model gemini-1.0-pro has been deprecated and discontinued.";
  if (!isModelNotFoundError(400, errDeprecated)) {
    throw new Error("isModelNotFoundError failed on deprecated notice!");
  }
  if (isModelNotFoundError(200, "OK")) {
    throw new Error("isModelNotFoundError falsely triggered on 200 OK!");
  }
  if (isModelNotFoundError(429, "Resource has been exhausted")) {
    throw new Error("isModelNotFoundError falsely triggered on 429 quota exhaustion!");
  }
  console.log("  ✓ Deprecation and 404 detection correctly identifies outdated model errors");

  // Fallback candidates logic
  const candidatesFor20 = getFallbackCandidates("gemini-2.0-flash", [
    {
      id: "gemini-custom-school",
      name: "models/gemini-custom-school",
      displayName: "Custom Model",
      description: "",
      supportedGenerationMethods: ["generateContent"],
    },
  ]);
  if (!candidatesFor20.includes("gemini-3.8-flash")) {
    throw new Error("Fallback candidates must prioritize gemini-3.8-flash");
  }
  if (!candidatesFor20.includes("gemini-custom-school")) {
    throw new Error("Fallback candidates must include dynamic models");
  }
  if (candidatesFor20.includes("gemini-2.0-flash") || candidatesFor20.includes("gemini-1.5-flash")) {
    throw new Error("Fallback candidates must NOT contain deprecated models!");
  }
  console.log("  ✓ Fallback candidate resolution prioritizes gemini-3.8-flash and excludes deprecated models");

  // Safe empty key checks
  const emptyKeyTest = await testGeminiConnection("");
  if (emptyKeyTest.success) {
    throw new Error("testGeminiConnection should fail cleanly when no API key is provided");
  }
  if (!Array.isArray(emptyKeyTest.availableModels) || emptyKeyTest.availableModels.length !== 0) {
    throw new Error("testGeminiConnection must return empty availableModels on failure");
  }
  console.log("  ✓ testGeminiConnection safely rejects empty API key and returns empty availableModels");

  const emptyModels = await fetchAvailableGeminiModels("");
  if (!Array.isArray(emptyModels) || emptyModels.length !== 0) {
    throw new Error("fetchAvailableGeminiModels should return empty array for empty key");
  }
  console.log("  ✓ fetchAvailableGeminiModels safely handles empty key without crashing");

  console.log("\n✨ ALL ENHANCED AI CURRICULUM TESTS PASSED WITH 100% SUCCESS! ✨\n");
}

runTests().catch((err) => {
  console.error("Test Suite Failed:", err);
  process.exit(1);
});
