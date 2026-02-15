export interface PDFContextOption {
  id: number;
  label: string;
  metadataText: string;
  fullContextText?: string;
}

const MAX_EXCERPT_CHARS = 12000;

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
  if (!fulltext) return "";

  const candidateMethods = [
    "getItemText",
    "getText",
    "getCachedText",
    "getUnsyncedContent",
  ];

  for (const methodName of candidateMethods) {
    const method = fulltext?.[methodName];
    if (typeof method !== "function") continue;

    try {
      const result = await method.call(fulltext, attachmentID);
      if (typeof result === "string" && result.trim()) {
        return result;
      }
      if (result?.content && typeof result.content === "string") {
        return result.content;
      }
      if (result?.text && typeof result.text === "string") {
        return result.text;
      }
    } catch {
      // Try the next method.
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
  const filePath = await attachment?.getFilePathAsync?.();
  if (!filePath) return "";

  const dirPath = getDirPath(String(filePath));
  if (!dirPath) return "";

  const cachePath = `${dirPath}/.zotero-ft-cache`;
  const ioUtils = (globalThis as any).IOUtils;
  if (!ioUtils?.exists || !ioUtils?.readUTF8) return "";

  try {
    const exists = await ioUtils.exists(cachePath);
    if (!exists) return "";
    const text = await ioUtils.readUTF8(cachePath);
    return typeof text === "string" ? text : "";
  } catch {
    return "";
  }
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
  if (!attachment) return "";

  const fromApi = await readFromFulltextAPI(attachmentID);
  if (fromApi.trim()) {
    return normalizeExcerptText(fromApi);
  }

  const fromCache = await readFromCacheFile(attachment);
  if (fromCache.trim()) {
    return normalizeExcerptText(fromCache);
  }

  return "";
}

export async function getOptionContextText(option: PDFContextOption) {
  if (option.fullContextText) {
    return option.fullContextText;
  }

  const excerpt = await getPdfTextExcerpt(option.id);
  const excerptResult = excerpt ? truncateExcerpt(excerpt) : null;
  const excerptHeader = excerptResult?.truncated
    ? "以下是该 PDF 的正文摘录（已截断以控制请求体大小）:"
    : "以下是该 PDF 的正文摘录（可能为部分内容）:";
  const fullContextText = excerpt
    ? `${option.metadataText}\n\n${excerptHeader}\n${excerptResult?.text || ""}`
    : `${option.metadataText}\n\n未读取到该 PDF 的全文索引内容（可能尚未被 Zotero 完成索引）。`;

  option.fullContextText = fullContextText;
  return fullContextText;
}
