import { getActiveAIConfig } from "../utils/prefs";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface CompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

export class LLMRequestError extends Error {
  status?: number;
  code?: "timeout";

  constructor(message: string, status?: number, code?: "timeout") {
    super(message);
    this.name = "LLMRequestError";
    this.status = status;
    this.code = code;
  }
}

const REQUEST_TIMEOUT_MS = 45000;

export async function getCompletion(messages: ChatMessage[]): Promise<string> {
  const config = getActiveAIConfig();

  if (!config.apiKey) {
    throw new LLMRequestError("缺少 API Key，请到设置页配置。");
  }

  if (!config.apiEndpoint) {
    throw new LLMRequestError("缺少 API Endpoint，请到设置页配置。", 400);
  }

  const abortController =
    typeof (globalThis as any).AbortController === "function"
      ? new (globalThis as any).AbortController()
      : null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let response: Response;

  const requestPromise = fetch(config.apiEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.modelName,
      messages,
      temperature: config.temperature,
    }),
    ...(abortController ? { signal: abortController.signal } : {}),
  });

  const timeoutPromise = new Promise<Response>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      if (abortController) {
        abortController.abort();
      }
      reject(new LLMRequestError("请求超时，请稍后重试。", undefined, "timeout"));
    }, REQUEST_TIMEOUT_MS);
  });

  try {
    response = await Promise.race([requestPromise, timeoutPromise]);
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      throw new LLMRequestError("请求超时，请稍后重试。", undefined, "timeout");
    }
    if (error instanceof LLMRequestError && error.code === "timeout") {
      throw error;
    }
    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const data = (await response.json()) as CompletionResponse;
      if (data.error?.message) {
        message = `${message}: ${data.error.message}`;
      }
    } catch {
      // Ignore JSON parse failure and use status text.
    }
    throw new LLMRequestError(message, response.status);
  }

  let data: CompletionResponse;
  try {
    data = (await response.json()) as CompletionResponse;
  } catch {
    throw new LLMRequestError("响应解析失败，请检查 API 返回格式。");
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new LLMRequestError("响应内容为空或格式不符合 Chat Completions 规范。");
  }

  return content.trim();
}
