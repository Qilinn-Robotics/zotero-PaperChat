export interface PDFContextOption {
  id: number;
  label: string;
  metadataText: string;
  fullText?: string;
  fullContextText?: string;
}

export type PdfContextMode = "balanced" | "full";

export interface PDFContextBuildResult {
  text: string;
  sourceLength: number;
  truncated: boolean;
}

const MAX_EXCERPT_CHARS = 12000;
const FULLTEXT_RETRY_DELAYS_MS = [400, 1200, 2500];
const FULLTEXT_CACHE_CANDIDATES = [
  ".zotero-ft-cache",
  ".zotero-ft-unprocessed",
  ".zotero-ft-cache.json",
];

function debugPdfContext(message: string) {
  Zotero.debug(`PaperChat PDF: ${message}`);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSearchText(text: string) {
  return text.toLowerCase();
}

function extractQueryTerms(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const terms = new Set<string>();
  for (const match of normalized.matchAll(/[\p{L}\p{N}][\p{L}\p{N} ._()/-]{1,30}/gu)) {
    const term = match[0].trim();
    if (term.length >= 2) {
      terms.add(term);
    }
  }

  const formulaMatch = normalized.match(/(?:公式|equation|eq\.?|formula)\s*\(?\s*(\d+)\s*\)?/i);
  if (formulaMatch) {
    const n = formulaMatch[1];
    [
      `公式${n}`,
      `公式 ${n}`,
      `equation ${n}`,
      `equation (${n})`,
      `eq ${n}`,
      `eq. ${n}`,
      `eq(${n})`,
      `formula ${n}`,
      `(${n})`,
    ].forEach((term) => terms.add(term));
  }

  return [...terms].sort((a, b) => b.length - a.length);
}

function takeWindow(text: string, start: number, end: number) {
  const safeStart = Math.max(0, start);
  const safeEnd = Math.min(text.length, end);
  return text.slice(safeStart, safeEnd).trim();
}

function buildFallbackExcerpt(text: string) {
  if (text.length <= MAX_EXCERPT_CHARS) {
    return text;
  }

  const segmentSize = Math.min(3200, Math.floor(MAX_EXCERPT_CHARS / 3));
  const segments = [
    takeWindow(text, 0, segmentSize),
    takeWindow(
      text,
      Math.max(0, Math.floor(text.length / 2) - Math.floor(segmentSize / 2)),
      Math.max(0, Math.floor(text.length / 2) + Math.floor(segmentSize / 2)),
    ),
    takeWindow(text, Math.max(0, text.length - segmentSize), text.length),
  ].filter(Boolean);

  return segments.join("\n\n...[中间内容省略]...\n\n");
}

function buildRelevantExcerpt(text: string, query: string) {
  const terms = extractQueryTerms(query);
  if (terms.length === 0) {
    return buildFallbackExcerpt(text);
  }

  const normalizedText = normalizeSearchText(text);
  const windows: Array<{ start: number; end: number; term: string; index: number }> = [];
  const SNIPPET_RADIUS = 450;

  for (const term of terms.slice(0, 8)) {
    const index = normalizedText.indexOf(normalizeSearchText(term));
    if (index === -1) continue;
    windows.push({
      start: Math.max(0, index - SNIPPET_RADIUS),
      end: Math.min(text.length, index + term.length + SNIPPET_RADIUS),
      term,
      index,
    });
    if (windows.length >= 3) break;
  }

  if (windows.length === 0) {
    return buildFallbackExcerpt(text);
  }

  windows.sort((a, b) => a.index - b.index);
  const merged: Array<{ start: number; end: number; terms: string[] }> = [];
  for (const window of windows) {
    const last = merged[merged.length - 1];
    if (last && window.start <= last.end + 120) {
      last.end = Math.max(last.end, window.end);
      last.terms.push(window.term);
      continue;
    }
    merged.push({
      start: window.start,
      end: window.end,
      terms: [window.term],
    });
  }

  const sections = merged.map((window, idx) => {
    const snippet = takeWindow(text, window.start, window.end);
    const label = `片段${idx + 1}（匹配: ${[...new Set(window.terms)].join(", ")}）`;
    return `${label}\n${snippet}`;
  });

  const joined = sections.join("\n\n...[相关片段切换]...\n\n");
  return joined.length <= MAX_EXCERPT_CHARS
    ? joined
    : `${joined.slice(0, MAX_EXCERPT_CHARS).trimEnd()}\n...[内容已截断]`;
}

function buildFullPdfExcerpt(text: string, maxChars: number) {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, maxChars).trimEnd()}\n...[全文过长，已截断]`,
    truncated: true,
  };
}

function stripReferenceSection(text: string) {
  if (!text) {
    return { text, removed: false };
  }

  const patterns = [
    { pattern: /\backnowledg(?:e)?ments?\b/gi, kind: "tail-section" },
    { pattern: /\bappendix references?\b/gi, kind: "tail-section" },
    { pattern: /\bappendix bibliography\b/gi, kind: "tail-section" },
    { pattern: /\breferences?\b/gi, kind: "reference-section" },
    { pattern: /\bbibliography\b/gi, kind: "reference-section" },
    { pattern: /\bworks cited\b/gi, kind: "reference-section" },
    { pattern: /\bliterature cited\b/gi, kind: "reference-section" },
    { pattern: /\breferences? and notes\b/gi, kind: "reference-section" },
    { pattern: /致谢/gu, kind: "tail-section" },
    { pattern: /参考文献/gu, kind: "reference-section" },
    { pattern: /附录参考文献/gu, kind: "tail-section" },
  ];

  const minStart = Math.floor(text.length * 0.55);
  let candidateIndex = -1;
  let candidateKind = "";

  for (const { pattern, kind } of patterns) {
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? -1;
      if (index < minStart) {
        continue;
      }
      if (candidateIndex === -1 || index < candidateIndex) {
        candidateIndex = index;
        candidateKind = kind;
      }
    }
  }

  if (candidateIndex === -1) {
    return { text, removed: false };
  }

  const tail = text.slice(candidateIndex).trim();
  if (tail.length < 1200) {
    return { text, removed: false };
  }

  const yearMatches = tail.match(/\b(?:19|20)\d{2}[a-z]?\b/g) || [];
  const bracketCitationMatches = tail.match(/\[\d{1,3}\]/g) || [];
  const numberedCitationMatches =
    tail.match(/(?:^|\s)\d{1,3}\.\s+[A-Z\u00c0-\u024f]/g) || [];
  const tailHeadingMatches =
    tail.match(
      /\b(?:acknowledg(?:e)?ments?|appendix references?|appendix bibliography|references?|bibliography|works cited|literature cited)\b/gi,
    ) || [];

  const looksLikeReferenceTail =
    yearMatches.length >= 8 ||
    bracketCitationMatches.length >= 8 ||
    numberedCitationMatches.length >= 8;
  const looksLikeTailSection =
    tailHeadingMatches.length >= 2 || tail.length >= 3000;

  if (candidateKind === "reference-section" && !looksLikeReferenceTail) {
    return { text, removed: false };
  }

  if (candidateKind === "tail-section" && !looksLikeReferenceTail && !looksLikeTailSection) {
    return { text, removed: false };
  }

  return {
    text: text.slice(0, candidateIndex).trimEnd(),
    removed: true,
  };
}

function isPdfAttachment(item: any) {
  if (!item) return false;
  const contentType = item.attachmentContentType || item.attachmentMIMEType;
  return item.isAttachment?.() && contentType === "application/pdf";
}

function buildMetadataText(attachment: any): string {
  const fileName = attachment.attachmentFilename || "Unknown PDF";
  const parent = attachment.parentItemID
    ? (Zotero.Items.get(attachment.parentItemID) as any)
    : null;

  const title = parent?.getField?.("title") || fileName;
  const abstractNote = parent?.getField?.("abstractNote") || "";
  const date = parent?.getField?.("date") || "";
  const creators = parent?.getCreators?.() || [];
  const authorText = creators
    .slice(0, 4)
    .map((creator: any) => creator?.lastName || creator?.name || "")
    .filter(Boolean)
    .join(", ");

  const clippedAbstract = abstractNote ? abstractNote.slice(0, 1500) : "";

  return [
    `当前文献: ${title}`,
    date ? `日期: ${date}` : "",
    authorText ? `作者: ${authorText}` : "",
    `文件名: ${fileName}`,
    clippedAbstract ? `摘要: ${clippedAbstract}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildLabel(attachment: any): string {
  const parent = attachment.parentItemID
    ? (Zotero.Items.get(attachment.parentItemID) as any)
    : null;
  const title = parent?.getField?.("title") || attachment.attachmentFilename;
  return String(title || `PDF ${attachment.id}`);
}

