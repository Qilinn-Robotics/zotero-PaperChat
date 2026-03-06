import { getActiveAIConfig } from "../utils/prefs";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface CompletionResponse {
  choices?: Array<{
    delta?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

interface CompletionOptions {
  onToken?: (token: string) => void;
}

interface CompletionResult {
  content: string;
  streamed: boolean;
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

function createAbortController() {
  return typeof (globalThis as any).AbortController === "function"
    ? new (globalThis as any).AbortController()
    : null;
}

function createRequestBody(
  messages: ChatMessage[],
  stream: boolean,
) {
  const config = getActiveAIConfig();

  if (!config.apiKey) {
    throw new LLMRequestError("缺少 API Key，请到设置页配置。");
  }

  if (!config.apiEndpoint) {
    throw new LLMRequestError("缺少 API Endpoint，请到设置页配置。", 400);
  }

  return {
    config,
    body: JSON.stringify({
      model: config.modelName,
      messages,
      temperature: config.temperature,
      ...(stream ? { stream: true } : {}),
    }),
  };
}

async function fetchWithTimeout(messages: ChatMessage[], stream: boolean) {
  const { config, body } = createRequestBody(messages, stream);
  const abortController = createAbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let response: Response;

  const requestPromise = fetch(config.apiEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body,
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

  return response;
}

async function parseErrorResponse(response: Response) {
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

function extractContentParts(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && typeof (part as any).text === "string") {
        return (part as any).text;
      }
      return "";
    })
    .join("");
}

function isStreamUnsupportedStatus(status: number) {
  return [400, 404, 405, 415, 422].includes(status);
}

async function parseJsonCompletion(response: Response): Promise<CompletionResult> {
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

  return {
    content: content.trim(),
    streamed: false,
  };
}

async function parseStreamCompletion(
  response: Response,
  onToken?: (token: string) => void,
): Promise<CompletionResult> {
  if (!response.body || typeof response.body.getReader !== "function") {
    throw new LLMRequestError("当前运行环境不支持流式读取响应。");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let accumulated = "";

  const processEvent = (eventBlock: string) => {
    const dataLines = eventBlock
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);

    for (const dataLine of dataLines) {
      if (dataLine === "[DONE]") {
        return true;
      }

      let payload: CompletionResponse | null = null;
      try {
        payload = JSON.parse(dataLine) as CompletionResponse;
      } catch {
        continue;
      }

      if (payload.error?.message) {
        throw new LLMRequestError(payload.error.message);
      }

      const choice = payload.choices?.[0];
      const token =
        extractContentParts(choice?.delta?.content) || extractContentParts(choice?.message?.content);

      if (!token) {
        continue;
      }

      accumulated += token;
      onToken?.(token);
    }

    return false;
  };

  while (true) {
    const { done, value } = await (reader as any).read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let boundaryIndex = buffer.indexOf("\n\n");
    while (boundaryIndex !== -1) {
      const block = buffer.slice(0, boundaryIndex).trim();
      buffer = buffer.slice(boundaryIndex + 2);
      if (block && processEvent(block)) {
        return {
          content: accumulated.trim(),
          streamed: true,
        };
      }
      boundaryIndex = buffer.indexOf("\n\n");
    }

    if (done) {
      break;
    }
  }

  const tail = buffer.trim();
  if (tail) {
    processEvent(tail);
  }

  if (!accumulated.trim()) {
    throw new LLMRequestError("流式响应为空或格式不符合 SSE 规范。");
  }

  return {
    content: accumulated.trim(),
    streamed: true,
  };
}

export async function getCompletion(
  messages: ChatMessage[],
  options?: CompletionOptions,
): Promise<CompletionResult> {
  if (options?.onToken) {
    try {
      const streamResponse = await fetchWithTimeout(messages, true);
      if (!streamResponse.ok) {
        if (!isStreamUnsupportedStatus(streamResponse.status)) {
          await parseErrorResponse(streamResponse);
        }
      } else {
        const contentType = (streamResponse.headers.get("content-type") || "").toLowerCase();
        if (contentType.includes("text/event-stream")) {
          return await parseStreamCompletion(streamResponse, options.onToken);
        }
        return await parseJsonCompletion(streamResponse);
      }
    } catch (error) {
      if (error instanceof LLMRequestError && error.code === "timeout") {
        throw error;
      }
      if (
        error instanceof LLMRequestError &&
        error.status &&
        !isStreamUnsupportedStatus(error.status)
      ) {
        throw error;
      }
    }
  }

  const response = await fetchWithTimeout(messages, false);

  if (!response.ok) {
    await parseErrorResponse(response);
  }

  return await parseJsonCompletion(response);
}
