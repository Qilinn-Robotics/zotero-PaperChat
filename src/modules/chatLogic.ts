import {
  addAssistantMessageWithTypewriter,
  autoResizeInput,
  appendAssistantStreamChunk,
  ChatUIElements,
  addMessageToDisplay,
  clearMessages,
  ContextBadge,
  createAssistantStreamMessage,
  finalizeAssistantStreamMessage,
  renderContextBadges,
  renderConversationOptions,
  renderPdfOptions,
  setConnectionStatus,
  showErrorMessage,
  showThinkingIndicator,
  updateInputState,
} from "./chatUI";
import {
  ChatMessage,
  LLMRequestError,
  getCompletion,
} from "./llmService";
import { getActiveAIConfig } from "../utils/prefs";
import {
  PDFContextBuildResult,
  PDFContextOption,
  PdfContextMode,
  getDefaultPdfOptionId,
  getOptionContext,
  loadLibraryPdfOptions,
} from "./pdfContext";
import {
  buildSelectionContextText,
  disposeSelectionCapture,
  getActiveReaderSelectionText,
  initSelectionCapture,
} from "./readerSelection";
import {
  ChatConversation,
  applyTurn,
  createConversation,
  loadConversations,
  persistConversations,
} from "./conversationStore";
import { estimateMessagesInputTokens } from "./tokenEstimate";

let currentUI: ChatUIElements | null = null;
let isSending = false;
let pdfOptions: PDFContextOption[] = [];
let focusedPdfId: number | null = null;
let selectedPdfIds: number[] = [];
let contextEnabled = false;
let selectionContextEnabled = false;
let contextMode: PdfContextMode = "balanced";
let conversations: ChatConversation[] = [];
let activeConversationId: string | null = null;
let latestSelectionText = "";
let selectionWatcherTimer: ReturnType<typeof setInterval> | null = null;
let statusResetTimer: ReturnType<typeof setTimeout> | null = null;
let estimatePreviewTimer: ReturnType<typeof setTimeout> | null = null;
let estimatePreviewSeq = 0;
let latestEstimatedTokens: number | null = null;
let baseStatusText = "Ready";

const MAX_CONTEXT_MESSAGES = 12;
const MAX_SELECTED_PDFS = 5;
const MAX_VISIBLE_PDF_BADGES = 3;
const MAX_PDF_CONTEXT_CHARS_TOTAL = 24000;
const MAX_PDF_CONTEXT_CHARS_EACH = 8000;
const MAX_FULL_PDF_CONTEXT_CHARS_SINGLE = 120000;
const MIN_PDF_CONTEXT_BODY_CHARS = 200;
const TOKEN_WARNING_MEDIUM = 8000;
const TOKEN_WARNING_HIGH = 16000;
const TOKEN_WARNING_VERY_HIGH = 32000;
const TOKEN_LIMIT = 48000;

export async function initChat(ui: ChatUIElements, currentItem?: any) {
  currentUI = ui;
  isSending = false;
  pdfOptions = [];
  focusedPdfId = null;
  selectedPdfIds = [];
  contextEnabled = false;
  selectionContextEnabled = false;
  contextMode = "balanced";
  initializeConversationState();
  restoreContextPdfSelectionFromConversation();

  bindUIEvents();
  initSelectionCapture();
  ui.contextToggle.checked = false;
  ui.selectionToggle.checked = false;
  autoResizeInput(ui.chatInput);
  startSelectionWatcher();

  renderConversationSelector();
  renderActiveConversationMessages();
  refreshContextPreview();

  const config = getActiveAIConfig();
  if (!config.apiKey || !config.apiEndpoint) {
    setBaseStatus("Config Missing");
    showErrorMessage(
      ui.chatContainer,
      "请到 Zotero 设置页配置 API Key 和 Endpoint。\n配置后返回这里即可使用。",
    );
  } else {
    setBaseStatus("Configured");
  }

  await loadPdfContext(currentItem);
}

