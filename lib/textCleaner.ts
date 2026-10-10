export interface ExtractedSection {
  id: string;
  title: string;
  content: string;
  wordCount: number;
}

/**
 * Clean and normalize extracted text (Arabic & English support).
 */
export function cleanText(text: string): string {
  if (!text) return "";

  return text
    // Strip UTF-8 Byte Order Mark (BOM) if present
    .replace(/^\uFEFF/, "")
    // Replace carriage returns
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    // Remove null characters or non-printable controls
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    // Remove PDF page numbers & joiner artifacts (e.g. "-- 1 of 12 --", "Page 1 of 5", "صفحة 1 من 10")
    .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, "")
    .replace(/(?:Page|صفحة)\s+\d+\s*(?:of|\/|من)\s*\d+/gi, "")
    // Normalize excessive horizontal whitespace
    .replace(/[ \t]+/g, " ")
    // Normalize excessive newlines (keep max 2 for paragraph separation)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Detect smart sections or chapters in curriculum text.
 */
export function splitIntoSections(cleanedText: string): ExtractedSection[] {
  if (!cleanedText) return [];

  // Patterns for common Arabic and English headings/chapters
  const headingRegex = /(?:^|\n)(?=(?:(?:الوحدة|الفصل|الدرس|المبحث|الباب|المحور|المحاضرة|الجزء|عنصر)\s*(?:[\dIVX\u0660-\u0669\u0627-\u064A]+|:)|(?:أولاً|ثانياً|ثالثاً|رابعاً|خامساً|سادساً):|(?:Chapter|Unit|Lesson|Section|Module|Lecture|Part|Topic)\s*(?:[\dIVX]+|:)|#{1,3}\s+[^\n]+))/i;

  const parts = cleanedText.split(headingRegex).map((p) => p.trim()).filter(Boolean);

  if (parts.length <= 1) {
    // Fallback: If no headings detected, split by roughly 600 words if text is large, or return single section
    const words = cleanedText.split(/\s+/).filter(Boolean);
    if (words.length > 750) {
      const chunks: ExtractedSection[] = [];
      // Scale chunkSize dynamically so large textbooks (e.g. 10k-100k words) don't create thousands of section objects
      const chunkSize = Math.max(500, Math.ceil(words.length / 50));
      for (let i = 0; i < words.length; i += chunkSize) {
        const chunkWords = words.slice(i, i + chunkSize);
        const sectionNum = Math.floor(i / chunkSize) + 1;
        const content = chunkWords.join(" ");
        chunks.push({
          id: `sec-${sectionNum}`,
          title: `القسم ${sectionNum} (الكلمات ${i + 1} - ${Math.min(i + chunkSize, words.length)})`,
          content,
          wordCount: chunkWords.length,
        });
      }
      return chunks;
    }

    return [
      {
        id: "sec-1",
        title: "كامل النص الدراسي",
        content: cleanedText,
        wordCount: words.length,
      },
    ];
  }

  const sectionsList = parts.map((part, index) => {
    // Extract first line as title
    const firstLineEnd = part.indexOf("\n");
    let title = firstLineEnd !== -1 ? part.slice(0, firstLineEnd).trim() : part.slice(0, 50).trim();
    title = title.replace(/^[#*\-•]+\s*/, "").trim();
    if (title.length > 70) title = title.slice(0, 67) + "...";
    if (!title) title = `القسم ${index + 1}`;

    const words = part.split(/\s+/).filter(Boolean);
    return {
      id: `sec-${index + 1}`,
      title,
      content: part,
      wordCount: words.length,
    };
  });

  // If heading-based parts exceed 50, merge smaller adjacent sections to keep JSON lightweight
  if (parts.length > 50) {
    const targetSize = Math.ceil(parts.length / 40);
    const merged: ExtractedSection[] = [];
    for (let i = 0; i < parts.length; i += targetSize) {
      const slice = parts.slice(i, i + targetSize);
      const firstLineEnd = slice[0].indexOf("\n");
      let title = firstLineEnd !== -1 ? slice[0].slice(0, firstLineEnd).trim() : slice[0].slice(0, 50).trim();
      title = title.replace(/^[#*\-•]+\s*/, "").trim();
      if (title.length > 70) title = title.slice(0, 67) + "...";
      const combinedContent = slice.join("\n\n");
      const wordCount = combinedContent.split(/\s+/).filter(Boolean).length;
      merged.push({
        id: `sec-${merged.length + 1}`,
        title: title || `القسم ${merged.length + 1}`,
        content: combinedContent,
        wordCount,
      });
    }
    return merged;
  }

  return sectionsList;
}

/**
 * Extract suggested topics / keywords from text.
 */
export function extractSuggestedTopics(text: string): string[] {
  const topics: Set<string> = new Set();

  // Look for keywords following common prefixes
  const topicRegex = /(?:الوحدة|الفصل|الدرس|موضوع|Chapter|Unit|Topic):\s*([^\n\r,.-]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = topicRegex.exec(text)) !== null) {
    if (match[1] && match[1].trim().length > 2) {
      topics.add(match[1].trim().slice(0, 40));
    }
  }

  // Look for bold/bullet points at start of lines
  const bulletRegex = /^[•\-*]\s+([^\n\r:]{3,35}):/gm;
  while ((match = bulletRegex.exec(text)) !== null) {
    if (match[1] && match[1].trim().length > 2) {
      topics.add(match[1].trim());
    }
  }

  return Array.from(topics).slice(0, 8);
}
