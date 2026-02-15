const MAX_SELECTION_CHARS = 2400;
let selectionPopupListenerRegistered = false;
let latestSelectionTextByTabID = new Map<string, string>();

type SelectionPopupEvent = {
  reader?: {
    tabID?: string;
  };
  params?: {
    annotation?: {
      text?: string;
    };
  };
};

function normalizeSelection(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_SELECTION_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_SELECTION_CHARS)} ...[选中文段已截断]`;
}

function cacheSelection(tabID: string, text: string) {
  const normalized = normalizeSelection(text);
  if (!normalized) return;
  latestSelectionTextByTabID.set(tabID, normalized);
}

function extractSelectionFromReader(reader: any) {
  const candidateFns = [
    () => reader?.getSelectedText?.(),
    () => reader?._internalReader?.getSelectedText?.(),
    () => reader?._iframeWindow?.getSelection?.()?.toString?.(),
    () => reader?._window?.document?.getSelection?.()?.toString?.(),
    () => reader?._internalReader?._iframeWindow?.getSelection?.()?.toString?.(),
    () => reader?._internalReader?._window?.document?.getSelection?.()?.toString?.(),
  ];

  for (const fn of candidateFns) {
    try {
      const value = fn();
      if (typeof value === "string" && value.trim()) {
        const normalized = normalizeSelection(value);
        const tabID = String(reader?.tabID || "");
        if (tabID) {
          cacheSelection(tabID, normalized);
        }
        return normalized;
      }
    } catch {
      // Try next candidate.
    }
  }

  return "";
}

function onReaderSelectionPopup(event: SelectionPopupEvent) {
  const tabID = String(event?.reader?.tabID || "");
  const text = String(event?.params?.annotation?.text || "");
  if (!tabID || !text.trim()) return;
  cacheSelection(tabID, text);
}

export function initSelectionCapture() {
  if (selectionPopupListenerRegistered) return;
  if (!Zotero.Reader?.registerEventListener) return;
  Zotero.Reader.registerEventListener(
    "renderTextSelectionPopup",
    onReaderSelectionPopup as any,
  );
  selectionPopupListenerRegistered = true;
}

export function disposeSelectionCapture() {
  if (!selectionPopupListenerRegistered) return;
  try {
    Zotero.Reader.unregisterEventListener(
      "renderTextSelectionPopup",
      onReaderSelectionPopup as any,
    );
  } catch {
    // Ignore runtime differences.
  }
  selectionPopupListenerRegistered = false;
}

export function getActiveReaderSelectionText() {
  try {
    const tabs = ztoolkit.getGlobal("Zotero_Tabs");
    const selectedTabID = tabs?.selectedID;
    if (!selectedTabID) return "";

    const reader = Zotero.Reader.getByTabID(selectedTabID);
    const selectedText = extractSelectionFromReader(reader);
    if (selectedText) {
      return selectedText;
    }
    return latestSelectionTextByTabID.get(String(selectedTabID)) || "";
  } catch {
    return "";
  }
}

export function buildSelectionContextText(selectedText: string) {
  if (!selectedText.trim()) return "";
  return `以下是用户在 Reader 中当前选中的段落，请优先结合该段落回答：\n${selectedText}`;
}

export function getActiveReaderSelectionContext() {
  return buildSelectionContextText(getActiveReaderSelectionText());
}
