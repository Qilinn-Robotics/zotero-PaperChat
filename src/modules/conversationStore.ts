import { ChatMessage } from "./llmService";
import { getPref, setPref } from "../utils/prefs";

export interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  contextPdfIds?: number[];
  introShown?: boolean;
  createdAt: number;
  updatedAt: number;
}

const CONVERSATION_STORE_KEY = "conversationStore";
const ACTIVE_CONVERSATION_ID_KEY = "activeConversationId";
const MAX_STORED_CONVERSATIONS = 30;
const STORAGE_RETRY_STRATEGIES = [
  { maxMessagesPerConversation: 60, maxCharsPerMessage: 12000 },
  { maxMessagesPerConversation: 36, maxCharsPerMessage: 8000 },
  { maxMessagesPerConversation: 24, maxCharsPerMessage: 4000 },
  { maxMessagesPerConversation: 12, maxCharsPerMessage: 2000 },
  { maxMessagesPerConversation: 6, maxCharsPerMessage: 1000 },
] as const;

function isValidRole(role: unknown): role is ChatMessage["role"] {
  return role === "system" || role === "user" || role === "assistant";
}

function normalizeMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item) => {
      const role = (item as any)?.role;
      const content = (item as any)?.content;
      return isValidRole(role) && typeof content === "string" && content.trim().length > 0;
    })
    .map((item) => ({
      role: (item as any).role,
      content: String((item as any).content),
    }));
}

function normalizeContextPdfIds(input: unknown) {
  if (!Array.isArray(input)) return [];
  const ids = input
    .map((item) => Number(item))
    .filter((id) => Number.isFinite(id) && id > 0)
    .map((id) => Math.trunc(id));

  const unique: number[] = [];
  const seen = new Set<number>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

function normalizeConversation(raw: unknown): ChatConversation | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as any;
  const id = typeof source.id === "string" ? source.id : "";
  if (!id) return null;
  const title = typeof source.title === "string" && source.title.trim()
    ? source.title.trim()
    : "未命名对话";
  const createdAt = Number.isFinite(Number(source.createdAt))
    ? Number(source.createdAt)
    : Date.now();
  const updatedAt = Number.isFinite(Number(source.updatedAt))
    ? Number(source.updatedAt)
    : createdAt;
  return {
    id,
    title,
    messages: normalizeMessages(source.messages),
    contextPdfIds: normalizeContextPdfIds(source.contextPdfIds),
    introShown: Boolean(source.introShown),
    createdAt,
    updatedAt,
  };
}

function parseConversations(raw: string): ChatConversation[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeConversation)
      .filter((item): item is ChatConversation => Boolean(item))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_STORED_CONVERSATIONS);
  } catch {
    return [];
  }
}

function buildConversationTitle(firstUserInput: string) {
  const compact = firstUserInput.replace(/\s+/g, " ").trim();
  if (!compact) return "新对话";
  return compact.length > 20 ? `${compact.slice(0, 20)}...` : compact;
}

function truncateMessageContent(content: string, maxChars: number) {
  const normalized = content.trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  const suffix = "\n...[内容已截断以保存对话]";
  const limit = Math.max(0, maxChars - suffix.length);
  return `${normalized.slice(0, limit).trimEnd()}${suffix}`;
}

function compactConversationForStorage(
  conversation: ChatConversation,
  maxMessagesPerConversation: number,
  maxCharsPerMessage: number,
): ChatConversation {
  const messages = conversation.messages
    .slice(-maxMessagesPerConversation)
    .map((message) => ({
      ...message,
      content: truncateMessageContent(message.content, maxCharsPerMessage),
    }))
    .filter((message) => message.content.length > 0);

  return {
    ...conversation,
    messages,
  };
}

function logStorageFallback(error: unknown, strategyIndex: number) {
  const logger = (globalThis as any).Zotero?.debug;
  if (typeof logger !== "function") return;

  let detail = "unknown error";
  if (error instanceof Error && error.message) {
    detail = error.message;
  } else if (typeof error === "string" && error) {
    detail = error;
  }

  logger(
    `[PaperChat] Conversation persistence retry ${strategyIndex + 1} failed: ${detail}`,
  );
}

export function generateConversationID() {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${Date.now()}-${suffix}`;
}

export function createConversation(title = "新对话"): ChatConversation {
  const now = Date.now();
  return {
    id: generateConversationID(),
    title,
    messages: [],
    contextPdfIds: [],
    introShown: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function loadConversations() {
  const raw = String((getPref(CONVERSATION_STORE_KEY) || "") as string);
  const activeID = String((getPref(ACTIVE_CONVERSATION_ID_KEY) || "") as string);
  const conversations = parseConversations(raw);
  return { conversations, activeID };
}

export function persistConversations(conversations: ChatConversation[], activeID: string) {
  const normalized = conversations
    .map((item) => normalizeConversation(item))
    .filter((item): item is ChatConversation => Boolean(item))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_STORED_CONVERSATIONS);

  let lastError: unknown = null;

  for (let index = 0; index < STORAGE_RETRY_STRATEGIES.length; index++) {
    const strategy = STORAGE_RETRY_STRATEGIES[index];
    const compacted = normalized.map((item) =>
      compactConversationForStorage(
        item,
        strategy.maxMessagesPerConversation,
        strategy.maxCharsPerMessage,
      ),
    );

    try {
      setPref(CONVERSATION_STORE_KEY, JSON.stringify(compacted));
      setPref(ACTIVE_CONVERSATION_ID_KEY, activeID);
      return;
    } catch (error) {
      lastError = error;
      logStorageFallback(error, index);
    }
  }

  const metadataOnly = normalized.map((item) => ({
    ...item,
    messages: [],
  }));

  try {
    setPref(CONVERSATION_STORE_KEY, JSON.stringify(metadataOnly));
    setPref(ACTIVE_CONVERSATION_ID_KEY, activeID);
    const logger = (globalThis as any).Zotero?.debug;
    if (typeof logger === "function") {
      logger("[PaperChat] Conversation persistence fell back to metadata-only storage.");
    }
    return;
  } catch (error) {
    lastError = error;
  }

  throw lastError;
}

export function applyTurn(
  conversation: ChatConversation,
  userMessage: string,
  assistantMessage: string,
) {
  const now = Date.now();
  const messages = [
    ...conversation.messages,
    { role: "user" as const, content: userMessage },
    { role: "assistant" as const, content: assistantMessage },
  ];

  const title =
    conversation.messages.length === 0
      ? buildConversationTitle(userMessage)
      : conversation.title;

  return {
    ...conversation,
    title,
    updatedAt: now,
    messages,
  };
}