export function dispose() {
  if (currentUI) {
    currentUI.sendButton.onclick = null;
    currentUI.chatInput.oninput = null;
    currentUI.chatInput.onkeydown = null;
    currentUI.clearButton.onclick = null;
    currentUI.newConversationButton.onclick = null;
    currentUI.renameConversationButton.onclick = null;
    currentUI.deleteConversationButton.onclick = null;
    currentUI.conversationSelect.onchange = null;
    currentUI.searchInput.oninput = null;
    currentUI.contextToggle.onchange = null;
    currentUI.selectionToggle.onchange = null;
    currentUI.contextModeSelect.onchange = null;
    currentUI.pdfSelect.onchange = null;
    currentUI.addPdfButton.onclick = null;
    currentUI.removePdfButton.onclick = null;
  }
  stopSelectionWatcher();
  stopStatusResetTimer();
  stopEstimatePreviewTimer();
  disposeSelectionCapture();

  currentUI = null;
  isSending = false;
  pdfOptions = [];
  focusedPdfId = null;
  selectedPdfIds = [];
  contextEnabled = false;
  selectionContextEnabled = false;
  contextMode = "balanced";
  latestSelectionText = "";
  conversations = [];
  activeConversationId = null;
}

function bindUIEvents() {
  if (!currentUI) return;
  const ui = currentUI;

  ui.sendButton.onclick = sendCurrentInput;
  ui.chatInput.oninput = () => {
    autoResizeInput(ui.chatInput);
    scheduleEstimatePreview();
  };
  ui.chatInput.onkeydown = (event: Event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key === "Enter" && !keyboardEvent.shiftKey) {
      event.preventDefault();
      sendCurrentInput();
    }
  };

  ui.clearButton.onclick = () => {
    const currentConversation = getActiveConversation();
    if (!currentConversation) return;
    currentConversation.messages = [];
    currentConversation.updatedAt = Date.now();
    persistConversationState();
    renderActiveConversationMessages();
    addMessageToDisplay(ui.chatContainer, "assistant", "当前对话已清空。可以继续提问。");
  };

  ui.newConversationButton.onclick = () => {
    const created = createConversation();
    conversations.unshift(created);
    activeConversationId = created.id;
    restoreContextPdfSelectionFromConversation();
    persistConversationState();
    renderConversationSelector();
    renderActiveConversationMessages();
    refreshContextPreview();
    ui.chatInput.focus();
    scheduleEstimatePreview();
  };

  ui.renameConversationButton.onclick = () => {
    const currentConversation = getActiveConversation();
    if (!currentConversation || !currentUI) return;

    const win = currentUI.root.ownerDocument?.defaultView;
    if (!win?.prompt) return;

    const nextTitle = win.prompt("请输入新的对话名称", currentConversation.title);
    if (nextTitle === null) return;
    const normalizedTitle = nextTitle.trim();
    if (!normalizedTitle) {
      addMessageToDisplay(ui.chatContainer, "error", "对话名称不能为空。");
      return;
    }

    currentConversation.title = normalizedTitle.slice(0, 40);
    currentConversation.updatedAt = Date.now();
    persistConversationState();
    renderConversationSelector();
    scheduleEstimatePreview();
  };

  ui.deleteConversationButton.onclick = () => {
    const currentConversation = getActiveConversation();
    if (!currentConversation) return;
    conversations = conversations.filter((item) => item.id !== currentConversation.id);
    if (conversations.length === 0) {
      const created = createConversation();
      conversations = [created];
      activeConversationId = created.id;
    } else if (!conversations.some((item) => item.id === activeConversationId)) {
      activeConversationId = conversations[0].id;
    }
    restoreContextPdfSelectionFromConversation();
    persistConversationState();
    renderConversationSelector();
    renderActiveConversationMessages();
    refreshContextPreview();
    scheduleEstimatePreview();
  };

  ui.conversationSelect.onchange = () => {
    const id = ui.conversationSelect.value;
    if (!id) return;
    activeConversationId = id;
    persistConversationState();
    restoreContextPdfSelectionFromConversation();
    renderConversationSelector();
    renderActiveConversationMessages();
    refreshContextPreview();
    scheduleEstimatePreview();
  };

  ui.contextToggle.onchange = () => {
    contextEnabled = ui.contextToggle.checked;
    refreshContextPreview();
    scheduleEstimatePreview();
  };
  ui.selectionToggle.onchange = () => {
    selectionContextEnabled = ui.selectionToggle.checked;
    if (selectionContextEnabled) {
      latestSelectionText = getActiveReaderSelectionText();
    }
    refreshContextPreview();
    scheduleEstimatePreview();
  };
  ui.contextModeSelect.onchange = () => {
    contextMode = ui.contextModeSelect.value === "full" ? "full" : "balanced";
    persistActiveConversationContextMode();
    refreshContextPreview();
    scheduleEstimatePreview();
  };

  ui.searchInput.oninput = () => {
    renderPdfList(ui.searchInput.value.trim());
  };

  ui.pdfSelect.onchange = () => {
    const value = Number(ui.pdfSelect.value || 0);
    focusedPdfId = Number.isFinite(value) && value > 0 ? value : null;
    refreshContextPreview();
    scheduleEstimatePreview();
  };

  ui.addPdfButton.onclick = () => {
    if (!focusedPdfId) return;
    addPdfToContext(focusedPdfId);
  };

  ui.removePdfButton.onclick = () => {
    if (!focusedPdfId) return;
    removePdfFromContext(focusedPdfId);
    refreshContextPreview();
  };
}

