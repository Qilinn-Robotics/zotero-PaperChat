import { renderMessageHTML } from "./messageRenderer";

export interface ChatUIElements {
  root: HTMLDivElement;
  toolbox: HTMLDivElement;
  conversationSelect: HTMLSelectElement;
  newConversationButton: HTMLButtonElement;
  renameConversationButton: HTMLButtonElement;
  deleteConversationButton: HTMLButtonElement;
  contextToggle: HTMLInputElement;
  selectionToggle: HTMLInputElement;
  searchInput: HTMLInputElement;
  pdfSelect: HTMLSelectElement;
  addPdfButton: HTMLButtonElement;
  removePdfButton: HTMLButtonElement;
  clearButton: HTMLButtonElement;
  contextPreview: HTMLDivElement;
  chatContainer: HTMLDivElement;
  chatInput: HTMLTextAreaElement;
  sendButton: HTMLButtonElement;
  thinkingIndicator: HTMLDivElement;
  statusIndicator: HTMLDivElement;
}

type Role = "user" | "assistant" | "error";
type ContextBadgeType = "pdf" | "selection" | "more";

export interface AssistantStreamHandle {
  row: HTMLDivElement;
  bubble: HTMLDivElement;
}

export interface ContextBadge {
  type: ContextBadgeType;
  label: string;
}

export function createChatInterface(parentElement: HTMLElement): ChatUIElements {
  const doc = parentElement.ownerDocument;
  if (!doc) {
    throw new Error("PaperChat: document is unavailable.");
  }

  const root = doc.createElement("div");
  root.className = "paperchat-shell";

  const toolbox = doc.createElement("div");
  toolbox.className = "paperchat-toolbox";

  const toolboxRow1 = doc.createElement("div");
  toolboxRow1.className = "paperchat-toolbox-row";
  const contextRow1 = doc.createElement("div");
  contextRow1.className = "paperchat-toolbox-row";
  const contextRow2 = doc.createElement("div");
  contextRow2.className = "paperchat-toolbox-row";

  const conversationLabel = doc.createElement("span");
  conversationLabel.className = "paperchat-toolbox-label";
  conversationLabel.textContent = "对话";

  const conversationSelect = doc.createElement("select");
  conversationSelect.className = "paperchat-conversation-select";
  const initialConversationOption = doc.createElement("option");
  initialConversationOption.value = "";
  initialConversationOption.textContent = "新对话";
  conversationSelect.appendChild(initialConversationOption);

  const newConversationButton = doc.createElement("button");
  newConversationButton.className = "paperchat-toolbox-btn paperchat-toolbox-btn-mini";
  newConversationButton.textContent = "新建";

  const renameConversationButton = doc.createElement("button");
  renameConversationButton.className =
    "paperchat-toolbox-btn paperchat-toolbox-btn-mini";
  renameConversationButton.textContent = "重命名";

  const deleteConversationButton = doc.createElement("button");
  deleteConversationButton.className =
    "paperchat-toolbox-btn paperchat-toolbox-btn-mini";
  deleteConversationButton.textContent = "删除";

  const label = doc.createElement("span");
  label.className = "paperchat-toolbox-label";
  label.textContent = "文献";

  const contextToggleWrap = doc.createElement("label");
  contextToggleWrap.className = "paperchat-toggle-wrap";
  const contextToggle = doc.createElement("input");
  contextToggle.type = "checkbox";
  contextToggle.className = "paperchat-toggle";
  const contextToggleText = doc.createElement("span");
  contextToggleText.textContent = "启用文献上下文";
  contextToggleWrap.append(contextToggle, contextToggleText);

  const selectionToggleWrap = doc.createElement("label");
  selectionToggleWrap.className = "paperchat-toggle-wrap";
  const selectionToggle = doc.createElement("input");
  selectionToggle.type = "checkbox";
  selectionToggle.className = "paperchat-toggle";
  const selectionToggleText = doc.createElement("span");
  selectionToggleText.textContent = "选中内容";
  selectionToggleWrap.append(selectionToggle, selectionToggleText);

  const searchInput = doc.createElement("input");
  searchInput.className = "paperchat-search-input";
  searchInput.placeholder = "搜索文献...";

  const pdfSelect = doc.createElement("select");
  pdfSelect.className = "paperchat-context-select";

  const initialOption = doc.createElement("option");
  initialOption.value = "";
  initialOption.textContent = "加载可选 PDF...";
  pdfSelect.appendChild(initialOption);

  const clearButton = doc.createElement("button");
  clearButton.className = "paperchat-toolbox-btn";
  clearButton.textContent = "清空对话";

  const addPdfButton = doc.createElement("button");
  addPdfButton.className = "paperchat-toolbox-btn paperchat-toolbox-btn-mini";
  addPdfButton.textContent = "加入";

  const removePdfButton = doc.createElement("button");
  removePdfButton.className = "paperchat-toolbox-btn paperchat-toolbox-btn-mini";
  removePdfButton.textContent = "移除";

  const statusIndicator = doc.createElement("div");
  statusIndicator.className = "paperchat-connection";
  statusIndicator.textContent = "Ready";

  toolboxRow1.append(
    conversationLabel,
    conversationSelect,
    newConversationButton,
    renameConversationButton,
    deleteConversationButton,
    statusIndicator,
  );
  toolbox.append(toolboxRow1);

  const chatContainer = doc.createElement("div");
  chatContainer.className = "paperchat-messages";

  const contextPanel = doc.createElement("div");
  contextPanel.className = "paperchat-context-panel";
  contextRow1.append(label, contextToggleWrap, selectionToggleWrap);
  contextRow2.append(searchInput, pdfSelect, addPdfButton, removePdfButton, clearButton);
  contextPanel.append(contextRow1, contextRow2);

  const contextPreview = doc.createElement("div");
  contextPreview.className = "paperchat-context-preview";
  contextPreview.textContent = "尚未选择文献或文本。";

  const footer = doc.createElement("div");
  footer.className = "paperchat-composer";

  const thinkingIndicator = doc.createElement("div");
  thinkingIndicator.className = "paperchat-thinking";
  thinkingIndicator.textContent = "AI 正在思考...";
  thinkingIndicator.style.display = "none";

  const chatInput = doc.createElement("textarea");
  chatInput.className = "paperchat-input";
  chatInput.placeholder = "输入问题，例如：请解释当前文献的方法与结论";
  chatInput.rows = 3;

  const sendButton = doc.createElement("button");
  sendButton.className = "paperchat-send";
  sendButton.textContent = "发送";

  footer.append(thinkingIndicator, chatInput, sendButton);
  root.append(toolbox, chatContainer, contextPanel, contextPreview, footer);
  parentElement.appendChild(root);

  return {
    root,
    toolbox,
    conversationSelect,
    newConversationButton,
    renameConversationButton,
    deleteConversationButton,
    contextToggle,
    selectionToggle,
    searchInput,
    pdfSelect,
    addPdfButton,
    removePdfButton,
    clearButton,
    contextPreview,
    chatContainer,
    chatInput,
    sendButton,
    thinkingIndicator,
    statusIndicator,
  };
}