function getCurrentLibraryID(currentItem?: any) {
  if (currentItem?.libraryID) {
    return currentItem.libraryID;
  }

  const selectedItems = Zotero.getActiveZoteroPane()?.getSelectedItems?.() || [];
  if (selectedItems.length > 0 && selectedItems[0].libraryID) {
    return selectedItems[0].libraryID;
  }

  return Zotero.Libraries.userLibraryID;
}

function getCurrentPdfAttachmentId(currentItem?: any) {
  if (currentItem && isPdfAttachment(currentItem)) {
    return currentItem.id as number;
  }
  return null;
}

async function resolveCurrentPdfAttachmentId(currentItem?: any) {
  const direct = getCurrentPdfAttachmentId(currentItem);
  if (direct) {
    return direct;
  }

  try {
    if (currentItem?.isRegularItem?.()) {
      const bestAttachment = await currentItem.getBestAttachment();
      if (bestAttachment && isPdfAttachment(bestAttachment)) {
        return bestAttachment.id as number;
      }
    }
  } catch {
    // Ignore and fallback.
  }

  try {
    const tabs = ztoolkit.getGlobal("Zotero_Tabs");
    const selectedTabID = tabs?.selectedID;
    if (selectedTabID) {
      const reader = Zotero.Reader.getByTabID(selectedTabID);
      const readerItem = (reader as any)?._item;
      if (readerItem && isPdfAttachment(readerItem)) {
        return readerItem.id as number;
      }
    }
  } catch {
    // Ignore and fallback.
  }

  return null;
}

