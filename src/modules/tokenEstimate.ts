import { ChatMessage } from "./llmService";

const TOKENS_PER_MESSAGE_OVERHEAD = 4;
const TOKENS_REPLY_PRIMER = 2;

export function estimateTextTokens(text: string) {
  if (!text) return 0;

  let tokens = 0;
  for (const char of text) {
    if (/[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/u.test(char)) {
      tokens += 1.2;
      continue;
    }
    if (/\s/.test(char)) {
      tokens += 0.2;
      continue;
    }
    if (/[A-Za-z0-9]/.test(char)) {
      tokens += 0.28;
      continue;
    }
    tokens += 0.5;
  }

  return Math.ceil(tokens);
}

export function estimateMessagesInputTokens(messages: ChatMessage[]) {
  return (
    messages.reduce(
      (sum, message) =>
        sum +
        TOKENS_PER_MESSAGE_OVERHEAD +
        estimateTextTokens(message.role) +
        estimateTextTokens(message.content),
      0,
    ) + TOKENS_REPLY_PRIMER
  );
}