export function renderConversationOptions(
  select: HTMLSelectElement,
  options: { id: string; label: string }[],
  selectedId: string | null,
) {
  const doc = select.ownerDocument;
  if (!doc) return;

  while (select.firstChild) {
    select.removeChild(select.firstChild);
  }

  options.forEach((item) => {
    const option = doc.createElement("option");
    option.value = item.id;
    option.textContent = item.label;
    option.title = item.label;
    option.selected = selectedId === item.id;
    select.appendChild(option);
  });
}

export function renderPdfOptions(
  select: HTMLSelectElement,
  options: { id: number; label: string }[],
  selectedId: number | null,
) {
  const doc = select.ownerDocument;
  if (!doc) return;

  while (select.firstChild) {
    select.removeChild(select.firstChild);
  }

  if (options.length === 0) {
    const option = doc.createElement("option");
    option.value = "";
    option.textContent = "当前库没有可用 PDF";
    option.disabled = true;
    option.selected = true;
    select.appendChild(option);
    return;
  }

  options.forEach((item) => {
    const label =
      item.label.length > 48 ? `${item.label.slice(0, 48).trimEnd()}...` : item.label;
    const option = doc.createElement("option");
    option.value = String(item.id);
    option.textContent = label;
    option.title = item.label;
    option.selected = selectedId === item.id;
    select.appendChild(option);
  });
}