export async function loadLibraryPdfOptions(
  currentItem?: any,
): Promise<PDFContextOption[]> {
  const libraryID = getCurrentLibraryID(currentItem);
  const currentPdfId = await resolveCurrentPdfAttachmentId(currentItem);

  const search = new Zotero.Search();
  search.addCondition("libraryID", "is", String(libraryID));
  search.addCondition("itemType", "is", "attachment");
  search.addCondition("deleted", "false");

  const ids = await search.search();
  const items = Zotero.Items.get(ids) as any[];

  const options = items
    .filter(isPdfAttachment)
    .map((attachment: any) => ({
      id: attachment.id,
      label: buildLabel(attachment),
      metadataText: buildMetadataText(attachment),
    }));

  options.sort((a, b) => {
    if (currentPdfId && a.id === currentPdfId) return -1;
    if (currentPdfId && b.id === currentPdfId) return 1;
    return a.label.localeCompare(b.label, "zh-Hans-CN");
  });

  return options;
}

export function getDefaultPdfOptionId(
  options: PDFContextOption[],
  currentItem?: any,
) {
  if (currentItem && isPdfAttachment(currentItem)) {
    const matched = options.find((option) => option.id === currentItem.id);
    if (matched) {
      return matched.id;
    }
  }

  return options.length > 0 ? options[0].id : null;
}