function stopStatusResetTimer() {
  if (statusResetTimer) {
    clearTimeout(statusResetTimer);
    statusResetTimer = null;
  }
}

function stopEstimatePreviewTimer() {
  if (estimatePreviewTimer) {
    clearTimeout(estimatePreviewTimer);
    estimatePreviewTimer = null;
  }
}

function renderStatusIndicator() {
  if (!currentUI) return;
  const showEstimate =
    !isSending &&
    latestEstimatedTokens !== null &&
    !["Config Missing", "Error", "Requesting", "Streaming"].includes(baseStatusText);
  const estimateSuffix = showEstimate
    ? ` · ${formatEstimatedTokenStatus(latestEstimatedTokens || 0)}`
    : "";
  const text = showEstimate
    ? `${baseStatusText}${estimateSuffix}`
    : baseStatusText;
  setConnectionStatus(currentUI.statusIndicator, text);
}

function formatEstimatedTokenStatus(estimate: number) {
  if (estimate >= TOKEN_LIMIT) {
    return `Est ${estimate} tok [over limit]`;
  }
  if (estimate >= TOKEN_WARNING_VERY_HIGH) {
    return `Est ${estimate} tok [very high]`;
  }
  if (estimate >= TOKEN_WARNING_HIGH) {
    return `Est ${estimate} tok [high]`;
  }
  if (estimate >= TOKEN_WARNING_MEDIUM) {
    return `Est ${estimate} tok [medium]`;
  }
  return `Est ${estimate} tok`;
}

function setBaseStatus(statusText: string) {
  baseStatusText = statusText;
  renderStatusIndicator();
}

function setTransientStatus(statusText: string, resetTo = "Configured", delayMs = 3000) {
  if (!currentUI) return;
  stopStatusResetTimer();
  setConnectionStatus(currentUI.statusIndicator, statusText);
  statusResetTimer = setTimeout(() => {
    if (!currentUI) return;
    baseStatusText = resetTo;
    renderStatusIndicator();
    statusResetTimer = null;
  }, delayMs);
}

function logEstimatedInputTokens(
  messages: ChatMessage[],
  mode: PdfContextMode,
  selectedPdfCount: number,
) {
  const estimate = estimateMessagesInputTokens(messages);
  Zotero.debug(
    `PaperChat: estimated input tokens ${estimate} (mode=${mode}, pdfs=${selectedPdfCount}, messages=${messages.length})`,
  );
  setTransientStatus(`Est. ${estimate} tok`, "Requesting", 2500);
}

