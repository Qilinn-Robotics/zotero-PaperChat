import {
  ChatUIElements,
  addMessageToDisplay,
  clearMessages,
  renderPdfOptions,
  setConnectionStatus,
  showErrorMessage,
  showThinkingIndicator,
  updateInputState,
} from "./chatUI";
import { ChatMessage, LLMRequestError, getCompletion } from "./llmService";
import { getActiveAIConfig } from "../utils/prefs";
import {
  PDFContextOption,
  getDefaultPdfOptionId,
  getOptionContextText,
  loadLibraryPdfOptions,
} from "./pdfContext";

let currentUI: ChatUIElements | null = null;
let isSending = false;
let conversation: ChatMessage[] = [];
let pdfOptions: PDFContextOption[] = [];
let selectedPdfId: number | null = null;
let contextEnabled = false;

const MAX_CONTEXT_MESSAGES = 12;

export async function initChat(ui: ChatUIElements, currentItem?: any) {
  currentUI = ui;
  isSending = false;
  conversation = [];
  pdfOptions = [];
  selectedPdfId = null;
  contextEnabled = false;

  bindUIEvents();
  ui.contextToggle.checked = false;

  const config = getActiveAIConfig();
  if (!config.apiKey || !config.apiEndpoint) {
    setConnectionStatus(ui.statusIndicator, "Config Missing");
    showErrorMessage(ui.chatContainer, "请到 Zotero 设置页配置 API Key 和 Endpoint。\n配置后返回这里即可使用。" );
  } else {
    setConnectionStatus(ui.statusIndicator, "Configured");
    addMessageToDisplay(
      ui.chatContainer,
      "assistant",
      "你好，我是 PaperChat。请选择上方文献后开始提问。",
    );
  }

  await loadPdfContext(currentItem);
}

export function dispose() {
  if (currentUI) {
    currentUI.sendButton.onclick = null;
    currentUI.chatInput.onkeydown = null;
    currentUI.clearButton.onclick = null;
    currentUI.searchInput.oninput = null;
    currentUI.contextToggle.onchange = null;
    currentUI.pdfSelect.onchange = null;
  }

  currentUI = null;
  isSending = false;
  conversation = [];
  pdfOptions = [];
  selectedPdfId = null;
  contextEnabled = false;
}

function bindUIEvents() {
  if (!currentUI) return;
  const ui = currentUI;

  ui.sendButton.onclick = sendCurrentInput;
  ui.chatInput.onkeydown = (event: Event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key === "Enter" && !keyboardEvent.shiftKey) {
      event.preventDefault();
      sendCurrentInput();
    }
  };

  ui.clearButton.onclick = () => {
    conversation = [];
    clearMessages(ui.chatContainer);
    addMessageToDisplay(ui.chatContainer, "assistant", "对话已清空。可以继续提问。");
  };

  ui.contextToggle.onchange = () => {
    contextEnabled = ui.contextToggle.checked;
  };

  ui.searchInput.oninput = () => {
    renderPdfList(ui.searchInput.value.trim());
  };

  ui.pdfSelect.onchange = () => {
    const value = Number(ui.pdfSelect.value || 0);
    selectedPdfId = Number.isFinite(value) && value > 0 ? value : null;
  };
}

async function loadPdfContext(currentItem?: any) {
  if (!currentUI) return;
  const ui = currentUI;

  try {
    pdfOptions = await loadLibraryPdfOptions(currentItem);
    selectedPdfId = getDefaultPdfOptionId(pdfOptions, currentItem);
    renderPdfList("");

    if (selectedPdfId) {
      setConnectionStatus(ui.statusIndicator, "PDF Linked");
    }
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
    setConnectionStatus(ui.statusIndicator, "Config Missing");
    showErrorMessage(ui.chatContainer, "缺少配置，请先在设置页填写 API 信息。");
    return;
  }

  let pdfContext = "";
  if (contextEnabled) {
    const selectedOption = pdfOptions.find((option) => option.id === selectedPdfId);
    if (selectedOption) {
      pdfContext = await getOptionContextText(selectedOption);
    }
  }

  isSending = true;
  updateInputState(ui.chatInput, ui.sendButton, true);
  showThinkingIndicator(ui.thinkingIndicator, true);
  setConnectionStatus(ui.statusIndicator, "Requesting");

  ui.chatInput.value = "";
  addMessageToDisplay(ui.chatContainer, "user", message);

  const requestMessages: ChatMessage[] = [
    {
      role: "system",
      content:
        `${config.systemPrompt || "You are a helpful assistant."}\n\n` +
        (pdfContext
          ? `以下是当前选择 PDF 的文献信息，请优先结合这些内容回答：\n${pdfContext}`
          : "当前未启用文献上下文，按通用学术助手方式回答。"),
    },
    ...conversation,
    { role: "user", content: message },
  ];

  try {
    const reply = await getCompletion(requestMessages);
    addMessageToDisplay(ui.chatContainer, "assistant", reply);

    conversation.push({ role: "user", content: message });
    conversation.push({ role: "assistant", content: reply });
    if (conversation.length > MAX_CONTEXT_MESSAGES) {
      conversation = conversation.slice(conversation.length - MAX_CONTEXT_MESSAGES);
    }

    setConnectionStatus(ui.statusIndicator, "Connected");
  } catch (error) {
    showErrorMessage(ui.chatContainer, mapErrorToMessage(error));
    setConnectionStatus(ui.statusIndicator, "Error");
  } finally {
    updateInputState(ui.chatInput, ui.sendButton, false);
    showThinkingIndicator(ui.thinkingIndicator, false);
    ui.chatInput.focus();
    isSending = false;
  }
}

function renderPdfList(query: string) {
  if (!currentUI) return;
  const ui = currentUI;
  const normalizedQuery = query.toLowerCase();
  const filtered = normalizedQuery
    ? pdfOptions.filter((option) => option.label.toLowerCase().includes(normalizedQuery))
    : pdfOptions;

  const hasSelected = filtered.some((option) => option.id === selectedPdfId);
  const fallbackSelectedId = hasSelected
    ? selectedPdfId
    : filtered.length > 0
      ? filtered[0].id
      : null;
  selectedPdfId = fallbackSelectedId;

  renderPdfOptions(
    ui.pdfSelect,
    filtered.map((option) => ({ id: option.id, label: option.label })),
    selectedPdfId,
  );
}

function mapErrorToMessage(error: unknown) {
  if (error instanceof LLMRequestError) {
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