async function readFromFulltextAPI(attachmentID: number) {
  const fulltext = (Zotero as any).Fulltext || (Zotero as any).FullText;
  if (!fulltext) {
    debugPdfContext(`attachment ${attachmentID}: Zotero.Fulltext API unavailable`);
    return "";
  }

  const candidateMethods = [
    "getItemText",
    "getText",
    "getCachedText",
    "getUnsyncedContent",
  ];

  debugPdfContext(
    `attachment ${attachmentID}: probing Fulltext methods ${candidateMethods
      .filter((name) => typeof fulltext?.[name] === "function")
      .join(", ") || "(none)"}`,
  );

  for (const methodName of candidateMethods) {
    const method = fulltext?.[methodName];
    if (typeof method !== "function") continue;

    try {
      const result = await method.call(fulltext, attachmentID);
      if (typeof result === "string" && result.trim()) {
        debugPdfContext(
          `attachment ${attachmentID}: Fulltext.${methodName} returned ${result.length} chars`,
        );
        return result;
      }
      if (result?.content && typeof result.content === "string") {
        debugPdfContext(
          `attachment ${attachmentID}: Fulltext.${methodName}.content returned ${result.content.length} chars`,
        );
        return result.content;
      }
      if (result?.text && typeof result.text === "string") {
        debugPdfContext(
          `attachment ${attachmentID}: Fulltext.${methodName}.text returned ${result.text.length} chars`,
        );
        return result.text;
      }
      debugPdfContext(
        `attachment ${attachmentID}: Fulltext.${methodName} returned empty result`,
      );
    } catch {
      debugPdfContext(`attachment ${attachmentID}: Fulltext.${methodName} threw`);
    }
  }

  return "";
}

function getDirPath(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index === -1) return "";
  return normalized.slice(0, index);
}

async function readFromCacheFile(attachment: any) {
  const fulltext = (Zotero as any).Fulltext || (Zotero as any).FullText;
  const zoteroFile = (Zotero as any).File;

  const helperCandidates = [
    { name: "getItemCacheFile", helper: fulltext?.getItemCacheFile },
    {
      name: "getItemProcessorCacheFile",
      helper: fulltext?.getItemProcessorCacheFile,
    },
  ];

  if (zoteroFile?.getContentsAsync) {
    for (const { name, helper } of helperCandidates) {
      if (typeof helper !== "function") continue;
      try {
        const file = await helper.call(fulltext, attachment);
        const path = file?.path;
        if (!path) {
          debugPdfContext(
            `attachment ${attachment?.id || "unknown"}: ${name} returned no path`,
          );
          continue;
        }
        const text = await zoteroFile.getContentsAsync(path);
        if (typeof text === "string" && text.trim()) {
          debugPdfContext(
            `attachment ${attachment?.id || "unknown"}: read ${text.length} chars via ${name}`,
          );
          return text;
        }
        debugPdfContext(
          `attachment ${attachment?.id || "unknown"}: ${name} file is empty`,
        );
      } catch (error) {
        debugPdfContext(
          `attachment ${attachment?.id || "unknown"}: ${name} failed: ${String(error)}`,
        );
      }
    }
  }

  const filePath = await attachment?.getFilePathAsync?.();
  if (!filePath) {
    debugPdfContext(`attachment ${attachment?.id || "unknown"}: missing file path`);
    return "";
  }

  const dirPath = getDirPath(String(filePath));
  if (!dirPath) {
    debugPdfContext(`attachment ${attachment?.id || "unknown"}: invalid parent dir`);
    return "";
  }

  const ioUtils = (globalThis as any).IOUtils;
  if (!ioUtils?.exists || !ioUtils?.readUTF8) {
    debugPdfContext(`attachment ${attachment?.id || "unknown"}: IOUtils unavailable`);
    return "";
  }

  for (const cacheFile of FULLTEXT_CACHE_CANDIDATES) {
    const cachePath = `${dirPath}/${cacheFile}`;
    try {
      const exists = await ioUtils.exists(cachePath);
      if (!exists) continue;
      const text = await ioUtils.readUTF8(cachePath);
      if (typeof text === "string" && text.trim()) {
        debugPdfContext(
          `attachment ${attachment?.id || "unknown"}: read ${text.length} chars from ${cacheFile}`,
        );
        return text;
      }
      debugPdfContext(
        `attachment ${attachment?.id || "unknown"}: ${cacheFile} exists but is empty`,
      );
    } catch (error) {
      debugPdfContext(
        `attachment ${attachment?.id || "unknown"}: failed to read ${cacheFile}: ${String(error)}`,
      );
    }
  }

  debugPdfContext(`attachment ${attachment?.id || "unknown"}: no fulltext cache file found`);
  return "";
}