async function buildDraftRequest(message: string) {
  const config = getActiveAIConfig();
  let pdfContext = "";
  const selectedPdfOptions = getSelectedPdfOptionsInPriorityOrder();

  if (contextEnabled && selectedPdfOptions.length > 0) {
    const selectedIdsForPrompt = selectedPdfOptions.map((option) => option.id);
    const multiContext = await buildMultiPdfContext(
      selectedIdsForPrompt,
      pdfOptions,
      message,
      contextMode,
    );
    pdfContext = multiContext.text;
  }

  const selectedContext = selectionContextEnabled
    ? buildSelectionContextText(latestSelectionText || getActiveReaderSelectionText())
    : "";

  const currentConversation = getActiveConversation();
  const historyMessages = currentConversation
    ? currentConversation.messages.slice(-MAX_CONTEXT_MESSAGES)
    : [];

  const contextSections: string[] = [];
  if (pdfContext) {
    contextSections.push(
      [
        "以下是当前选择的多篇文献信息，请优先结合这些内容回答。",
        "你已经获得了这些 PDF 的题录信息与正文摘录。",
        "不要声称自己无法访问本地 PDF 或无法看到原文；如果信息不足，只能说明当前提供的摘录不足。",
        pdfContext,
      ].join("\n"),
    );
  } else {
    contextSections.push("当前未启用文献上下文，按通用学术助手方式回答。");
  }
  if (selectedContext) {
    contextSections.push(selectedContext);
  }

  const requestMessages: ChatMessage[] = [
    {
      role: "system",
      content: `${config.systemPrompt || "You are a helpful assistant."}\n\n${contextSections.join("\n\n")}`,
    },
    ...historyMessages,
    { role: "user", content: message },
  ];

  return {
    requestMessages,
    selectedPdfCount: selectedPdfOptions.length,
  };
}

function scheduleEstimatePreview() {
  if (!currentUI || isSending) return;
  stopEstimatePreviewTimer();
  estimatePreviewTimer = setTimeout(() => {
    void refreshEstimatePreview();
  }, 250);
}

async function refreshEstimatePreview() {
  if (!currentUI || isSending) return;
  const draft = currentUI.chatInput.value.trim();
  if (!draft) {
    latestEstimatedTokens = null;
    renderStatusIndicator();
    return;
  }

  const seq = ++estimatePreviewSeq;
  try {
    const { requestMessages } = await buildDraftRequest(draft);
    if (seq !== estimatePreviewSeq || isSending) return;
    latestEstimatedTokens = estimateMessagesInputTokens(requestMessages);
    renderStatusIndicator();
  } catch {
    if (seq !== estimatePreviewSeq || isSending) return;
    latestEstimatedTokens = null;
    renderStatusIndicator();
  }
}

async function loadPdfContext(currentItem?: any) {
  if (!currentUI) return;
  const ui = currentUI;

  try {
    pdfOptions = await loadLibraryPdfOptions(currentItem);
    focusedPdfId = getDefaultPdfOptionId(pdfOptions, currentItem);
    reconcileSelectedPdfsWithOptions();
    renderPdfList("");

    if (focusedPdfId) {
      setBaseStatus("PDF Linked");
    }
    refreshContextPreview();
    scheduleEstimatePreview();
  } catch {
    showErrorMessage(ui.chatContainer, "读取当前库 PDF 列表失败。请重试。");
  }
}

async function sendCurrentInput() {
  if (!currentUI || isSending) return;
  const ui = currentUI;

  const message = ui.chatInput.value.trim();
  if (!message) return;

  const config = getActiveAIConfig();
  if (!config.apiKey || !config.apiEndpoint) {
    setBaseStatus("Config Missing");
    showErrorMessage(ui.chatContainer, "缺少配置，请先在设置页填写 API 信息。");
    return;
  }

  isSending = true;
  updateInputState(ui.chatInput, ui.sendButton, true);
  showThinkingIndicator(ui.thinkingIndicator, true);
  setBaseStatus("Requesting");

  ui.chatInput.value = "";
  autoResizeInput(ui.chatInput);
  addMessageToDisplay(ui.chatContainer, "user", message);

  if (selectionContextEnabled && !latestSelectionText) {
    latestSelectionText = getActiveReaderSelectionText();
  }

  const selectedPdfOptions = getSelectedPdfOptionsInPriorityOrder();
  const currentConversation = getActiveConversation();
  const { requestMessages } = await buildDraftRequest(message);
  logEstimatedInputTokens(requestMessages, contextMode, selectedPdfOptions.length);

  try {
    let streamHandle: ReturnType<typeof createAssistantStreamMessage> = null;
    const completion = await getCompletion(requestMessages, {
      onToken: (token) => {
        if (!streamHandle) {
          streamHandle = createAssistantStreamMessage(ui.chatContainer);
          setBaseStatus("Streaming");
        }
        if (!streamHandle) return;
        appendAssistantStreamChunk(ui.chatContainer, streamHandle, token);
      },
    });
    const reply = completion.content;

    if (completion.streamed && streamHandle) {
      finalizeAssistantStreamMessage(streamHandle, reply);
    } else {
      await addAssistantMessageWithTypewriter(ui.chatContainer, reply);
    }

    if (currentConversation) {
      const updated = applyTurn(currentConversation, message, reply);
      upsertConversation(updated);
      persistConversationState();
      renderConversationSelector();
    }

    setBaseStatus("Connected");
  } catch (error) {
    showErrorMessage(ui.chatContainer, mapErrorToMessage(error));
    setBaseStatus("Error");
  } finally {
    updateInputState(ui.chatInput, ui.sendButton, false);
    showThinkingIndicator(ui.thinkingIndicator, false);
    ui.chatInput.focus();
    isSending = false;
    scheduleEstimatePreview();
  }
}

