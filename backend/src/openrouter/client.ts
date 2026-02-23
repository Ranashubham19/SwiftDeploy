import { logger } from "../utils/logger.js";
import type { ToolSchema } from "../tools/tools.js";

export type OpenRouterToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type OpenRouterMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenRouterToolCall[];
};

export type ChatCompletionParams = {
  model: string;
  messages: OpenRouterMessage[];
  temperature: number;
  max_tokens: number;
  stream?: boolean;
  tools?: ToolSchema[];
  tool_choice?: "none" | "auto";
};

type ChatCompletionApiResponse = {
  id: string;
  model: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  choices: Array<{
    finish_reason?: string;
    message: {
      role: "assistant";
      content?: string;
      tool_calls?: OpenRouterToolCall[];
    };
    delta?: {
      content?: string | Array<{ type?: string; text?: string }>;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: "function";
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
};

export type ChatCompletionResult = {
  id: string;
  model: string;
  content: string;
  finishReason: string | null;
  toolCalls: OpenRouterToolCall[];
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
};

export type StreamCompletionOptions = {
  signal?: AbortSignal;
  onDelta?: (delta: string) => Promise<void> | void;
};

export type StreamCompletionResult = {
  text: string;
  finishReason: string | null;
  toolCalls: OpenRouterToolCall[];
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
};

type OpenRouterClientConfig = {
  apiKey: string;
  baseUrl: string;
  appUrl?: string;
  title?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
};

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const DEFAULT_OPENROUTER_BASE = "https://openrouter.ai/api/v1";

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const normalizeEndpoint = (baseUrl: string): string => {
  const raw = baseUrl.trim();
  const withProtocol = /^https?:\/\//i.test(raw)
    ? raw
    : `${DEFAULT_OPENROUTER_BASE}`;
  const trimmed = withProtocol.replace(/\/+$/, "");
  const candidate = trimmed.endsWith("/chat/completions")
    ? trimmed
    : `${trimmed}/chat/completions`;

  try {
    return new URL(candidate).toString();
  } catch {
    return `${DEFAULT_OPENROUTER_BASE}/chat/completions`;
  }
};

const parseUsage = (
  usage: ChatCompletionApiResponse["usage"] | undefined,
): ChatCompletionResult["usage"] => {
  if (!usage) return undefined;
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
};

const extractDeltaText = (
  content: string | Array<{ type?: string; text?: string }> | undefined,
): string => {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .map((part) => {
      if (typeof part?.text === "string") return part.text;
      return "";
    })
    .join("");
};

export class OpenRouterClient {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;

  public constructor(private readonly config: OpenRouterClientConfig) {
    this.endpoint = normalizeEndpoint(config.baseUrl);
    this.timeoutMs = config.timeoutMs ?? 45_000;
    this.maxRetries = config.maxRetries ?? 4;
    this.retryBaseDelayMs = config.retryBaseDelayMs ?? 300;
  }

  public async chatCompletion(
    params: ChatCompletionParams,
    options?: { signal?: AbortSignal },
  ): Promise<ChatCompletionResult> {
    const payload = {
      ...params,
      stream: false,
    };

    const body = await this.requestJson<ChatCompletionApiResponse>(payload, options);
    const choice = body.choices?.[0];
    const message = choice?.message;

    return {
      id: body.id,
      model: body.model,
      content: message?.content ?? "",
      finishReason: choice?.finish_reason ?? null,
      toolCalls: message?.tool_calls ?? [],
      usage: parseUsage(body.usage),
    };
  }

  public async streamChatCompletion(
    params: ChatCompletionParams,
    options: StreamCompletionOptions = {},
  ): Promise<StreamCompletionResult> {
    const payload = {
      ...params,
      stream: true,
    };

    const result = await this.requestStream(payload, options);
    return result;
  }

  private async requestJson<T>(
    payload: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<T> {
    return this.withRetry(async () => {
      const response = await this.fetchWithTimeout(payload, options?.signal);
      const raw = await response.text();
      const body = raw ? (JSON.parse(raw) as T & { error?: { message?: string } }) : ({} as T);

      if (!response.ok) {
        const message =
          (body as { error?: { message?: string } }).error?.message ??
          `OpenRouter request failed with status ${response.status}`;
        const error = new Error(message) as Error & { status?: number };
        error.status = response.status;
        throw error;
      }

      return body as T;
    }, options?.signal);
  }

  private async requestStream(
    payload: Record<string, unknown>,
    options: StreamCompletionOptions,
  ): Promise<StreamCompletionResult> {
    return this.withRetry(async () => {
      const response = await this.fetchWithTimeout(payload, options.signal);
      if (!response.ok) {
        const raw = await response.text();
        let message = `OpenRouter stream failed with status ${response.status}`;
        try {
          const parsed = raw ? (JSON.parse(raw) as { error?: { message?: string } }) : {};
          if (parsed.error?.message) message = parsed.error.message;
        } catch {}
        const error = new Error(message) as Error & { status?: number };
        error.status = response.status;
        throw error;
      }

      if (!response.body) {
        throw new Error("OpenRouter stream returned empty body.");
      }

      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      let buffer = "";
      let text = "";
      // Some providers return cumulative final text in `message.content` instead of `delta.content`.
      let messageSnapshot = "";
      let finishReason: string | null = null;
      let usage: StreamCompletionResult["usage"] | undefined;
      const toolCallsByIndex = new Map<number, OpenRouterToolCall>();
      const emitDelta = (delta: string): void => {
        if (!options.onDelta || !delta) return;
        try {
          const maybePromise = options.onDelta(delta);
          if (maybePromise && typeof (maybePromise as Promise<void>).then === "function") {
            void (maybePromise as Promise<void>).catch(() => {});
          }
        } catch {}
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const lines = chunk
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim());

          for (const line of lines) {
            if (!line || line === "[DONE]") continue;

            let payloadChunk: ChatCompletionApiResponse;
            try {
              payloadChunk = JSON.parse(line) as ChatCompletionApiResponse;
            } catch {
              continue;
            }

            const choice = payloadChunk.choices?.[0];
            if (!choice) continue;

            if (choice.finish_reason) {
              finishReason = choice.finish_reason;
            }

            if (payloadChunk.usage) {
              usage = parseUsage(payloadChunk.usage);
            }

            const deltaText = extractDeltaText(choice.delta?.content);
            if (deltaText) {
              text += deltaText;
              emitDelta(deltaText);
            } else if (typeof choice.message?.content === "string") {
              const messageText = choice.message.content;
              if (messageText.length > messageSnapshot.length) {
                const incrementalText = messageText.startsWith(messageSnapshot)
                  ? messageText.slice(messageSnapshot.length)
                  : messageText;
                messageSnapshot = messageText;
                if (incrementalText) {
                  text += incrementalText;
                  emitDelta(incrementalText);
                }
              }
            }

            for (const toolDelta of choice.delta?.tool_calls ?? []) {
              const index = toolDelta.index ?? 0;
              const existing = toolCallsByIndex.get(index) ?? {
                id: "",
                type: "function" as const,
                function: {
                  name: "",
                  arguments: "",
                },
              };

              if (toolDelta.id) existing.id = toolDelta.id;
              if (toolDelta.function?.name) {
                existing.function.name += toolDelta.function.name;
              }
              if (toolDelta.function?.arguments) {
                existing.function.arguments += toolDelta.function.arguments;
              }
              toolCallsByIndex.set(index, existing);
            }
          }
        }
      }

      const toolCalls = Array.from(toolCallsByIndex.entries())
        .sort((a, b) => a[0] - b[0])
        .map((entry) => entry[1]);

      return {
        text,
        finishReason,
        toolCalls,
        usage,
      };
    }, options.signal);
  }

  private async withRetry<T>(
    operation: (attempt: number) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (signal?.aborted) {
        const abortError = new Error("OpenRouter request aborted.") as Error & {
          name: string;
        };
        abortError.name = "AbortError";
        throw abortError;
      }

      try {
        return await operation(attempt);
      } catch (error) {
        lastError = error;
        const status = (error as { status?: number })?.status;
        const retryable =
          typeof status === "number" && RETRYABLE_STATUSES.has(status);

        if (!retryable || attempt >= this.maxRetries) {
          throw error;
        }

        const delay =
          Math.min(4000, this.retryBaseDelayMs * 2 ** attempt) + Math.random() * 120;
        logger.warn(
          { attempt, status, delay, error: String((error as Error)?.message ?? error) },
          "OpenRouter request failed, retrying",
        );
        await sleep(delay);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async fetchWithTimeout(
    payload: Record<string, unknown>,
    parentSignal?: AbortSignal,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const onParentAbort = (): void => {
      controller.abort();
    };

    if (parentSignal) {
      parentSignal.addEventListener("abort", onParentAbort, { once: true });
    }

    try {
      return await fetch(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": this.config.appUrl || "https://localhost",
          "X-Title": this.config.title || "Telegram Chat Bot",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
      if (parentSignal) {
        parentSignal.removeEventListener("abort", onParentAbort);
      }
    }
  }
}
