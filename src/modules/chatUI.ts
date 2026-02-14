import { renderMessageHTML } from "./messageRenderer";

export interface ChatUIElements {
  root: HTMLDivElement;
  toolbox: HTMLDivElement;
  contextToggle: HTMLInputElement;
  searchInput: HTMLInputElement;
  pdfSelect: HTMLSelectElement;
  clearButton: HTMLButtonElement;
  chatContainer: HTMLDivElement;
  chatInput: HTMLTextAreaElement;
  sendButton: HTMLButtonElement;
  thinkingIndicator: HTMLDivElement;
  statusIndicator: HTMLDivElement;
}

type Role = "user" | "assistant" | "error";

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
  const toolboxRow2 = doc.createElement("div");
  toolboxRow2.className = "paperchat-toolbox-row";

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

  const statusIndicator = doc.createElement("div");
  statusIndicator.className = "paperchat-connection";
  statusIndicator.textContent = "Ready";

  toolboxRow1.append(label, contextToggleWrap, statusIndicator);
  toolboxRow2.append(
    searchInput,
    pdfSelect,
    clearButton,
  );
  toolbox.append(toolboxRow1, toolboxRow2);

  const chatContainer = doc.createElement("div");
  chatContainer.className = "paperchat-messages";

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
  root.append(toolbox, chatContainer, footer);
  parentElement.appendChild(root);

  return {
    root,
    toolbox,
    contextToggle,
    searchInput,
    pdfSelect,
    clearButton,
    chatContainer,
    chatInput,
    sendButton,
    thinkingIndicator,
    statusIndicator,
  };
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
    bubble.classList.add("paperchat-markdown");
    bubble.innerHTML = renderMessageHTML(content);
  } else {
    bubble.textContent = content;
  }

  row.appendChild(bubble);
  container.appendChild(row);
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

export function showThinkingIndicator(indicator: HTMLDivElement, show: boolean) {
  indicator.style.display = show ? "block" : "none";
}

export function showErrorMessage(container: HTMLDivElement, message: string) {
  addMessageToDisplay(container, "error", message);
}

export function setConnectionStatus(target: HTMLDivElement, statusText: string) {
  target.textContent = statusText;
}