function initializeConversationState() {
  const loaded = loadConversations();
  conversations = loaded.conversations;
  activeConversationId = loaded.activeID || null;

  if (conversations.length === 0) {
    const created = createConversation();
    conversations = [created];
    activeConversationId = created.id;
    persistConversationState();
    return;
  }

  if (!activeConversationId || !conversations.some((item) => item.id === activeConversationId)) {
    activeConversationId = conversations[0].id;
    persistConversationState();
  }
}

function persistConversationState() {
  if (!activeConversationId) return;
  persistConversations(conversations, activeConversationId);
}

function getActiveConversation() {
  if (!activeConversationId) return null;
  return conversations.find((item) => item.id === activeConversationId) || null;
}

function getActiveConversationMessages() {
  return getActiveConversation()?.messages || [];
}

function upsertConversation(updated: ChatConversation) {
  conversations = conversations.filter((item) => item.id !== updated.id);
  conversations.unshift(updated);
  activeConversationId = updated.id;
}

function renderConversationSelector() {
  if (!currentUI) return;
  const options = conversations.map((item) => ({
    id: item.id,
    label: item.title,
  }));
  renderConversationOptions(currentUI.conversationSelect, options, activeConversationId);
}

function renderActiveConversationMessages() {
  if (!currentUI) return;
  clearMessages(currentUI.chatContainer);
  const messages = getActiveConversationMessages();
  if (messages.length === 0) {
    const currentConversation = getActiveConversation();
    if (currentConversation && !currentConversation.introShown) {
      addMessageToDisplay(
        currentUI.chatContainer,
        "assistant",
        "你好，我是 PaperChat。你可以从当前选中文段或文献上下文开始提问。",
      );
      currentConversation.introShown = true;
      currentConversation.updatedAt = Date.now();
      persistConversationState();
    }
    return;
  }

  for (const message of messages) {
    if (message.role === "user" || message.role === "assistant") {
      addMessageToDisplay(currentUI.chatContainer, message.role, message.content);
    }
  }
}

function renderPdfList(query: string) {
  if (!currentUI) return;
  const ui = currentUI;
  const normalizedQuery = query.toLowerCase();
  const filtered = normalizedQuery
    ? pdfOptions.filter((option) => option.label.toLowerCase().includes(normalizedQuery))
    : pdfOptions;

  const hasFocused = filtered.some((option) => option.id === focusedPdfId);
  const fallbackFocusedId = hasFocused
    ? focusedPdfId
    : filtered.length > 0
      ? filtered[0].id
      : null;
  focusedPdfId = fallbackFocusedId;

  renderPdfOptions(
    ui.pdfSelect,
    filtered.map((option) => ({ id: option.id, label: option.label })),
    focusedPdfId,
  );
  refreshContextPreview();
  scheduleEstimatePreview();
}

function stopSelectionWatcher() {
  if (selectionWatcherTimer) {
    clearInterval(selectionWatcherTimer);
    selectionWatcherTimer = null;
  }
}