export function renderContextBadges(preview: HTMLDivElement, badges: ContextBadge[]) {
  const doc = preview.ownerDocument;
  if (!doc) return;

  while (preview.firstChild) {
    preview.removeChild(preview.firstChild);
  }

  if (badges.length === 0) {
    preview.textContent = "尚未添加 context。";
    preview.classList.add("paperchat-context-preview-empty");
    return;
  }

  preview.classList.remove("paperchat-context-preview-empty");

  badges.forEach((badge) => {
    const item = doc.createElement("div");
    item.className = "paperchat-context-badge";

    const text = doc.createElement("span");
    text.className = "paperchat-context-badge-text";
    text.textContent = badge.label;
    text.title = badge.label;
    if (badge.type === "more") {
      item.classList.add("paperchat-context-badge-more");
      item.append(text);
    } else {
      const icon = doc.createElement("img");
      icon.className = "paperchat-context-badge-icon";
      icon.alt = badge.type === "pdf" ? "PDF context" : "Selection context";
      icon.src =
        badge.type === "pdf"
          ? `chrome://${addon.data.config.addonRef}/content/icons/context-pdf.svg`
          : `chrome://${addon.data.config.addonRef}/content/icons/context-selection.svg`;
      item.append(icon, text);
    }

    preview.appendChild(item);
  });
}

export function addMessageToDisplay(
  container: HTMLDivElement,
  role: Role,
  content: string,
) {
  const doc = container.ownerDocument;
  if (!doc) return;

  const row = doc.createElement("div");
  row.className = `paperchat-row paperchat-row-${role}`;

  const bubble = doc.createElement("div");
  bubble.className = `paperchat-bubble paperchat-bubble-${role}`;
  if (role === "assistant") {
    finalizeAssistantStreamMessage({ row, bubble }, content);
  } else {
    bubble.textContent = content;
  }

  row.appendChild(bubble);
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
}

function safelyRenderAssistantBubble(bubble: HTMLDivElement, content: string) {
  try {
    bubble.classList.add("paperchat-markdown");
    bubble.innerHTML = renderMessageHTML(content);
  } catch {
    bubble.classList.remove("paperchat-markdown");
    bubble.textContent = content;
  }
}

export function createAssistantStreamMessage(
  container: HTMLDivElement,
): AssistantStreamHandle | null {
  const doc = container.ownerDocument;
  if (!doc) return null;

  const row = doc.createElement("div");
  row.className = "paperchat-row paperchat-row-assistant";

  const bubble = doc.createElement("div");
  bubble.className = "paperchat-bubble paperchat-bubble-assistant";
  row.appendChild(bubble);
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;

  return { row, bubble };
}

export function appendAssistantStreamChunk(
  container: HTMLDivElement,
  handle: AssistantStreamHandle,
  content: string,
) {
  handle.bubble.textContent = `${handle.bubble.textContent || ""}${content}`;
  container.scrollTop = container.scrollHeight;
}

export function finalizeAssistantStreamMessage(
  handle: AssistantStreamHandle,
  content?: string,
) {
  const finalContent = content ?? handle.bubble.textContent ?? "";
  safelyRenderAssistantBubble(handle.bubble, finalContent);
}

export async function addAssistantMessageWithTypewriter(
  container: HTMLDivElement,
  content: string,
  options?: {
    intervalMs?: number;
    charsPerTick?: number;
  },
) {
  const handle = createAssistantStreamMessage(container);
  if (!handle) return;

  const text = content || "";
  const intervalMs = Math.max(4, options?.intervalMs ?? 7);
  const charsPerTick = Math.max(1, options?.charsPerTick ?? 2);

  let cursor = 0;
  while (cursor < text.length) {
    cursor = Math.min(text.length, cursor + charsPerTick);
    handle.bubble.textContent = text.slice(0, cursor);
    container.scrollTop = container.scrollHeight;
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }

  finalizeAssistantStreamMessage(handle, text);
  container.scrollTop = container.scrollHeight;
}

export function clearMessages(container: HTMLDivElement) {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
}

export function updateInputState(
  input: HTMLTextAreaElement,
  sendButton: HTMLButtonElement,
  disabled: boolean,
) {
  input.disabled = disabled;
  sendButton.disabled = disabled;
}

export function autoResizeInput(input: HTMLTextAreaElement) {
  input.style.height = "auto";
  const computed = input.ownerDocument?.defaultView?.getComputedStyle(input);
  const maxHeight = Number.parseFloat(computed?.maxHeight || "180");
  const targetHeight = Math.min(input.scrollHeight, Number.isFinite(maxHeight) ? maxHeight : 180);
  input.style.height = `${targetHeight}px`;
  input.style.overflowY = input.scrollHeight > targetHeight ? "auto" : "hidden";
}

export function showThinkingIndicator(indicator: HTMLDivElement, show: boolean) {
  indicator.style.display = show ? "block" : "none";
}

export function showErrorMessage(container: HTMLDivElement, message: string) {
  addMessageToDisplay(container, "error", message);
}

export function setConnectionStatus(target: HTMLDivElement, statusText: string) {
  target.textContent = statusText;
}