function normalizeExcerptText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function truncateExcerpt(text: string) {
  if (text.length <= MAX_EXCERPT_CHARS) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, MAX_EXCERPT_CHARS)}\n...[内容已截断]`,
    truncated: true,
  };
}

async function getPdfTextExcerpt(attachmentID: number) {
  const attachment = Zotero.Items.get(attachmentID) as any;
  if (!attachment) {
    debugPdfContext(`attachment ${attachmentID}: item not found`);
    return "";
  }

  for (let attempt = 0; attempt <= FULLTEXT_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      const delayMs = FULLTEXT_RETRY_DELAYS_MS[attempt - 1];
      debugPdfContext(
        `attachment ${attachmentID}: retrying fulltext read after ${delayMs}ms`,
      );
      await delay(delayMs);
    }

    const fromApi = await readFromFulltextAPI(attachmentID);
    if (fromApi.trim()) {
      debugPdfContext(`attachment ${attachmentID}: using Fulltext API result`);
      return normalizeExcerptText(fromApi);
    }

    const fromCache = await readFromCacheFile(attachment);
    if (fromCache.trim()) {
      debugPdfContext(`attachment ${attachmentID}: using cache file result`);
      return normalizeExcerptText(fromCache);
    }
  }

  debugPdfContext(`attachment ${attachmentID}: no indexed PDF text available`);
  return "";
}

async function getCachedFullText(option: PDFContextOption) {
  if (option.fullText) {
    return option.fullText;
  }

  const excerpt = await getPdfTextExcerpt(option.id);
  option.fullText = excerpt;
  return excerpt;
}

export async function getOptionContextText(option: PDFContextOption, query = "") {
  return getOptionContext(option, query, "balanced", MAX_EXCERPT_CHARS);
}

export async function getOptionContext(
  option: PDFContextOption,
  query: string,
  mode: PdfContextMode,
  maxChars: number,
): Promise<PDFContextBuildResult> {
  const fullText = await getCachedFullText(option);
  if (!fullText) {
    return {
      text: `${option.metadataText}\n\n未读取到该 PDF 的全文索引内容（可能尚未被 Zotero 完成索引）。`,
      sourceLength: 0,
      truncated: false,
    };
  }

  if (mode === "full") {
    const cleanedFullText = stripReferenceSection(fullText);
    const fullResult = buildFullPdfExcerpt(cleanedFullText.text, maxChars);
    const fullHeader = cleanedFullText.removed
      ? "以下是该 PDF 的全文文本（已自动排除参考文献部分）"
      : "以下是该 PDF 的全文文本";
    return {
      text: `${option.metadataText}\n\n${fullHeader}${fullResult.truncated ? "（已截断）" : ""}:\n${fullResult.text}`,
      sourceLength: cleanedFullText.text.length,
      truncated: fullResult.truncated,
    };
  }

  const excerpt = query ? buildRelevantExcerpt(fullText, query) : buildFallbackExcerpt(fullText);
  const excerptResult = truncateExcerpt(excerpt);
  const excerptHeader = query
    ? "以下是该 PDF 中与当前问题最相关的正文片段（已按提问检索并截断）:"
    : excerptResult.truncated
      ? "以下是该 PDF 的正文摘录（已截断以控制请求体大小）:"
      : "以下是该 PDF 的正文摘录（可能为部分内容）:";
  return {
    text: `${option.metadataText}\n\n${excerptHeader}\n${excerptResult.text}`,
    sourceLength: fullText.length,
    truncated: excerptResult.truncated,
  };
}