function startSelectionWatcher() {
  stopSelectionWatcher();
  selectionWatcherTimer = setInterval(() => {
    const selected = getActiveReaderSelectionText();
    if (selected !== latestSelectionText) {
      latestSelectionText = selected;
      refreshContextPreview();
      scheduleEstimatePreview();
    }
  }, 600);
}

function refreshContextPreview() {
  if (!currentUI) return;
  const badges: ContextBadge[] = [];

  if (contextEnabled) {
    const selectedOptions = getSelectedPdfOptionsInPriorityOrder();
    const visible = selectedOptions.slice(0, MAX_VISIBLE_PDF_BADGES);
    visible.forEach((option) => {
      badges.push({
        type: "pdf",
        label: abbreviateForBadge(option.label),
      });
    });

    const overflow = selectedOptions.length - visible.length;
    if (overflow > 0) {
      badges.push({
        type: "more",
        label: `+${overflow}`,
      });
    }
  }

  if (selectionContextEnabled && latestSelectionText) {
    badges.push({
      type: "selection",
      label: abbreviateForBadge(latestSelectionText),
    });
  }

  renderContextBadges(currentUI.contextPreview, badges);
}

function getSelectedPdfOptionsInPriorityOrder() {
  return selectedPdfIds
    .map((id) => pdfOptions.find((option) => option.id === id))
    .filter((item): item is PDFContextOption => Boolean(item));
}

function addPdfToContext(pdfId: number) {
  const exists = selectedPdfIds.includes(pdfId);
  selectedPdfIds = exists
    ? [pdfId, ...selectedPdfIds.filter((id) => id !== pdfId)]
    : [pdfId, ...selectedPdfIds];

  let overflowRemoved = false;
  if (selectedPdfIds.length > MAX_SELECTED_PDFS) {
    selectedPdfIds = selectedPdfIds.slice(0, MAX_SELECTED_PDFS);
    overflowRemoved = true;
  }

  persistActiveConversationContextPdfIds();
  refreshContextPreview();
  scheduleEstimatePreview();

  if (overflowRemoved && currentUI) {
    addMessageToDisplay(
      currentUI.chatContainer,
      "assistant",
      `最多可加入 ${MAX_SELECTED_PDFS} 篇文献，已自动移除最早加入的文献。`,
    );
  }
}

function removePdfFromContext(pdfId: number) {
  const before = selectedPdfIds.length;
  selectedPdfIds = selectedPdfIds.filter((id) => id !== pdfId);
  if (selectedPdfIds.length === before) {
    return;
  }
  persistActiveConversationContextPdfIds();
  refreshContextPreview();
  scheduleEstimatePreview();
}

function restoreContextPdfSelectionFromConversation() {
  const currentConversation = getActiveConversation();
  const fromConversation = currentConversation?.contextPdfIds || [];
  selectedPdfIds = [...fromConversation];
  contextMode = currentConversation?.contextMode === "full" ? "full" : "balanced";
  if (currentUI) {
    currentUI.contextModeSelect.value = contextMode;
  }
  scheduleEstimatePreview();
}

function persistActiveConversationContextPdfIds() {
  const currentConversation = getActiveConversation();
  if (!currentConversation) return;
  currentConversation.contextPdfIds = [...selectedPdfIds];
  persistConversationState();
}

function persistActiveConversationContextMode() {
  const currentConversation = getActiveConversation();
  if (!currentConversation) return;
  currentConversation.contextMode = contextMode;
  persistConversationState();
}

function reconcileSelectedPdfsWithOptions() {
  const validIDs = new Set(pdfOptions.map((option) => option.id));
  const normalized = selectedPdfIds.filter((id) => validIDs.has(id)).slice(0, MAX_SELECTED_PDFS);
  if (normalized.length === selectedPdfIds.length) {
    selectedPdfIds = normalized;
    return;
  }
  selectedPdfIds = normalized;
  persistActiveConversationContextPdfIds();
}

async function buildMultiPdfContext(
  selectedIds: number[],
  options: PDFContextOption[],
  query: string,
  mode: PdfContextMode,
) {
  const optionMap = new Map(options.map((option) => [option.id, option]));
  const invalidIds = selectedIds.filter((id) => !optionMap.has(id));
  const ordered = selectedIds
    .map((id) => optionMap.get(id))
    .filter((item): item is PDFContextOption => Boolean(item));

  if (ordered.length === 0) {
    return { text: "", invalidIds };
  }

  const effectiveMode =
    mode === "full" && ordered.length === 1 ? "full" : "balanced";
  const perDocLimit =
    effectiveMode === "full" ? MAX_FULL_PDF_CONTEXT_CHARS_SINGLE : MAX_PDF_CONTEXT_CHARS_EACH;
  const docs = await Promise.all(
    ordered.map(async (option, index) => ({
      index: index + 1,
      option,
      contextResult: await getOptionContext(option, query, effectiveMode, perDocLimit),
    })),
  );

  const sections: string[] = [];
  let used = 0;
  let compressed = false;
  let warning = "";

  for (const doc of docs) {
    const sectionTitle = `文献${doc.index}（${doc.option.label}）`;
    let sectionBody = truncateText(doc.contextResult.text, perDocLimit);
    let sectionText = `${sectionTitle}\n${sectionBody}`;

    const budgetLimit =
      effectiveMode === "full" ? MAX_FULL_PDF_CONTEXT_CHARS_SINGLE : MAX_PDF_CONTEXT_CHARS_TOTAL;

    if (sectionText.length + used <= budgetLimit) {
      sections.push(sectionText);
      used += sectionText.length;
      continue;
    }

    sectionBody = compressContextText(sectionBody, MIN_PDF_CONTEXT_BODY_CHARS);
    sectionText = `${sectionTitle}\n${sectionBody}`;
    compressed = true;

    if (sectionText.length + used <= budgetLimit) {
      sections.push(sectionText);
      used += sectionText.length;
      continue;
    }

    const remaining = budgetLimit - used;
    if (remaining > 80) {
      const truncated = truncateText(sectionText, remaining - 20);
      sections.push(`${truncated}\n...[已截断]`);
      used = budgetLimit;
      compressed = true;
    }
    break;
  }

  if (mode === "full" && ordered.length > 1) {
    warning = "Full PDF 模式仅对单篇文献生效；当前已自动回退为 Balanced。";
  } else if (effectiveMode === "full" && docs[0]?.contextResult.truncated) {
    warning =
      `当前 PDF 全文约 ${docs[0].contextResult.sourceLength} 字符，已超过单轮预算，发送时做了截断。`;
  }

  const footer = compressed
    ? "\n\n[部分文献内容已压缩以控制上下文长度]"
    : "";

  return {
    text: `${sections.join("\n\n")}${footer}`.trim(),
    invalidIds,
    warning,
  };
}

function compressContextText(raw: string, minBodyChars: number) {
  const splitMarker = "\n\n以下是该 PDF 的正文摘录";
  const splitIndex = raw.indexOf(splitMarker);
  if (splitIndex === -1) {
    return truncateText(raw, minBodyChars + 500);
  }

  const metadata = raw.slice(0, splitIndex).trim();
  const body = raw.slice(splitIndex).trim();
  const bodyExcerpt = truncateText(body, minBodyChars);
  return `${metadata}\n\n${bodyExcerpt}`;
}

function truncateText(text: string, maxChars: number) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars)).trimEnd()}...`;
}

function abbreviateForBadge(input: string) {
  const trimmed = input.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  const chars = Array.from(trimmed);
  if (chars.length <= 10) {
    return chars.join("");
  }
  return `${chars.slice(0, 10).join("")}...`;
}

function mapErrorToMessage(error: unknown) {
  if (error instanceof LLMRequestError) {
    if (error.code === "timeout") {
      return "请求超时，请检查网络或稍后重试。";
    }
    if (error.status === 401 || error.status === 403) {
      return "鉴权失败（401/403），请检查 API Key。";
    }
    if (error.status === 429) {
      return "请求过于频繁（429），请稍后重试。";
    }
    if (error.status && error.status >= 500) {
      return "服务端异常（5xx），请稍后重试。";
    }
    return error.message;
  }

  if (error instanceof Error) {
    if (/network|failed to fetch/i.test(error.message)) {
      return "网络请求失败，请检查网络或 Endpoint。";
    }
    return error.message;
  }

  return "未知错误，请稍后重试。";
}
