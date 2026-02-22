import { Input, Markup, Telegraf } from "telegraf";
import { Context } from "telegraf";
import { MessageRole } from "@prisma/client";
import { MemoryStore } from "./memory/store.js";
import { ConversationSummarizer } from "./memory/summarizer.js";
import { OpenRouterClient, OpenRouterMessage } from "./openrouter/client.js";
import { MODEL_LIST } from "./openrouter/models.js";
import {
  currentEventsDisclaimer,
  detectIntent,
  routeModel,
} from "./openrouter/router.js";
import { buildSystemPrompt } from "./openrouter/prompts.js";
import { TOOL_SCHEMAS, executeTool, shouldEnableTools } from "./tools/tools.js";
import { logger } from "./utils/logger.js";
import { chunkText } from "./utils/chunking.js";
import { DatabaseRateLimiter } from "./utils/rateLimit.js";
import { DbLockManager } from "./utils/locks.js";
import { isAbortError } from "./utils/errors.js";
import { formatProfessionalReply } from "./utils/responseFormat.js";

type BotBuildOptions = {
  token: string;
  store: MemoryStore;
  summarizer: ConversationSummarizer;
  openRouter: OpenRouterClient;
  rateLimiter: DatabaseRateLimiter;
  lockManager: DbLockManager;
  streamEditIntervalMs: number;
  maxInputChars: number;
  maxOutputTokens: number;
};

const RECENT_CONTEXT_MESSAGES = 12;
const TELEGRAM_CHUNK_LIMIT = 3500;
const REPLY_STICKER_IDS = (process.env.TG_STICKER_REPLY_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const REPLY_STICKER_PROBABILITY = Math.max(
  0,
  Math.min(1, Number(process.env.TG_STICKER_REPLY_PROBABILITY || "1")),
);
const MAX_CONTINUATION_ROUNDS = Math.max(
  0,
  Math.min(2, Number(process.env.MAX_CONTINUATION_ROUNDS || "1")),
);
const detailedPromptPattern =
  /\b(explain|detailed|detail|step by step|deep dive|comprehensive|teach|breakdown|why|how)\b/i;
const TYPEWRITER_FALLBACK_ENABLED =
  (process.env.TYPEWRITER_FALLBACK_ENABLED || "true").toLowerCase() !== "false";
const TYPEWRITER_CHARS_PER_TICK = Math.max(
  12,
  Math.min(220, Number(process.env.TYPEWRITER_CHARS_PER_TICK || "104")),
);
const TYPEWRITER_TICK_MS = Math.max(
  6,
  Math.min(80, Number(process.env.TYPEWRITER_TICK_MS || "8")),
);

type BotContext = Context;

const splitArgs = (raw: string): string[] =>
  raw
    .trim()
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

const getConversationKey = (ctx: BotContext): string | null => {
  if (!ctx.chat?.id) return null;
  const base = String(ctx.chat.id);
  const chatType = ctx.chat.type;
  const fromId = ctx.from?.id ? String(ctx.from.id) : "";

  if ((chatType === "group" || chatType === "supergroup") && fromId) {
    return `${base}:${fromId}`;
  }
  return base;
};

const getRateLimitKey = (ctx: BotContext): string | null => {
  if (ctx.from?.id) return `user:${ctx.from.id}`;
  const chatId = ctx.chat?.id;
  return chatId ? `chat:${chatId}` : null;
};

const moderateInput = (text: string): { blocked: boolean; reason?: string } => {
  const checks: Array<{ pattern: RegExp; reason: string }> = [
    {
      pattern:
        /\b(how to kill myself|how can i die|suicide method|self harm method)\b/i,
      reason:
        "I cannot help with self-harm instructions. I can help with support resources and safer coping steps.",
    },
    {
      pattern:
        /\b(build a bomb|make explosive|buy illegal drugs|credit card fraud|steal password|malware code)\b/i,
      reason:
        "I cannot help with illegal or harmful wrongdoing. I can help with legal and ethical alternatives.",
    },
  ];

  for (const check of checks) {
    if (check.pattern.test(text)) {
      return { blocked: true, reason: check.reason };
    }
  }
  return { blocked: false };
};

const memoryCommandPattern =
  /^\s*remember(?:\s+this|\s+that)?\s*:?\s+(.+)$/i;

const startTypingIndicator = (ctx: BotContext): (() => void) => {
  let active = true;
  const chatId = ctx.chat?.id;
  if (!chatId) return () => {};

  const send = (): void => {
    if (!active) return;
    ctx.telegram.sendChatAction(chatId, "typing").catch(() => {});
  };

  send();
  const timer = setInterval(send, 4000);
  return () => {
    active = false;
    clearInterval(timer);
  };
};

const createModelKeyboard = () => {
  const rows = [];
  const buttons = MODEL_LIST.map((model) =>
    Markup.button.callback(`${model.label}`, `model:${model.key}`),
  );
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  return Markup.inlineKeyboard(rows);
};

const createSettingsKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("Toggle concise/detailed", "settings:toggle-verbosity")],
    [Markup.button.callback("Reset chat", "action:reset")],
    [Markup.button.callback("Switch model", "action:switch-model")],
  ]);

const safeReplyText = async (
  ctx: BotContext,
  text: string,
): Promise<void> => {
  try {
    await ctx.reply(text, {
      link_preview_options: { is_disabled: true },
    });
  } catch {
    await ctx.reply(text).catch(() => {});
  }
};

const safeReplyAndGetMessageId = async (
  ctx: BotContext,
  text: string,
): Promise<number | null> => {
  try {
    const response = await ctx.reply(text, {
      link_preview_options: { is_disabled: true },
    });
    return (response as { message_id?: number })?.message_id ?? null;
  } catch {
    try {
      const response = await ctx.reply(text);
      return (response as { message_id?: number })?.message_id ?? null;
    } catch {
      return null;
    }
  }
};

const safeEditText = async (
  ctx: BotContext,
  messageId: number,
  text: string,
): Promise<void> => {
  try {
    await ctx.telegram.editMessageText(ctx.chat!.id, messageId, undefined, text, {
      link_preview_options: { is_disabled: true },
    });
  } catch {
    try {
      await ctx.telegram.editMessageText(ctx.chat!.id, messageId, undefined, text);
    } catch {}
  }
};

const sendReplySticker = async (ctx: BotContext): Promise<void> => {
  if (REPLY_STICKER_IDS.length > 0) {
    const stickerId =
      REPLY_STICKER_IDS[Math.floor(Math.random() * REPLY_STICKER_IDS.length)];
    await ctx.replyWithSticker(stickerId).catch(() => {});
    return;
  }
  await ctx.replyWithDice({ emoji: "🎯" }).catch(() => {});
};

const simulateStreaming = async (
  text: string,
  signal: AbortSignal | undefined,
  onDelta: (value: string) => Promise<void>,
): Promise<void> => {
  const chunks = text.match(/.{1,72}/g) ?? [text];
  for (const chunk of chunks) {
    if (signal?.aborted) {
      throw new Error("aborted");
    }
    await onDelta(chunk);
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
};

const runTypewriterEdit = async (
  ctx: BotContext,
  messageId: number,
  text: string,
  signal?: AbortSignal,
): Promise<void> => {
  const full = text.trim();
  if (!full) {
    await safeEditText(ctx, messageId, text);
    return;
  }

  let cursor = 0;
  while (cursor < full.length) {
    if (signal?.aborted) {
      throw new Error("aborted");
    }
    cursor = Math.min(full.length, cursor + TYPEWRITER_CHARS_PER_TICK);
    await safeEditText(ctx, messageId, full.slice(0, cursor));
    if (cursor < full.length) {
      await new Promise((resolve) => setTimeout(resolve, TYPEWRITER_TICK_MS));
    }
  }
};

type StatusError = Error & { status?: number };

const extractErrorStatus = (error: unknown): number | null => {
  const status = (error as StatusError | undefined)?.status;
  return typeof status === "number" ? status : null;
};

const describeGenerationError = (error: unknown): string => {
  const status = extractErrorStatus(error);
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (status === 401 || status === 403 || normalized.includes("unauthorized")) {
    return "OpenRouter authentication failed. Please update OPENROUTER_API_KEY in Railway and redeploy.";
  }
  if (
    status === 402 ||
    normalized.includes("insufficient credits") ||
    normalized.includes("insufficient_quota") ||
    normalized.includes("payment required") ||
    normalized.includes("billing")
  ) {
    return "OpenRouter credits are insufficient. Please add credits or switch to a free model, then try again.";
  }
  if (status === 429 || normalized.includes("rate limit")) {
    return "OpenRouter rate limit is active right now. Please wait 30-60 seconds and retry.";
  }
  if (
    normalized.includes("fetch failed") ||
    normalized.includes("network") ||
    normalized.includes("enotfound") ||
    normalized.includes("econnreset")
  ) {
    return "Network issue while contacting OpenRouter. Please retry in a moment.";
  }
  return "I could not reach the selected AI model right now. Please try /model auto and send your message again.";
};

const parseModelCsv = (csv: string): string[] =>
  csv
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

const buildModelAttempts = (primaryModelId: string, fallbackModelId: string): string[] => {
  const fromEnvPool = parseModelCsv(
    (process.env.OPENROUTER_FALLBACK_MODELS || process.env.OPENROUTER_MODELS || "").trim(),
  );
  const ordered = [
    primaryModelId,
    fallbackModelId,
    (process.env.DEFAULT_MODEL || "").trim(),
    "openrouter/free",
    ...fromEnvPool,
  ].filter(Boolean);

  const unique: string[] = [];
  for (const modelId of ordered) {
    if (!unique.includes(modelId)) {
      unique.push(modelId);
    }
  }
  return unique;
};

const computeResponseTokenLimit = (
  inputText: string,
  routeMaxTokens: number,
  globalMaxTokens: number,
  verbosity: "concise" | "normal" | "detailed",
): number => {
  const base = Math.min(routeMaxTokens, globalMaxTokens);
  const isDetailedRequest = verbosity === "detailed" || detailedPromptPattern.test(inputText);
  const isShortPrompt = inputText.trim().length < 80 && !isDetailedRequest;

  if (isShortPrompt) {
    return Math.max(260, Math.min(base, 560));
  }

  if (isDetailedRequest) {
    return Math.min(globalMaxTokens, Math.max(base, Math.min(2000, globalMaxTokens)));
  }

  return base;
};

export const buildBot = (options: BotBuildOptions): Telegraf<BotContext> => {
  const bot = new Telegraf<BotContext>(options.token);
  const activeStreams = new Map<string, AbortController>();

  const ensureChat = async (ctx: BotContext) => {
    const conversationKey = getConversationKey(ctx);
    if (!conversationKey) return null;
    const chat = await options.store.getOrCreateChat(conversationKey);
    return { conversationKey, chat };
  };

  const withRateLimit = async (ctx: BotContext): Promise<boolean> => {
    const key = getRateLimitKey(ctx);
    if (!key) return true;

    const result = await options.rateLimiter.consume(key);
    if (result.allowed) return true;

    const seconds = Math.max(
      Math.ceil((result.resetAt.getTime() - Date.now()) / 1000),
      1,
    );
    await ctx.reply(
      `Rate limit reached. Please wait ~${seconds}s and try again.`,
    );
    return false;
  };

  const stopActiveStream = async (conversationKey: string): Promise<boolean> => {
    const controller = activeStreams.get(conversationKey);
    if (!controller) return false;
    controller.abort();
    activeStreams.delete(conversationKey);
    return true;
  };

  const handleReset = async (ctx: BotContext): Promise<void> => {
    const chatInfo = await ensureChat(ctx);
    if (!chatInfo) return;
    await options.store.clearChat(chatInfo.chat.id);
    await ctx.reply("Conversation reset for this chat context.");
  };

  const handleModelCommand = async (ctx: BotContext): Promise<void> => {
    const chatInfo = await ensureChat(ctx);
    if (!chatInfo || !("text" in ctx.message!)) return;

    const text = ctx.message.text;
    const args = splitArgs(text.replace(/^\/model(@\w+)?/i, ""));
    if (args.length > 0) {
      const requested = args[0].toLowerCase();
      const match = MODEL_LIST.find((model) => model.key === requested);
      if (!match) {
        await ctx.reply(
          `Unknown model "${requested}". Use one of: ${MODEL_LIST.map((model) => model.key).join(", ")}`,
        );
        return;
      }
      const updated = await options.store.updateSettings(chatInfo.chat.id, {
        currentModel: match.key,
      });
      await ctx.reply(
        `Model set to ${match.label} (${match.id}). Current selection key: ${updated.currentModel}`,
      );
      return;
    }

    const refreshed = await options.store.refreshChat(chatInfo.chat.id);
    const current = refreshed?.currentModel ?? chatInfo.chat.currentModel;
    await ctx.reply(
      `Current model selection: ${current}\nChoose from the list below:`,
      createModelKeyboard(),
    );
  };

  const handleSettingsCommand = async (ctx: BotContext): Promise<void> => {
    const chatInfo = await ensureChat(ctx);
    if (!chatInfo || !("text" in ctx.message!)) return;
    const text = ctx.message.text;
    const args = splitArgs(text.replace(/^\/settings(@\w+)?/i, ""));

    if (args.length === 0) {
      const refreshed = await options.store.refreshChat(chatInfo.chat.id);
      const current = refreshed ?? chatInfo.chat;
      await ctx.reply(
        [
          "Settings:",
          `- model: ${current.currentModel}`,
          `- temperature: ${current.temperature}`,
          `- verbosity: ${current.verbosity}`,
          `- style: ${current.stylePrompt || "(default)"}`,
          "",
          "Examples:",
          "/settings temperature 0.3",
          "/settings verbosity concise",
          "/settings style answer in product-manager style",
        ].join("\n"),
        createSettingsKeyboard(),
      );
      return;
    }

    const key = args[0].toLowerCase();
    if (key === "temperature") {
      const next = Number(args[1]);
      if (!Number.isFinite(next) || next < 0 || next > 2) {
        await ctx.reply("Temperature must be between 0 and 2.");
        return;
      }
      const updated = await options.store.updateSettings(chatInfo.chat.id, {
        temperature: next,
      });
      await ctx.reply(`Temperature updated to ${updated.temperature}.`);
      return;
    }

    if (key === "verbosity") {
      const next = (args[1] || "").toLowerCase();
      if (!["concise", "normal", "detailed"].includes(next)) {
        await ctx.reply("Verbosity must be one of: concise, normal, detailed.");
        return;
      }
      const updated = await options.store.updateSettings(chatInfo.chat.id, {
        verbosity: next as "concise" | "normal" | "detailed",
      });
      await ctx.reply(`Verbosity updated to ${updated.verbosity}.`);
      return;
    }

    if (key === "style") {
      const style = text
        .replace(/^\/settings(@\w+)?/i, "")
        .trim()
        .replace(/^style\s+/i, "")
        .trim();
      if (!style) {
        await ctx.reply("Provide a style text after /settings style.");
        return;
      }
      const updated = await options.store.updateSettings(chatInfo.chat.id, {
        stylePrompt: style.slice(0, 500),
      });
      await ctx.reply(`Style prompt updated: ${updated.stylePrompt}`);
      return;
    }

    if (key === "reset_style") {
      await options.store.updateSettings(chatInfo.chat.id, {
        stylePrompt: null,
      });
      await ctx.reply("Custom style has been cleared.");
      return;
    }

    await ctx.reply("Unknown setting. Use /settings for available options.");
  };

  const handleExport = async (ctx: BotContext): Promise<void> => {
    const chatInfo = await ensureChat(ctx);
    if (!chatInfo) return;
    const exported = await options.store.exportConversation(chatInfo.chat.id);

    const txt = [
      `Chat: ${exported.chat?.telegramChatId ?? "unknown"}`,
      `Model: ${exported.chat?.currentModel ?? "unknown"}`,
      `Verbosity: ${exported.chat?.verbosity ?? "normal"}`,
      "",
      "Memories:",
      ...(exported.memories.length
        ? exported.memories.map(
            (memory) => `- ${memory.key}: ${memory.value} (${memory.updatedAt.toISOString()})`,
          )
        : ["(none)"]),
      "",
      "Messages:",
      ...exported.messages.map(
        (message) =>
          `[${message.createdAt.toISOString()}] ${message.role}${message.name ? `(${message.name})` : ""}: ${message.content}`,
      ),
      "",
    ].join("\n");

    const json = JSON.stringify(exported, null, 2);

    await ctx.replyWithDocument(
      Input.fromBuffer(Buffer.from(txt, "utf8"), "conversation.txt"),
    );
    await ctx.replyWithDocument(
      Input.fromBuffer(Buffer.from(json, "utf8"), "conversation.json"),
    );
  };

  const generateReply = async (
    ctx: BotContext,
    text: string,
    forceVision = false,
  ): Promise<void> => {
    const chatInfo = await ensureChat(ctx);
    if (!chatInfo) return;

    const rateAllowed = await withRateLimit(ctx);
    if (!rateAllowed) return;

    const moderation = moderateInput(text);
    if (moderation.blocked) {
      await ctx.reply(moderation.reason!);
      return;
    }

    const trimmedInput = text.trim().slice(0, options.maxInputChars);
    if (!trimmedInput) return;

    await options.lockManager.withChatLock(chatInfo.chat.id, async () => {
      const rememberMatch = trimmedInput.match(memoryCommandPattern);
      if (rememberMatch) {
        const memoryText = rememberMatch[1].trim().slice(0, 600);
        const memoryKey = `memory_${Date.now()}`;
        await options.store.upsertMemory(chatInfo.chat.id, memoryKey, memoryText);
        await options.store.appendMessage(chatInfo.chat.id, {
          role: MessageRole.USER,
          content: trimmedInput,
        });
        await options.store.appendMessage(chatInfo.chat.id, {
          role: MessageRole.ASSISTANT,
          content: `Saved to memory: ${memoryText}`,
        });
        await ctx.reply("Saved. I will remember that for future responses.");
        return;
      }

      await options.store.appendMessage(chatInfo.chat.id, {
        role: MessageRole.USER,
        content: trimmedInput,
      });

      const refreshedBefore = await options.store.refreshChat(chatInfo.chat.id);
      const currentChat = refreshedBefore ?? chatInfo.chat;

      const memories = await options.store.getMemories(chatInfo.chat.id);
      const recentMessages = await options.store.getRecentMessages(
        chatInfo.chat.id,
        RECENT_CONTEXT_MESSAGES,
      );
      const intent = forceVision ? "general" : detectIntent(trimmedInput);

      if (intent === "ambiguous_python") {
        const clarification =
          "Do you mean Python programming or Monty Python? If programming, tell me your current level and goal, and I will start a learning path.";
        await options.store.appendMessage(chatInfo.chat.id, {
          role: MessageRole.ASSISTANT,
          content: clarification,
        });
        await ctx.reply(clarification);
        return;
      }

      const route = routeModel(currentChat.currentModel, intent);
      const modelOverride = forceVision ? "vision" : currentChat.currentModel;
      if (forceVision && modelOverride === "vision") {
        const vision = MODEL_LIST.find((model) => model.key === "vision");
        if (vision) {
          route.modelId = vision.id;
          route.modelKey = vision.key;
        }
      }

      const systemPrompt = buildSystemPrompt({
        verbosity: currentChat.verbosity,
        customStyle: currentChat.stylePrompt,
        memories,
        currentEventsMode: intent === "current_events",
      });

      const messages: OpenRouterMessage[] = [
        { role: "system", content: systemPrompt },
      ];

      if (currentChat.summaryText?.trim()) {
        messages.push({
          role: "system",
          content: `Conversation summary:\n${currentChat.summaryText}`,
        });
      }

      if (intent === "current_events") {
        messages.push({
          role: "system",
          content: currentEventsDisclaimer,
        });
      }

      messages.push(...recentMessages);

      const typingStop = startTypingIndicator(ctx);
      const placeholder = await ctx.reply("Thinking...");
      let outputBuffer = "";
      let lastEditAt = 0;
      let finalized = false;
      let stopped = false;
      let sawLiveDelta = false;
      let flushInFlight = false;
      let flushQueued = false;
      let activeModelId = route.modelId;
      const fallbackModelId = (
        process.env.FALLBACK_MODEL ||
        process.env.DEFAULT_MODEL ||
        "openrouter/free"
      ).trim();
      const responseTokenLimit = computeResponseTokenLimit(
        trimmedInput,
        route.maxTokens,
        options.maxOutputTokens,
        currentChat.verbosity,
      );
      let wasTruncatedByTokens = false;
      const markIfTruncated = (finishReason: string | null | undefined): void => {
        if ((finishReason || "").toLowerCase() === "length") {
          wasTruncatedByTokens = true;
        }
      };

      const callWithFallback = async <T>(
        operation: (modelId: string) => Promise<T>,
      ): Promise<T> => {
        const attempts = buildModelAttempts(activeModelId, fallbackModelId);
        let lastError: unknown;

        for (const modelId of attempts) {
          try {
            activeModelId = modelId;
            return await operation(modelId);
          } catch (error) {
            if (isAbortError(error)) {
              throw error;
            }

            lastError = error;
            const status = extractErrorStatus(error);
            logger.warn(
              {
                modelId,
                status,
                error: error instanceof Error ? error.message : String(error),
              },
              "Model attempt failed",
            );

            // Auth/billing errors are account-level, trying more models will not help.
            if (status === 401 || status === 402 || status === 403) {
              break;
            }
          }
        }

        throw lastError instanceof Error ? lastError : new Error(String(lastError));
      };

      const flush = async (force = false): Promise<void> => {
        if (finalized) return;
        const now = Date.now();
        const preview = outputBuffer.slice(0, TELEGRAM_CHUNK_LIMIT);
        if (!preview.trim()) return;
        if (!force && now - lastEditAt < options.streamEditIntervalMs) {
          flushQueued = true;
          return;
        }
        if (flushInFlight) {
          flushQueued = true;
          return;
        }
        flushInFlight = true;
        lastEditAt = now;
        await safeEditText(ctx, placeholder.message_id, preview);
        flushInFlight = false;
        if (flushQueued && !finalized) {
          flushQueued = false;
          void flush(false);
        }
      };

      const waitForFlushIdle = async (): Promise<void> => {
        let guard = 0;
        while (flushInFlight && guard < 24) {
          await new Promise((resolve) => setTimeout(resolve, 15));
          guard += 1;
        }
      };

      const controller = new AbortController();
      const conversationKey = chatInfo.conversationKey;
      const previous = activeStreams.get(conversationKey);
      if (previous) previous.abort();
      activeStreams.set(conversationKey, controller);

      try {
        const useTools = shouldEnableTools(trimmedInput);
        let messagesForFinal = [...messages];
        let precomputedText: string | null = null;

        if (useTools) {
          for (let round = 0; round < 2; round += 1) {
            const decision = await callWithFallback((modelId) =>
              options.openRouter.chatCompletion(
                {
                  model: modelId,
                  messages: messagesForFinal,
                  temperature: route.temperature,
                  max_tokens: Math.min(responseTokenLimit, 900),
                  tools: TOOL_SCHEMAS,
                  tool_choice: "auto",
                },
                { signal: controller.signal },
              ),
            );
            markIfTruncated(decision.finishReason);

            if (!decision.toolCalls.length) {
              precomputedText = decision.content || null;
              break;
            }

            const assistantToolMessage: OpenRouterMessage = {
              role: "assistant",
              content: decision.content || "",
              tool_calls: decision.toolCalls,
            };
            messagesForFinal.push(assistantToolMessage);
            await options.store.appendMessage(chatInfo.chat.id, {
              role: MessageRole.ASSISTANT,
              content:
                decision.content ||
                `[tool-calls] ${decision.toolCalls.map((toolCall) => toolCall.function.name).join(", ")}`,
            });

            for (const toolCall of decision.toolCalls) {
              const executed = await executeTool(
                toolCall.function.name,
                toolCall.function.arguments,
              );

              logger.info(
                {
                  chatId: chatInfo.chat.id,
                  tool: executed.name,
                  input: executed.input,
                  output: executed.output,
                },
                "Tool execution",
              );

              messagesForFinal.push({
                role: "tool",
                name: toolCall.function.name,
                tool_call_id: toolCall.id,
                content: executed.output,
              });

              await options.store.appendMessage(chatInfo.chat.id, {
                role: MessageRole.TOOL,
                name: toolCall.function.name,
                toolCallId: toolCall.id,
                content: executed.output,
              });
            }
          }
        }

        if (precomputedText) {
          await simulateStreaming(precomputedText, controller.signal, async (delta) => {
            sawLiveDelta = true;
            outputBuffer += delta;
            void flush(false);
          });
        } else {
          const streamResult = await callWithFallback((modelId) =>
            options.openRouter.streamChatCompletion(
                {
                  model: modelId,
                  messages: messagesForFinal,
                  temperature: currentChat.temperature ?? route.temperature,
                  max_tokens: responseTokenLimit,
                },
              {
                signal: controller.signal,
                onDelta: (delta) => {
                  sawLiveDelta = true;
                  outputBuffer += delta;
                  void flush(false);
                },
              },
            ),
          );
          markIfTruncated(streamResult.finishReason);

          if (!outputBuffer.trim() && streamResult.text.trim()) {
            outputBuffer = streamResult.text;
          }

          // Fallback path for providers that fail to deliver usable streaming chunks.
          if (!outputBuffer.trim()) {
            const backupResult = await callWithFallback((modelId) =>
              options.openRouter.chatCompletion(
                {
                  model: modelId,
                  messages: messagesForFinal,
                  temperature: currentChat.temperature ?? route.temperature,
                  max_tokens: responseTokenLimit,
                },
                { signal: controller.signal },
              ),
            );
            markIfTruncated(backupResult.finishReason);
            if (backupResult.content.trim()) {
              outputBuffer = backupResult.content;
            }
          }
        }

        if (!stopped && wasTruncatedByTokens && outputBuffer.trim()) {
          for (let round = 0; round < MAX_CONTINUATION_ROUNDS; round += 1) {
            const assistantTail = outputBuffer.slice(-2200);
            const continuation = await callWithFallback((modelId) =>
              options.openRouter.chatCompletion(
                {
                  model: modelId,
                  messages: [
                    ...messagesForFinal,
                    { role: "assistant", content: assistantTail },
                    {
                      role: "user",
                      content:
                        "Continue from where your previous answer stopped. Do not repeat earlier content. Finish the remaining points and end cleanly.",
                    },
                  ],
                  temperature: currentChat.temperature ?? route.temperature,
                  max_tokens: Math.min(responseTokenLimit, 900),
                },
                { signal: controller.signal },
              ),
            );

            const tail = continuation.content.trim();
            if (!tail || outputBuffer.includes(tail)) {
              break;
            }

            outputBuffer = `${outputBuffer.trimEnd()}\n${tail}`.trim();
            wasTruncatedByTokens = (continuation.finishReason || "").toLowerCase() === "length";
            if (!wasTruncatedByTokens) {
              break;
            }
          }
        }
      } catch (error) {
        if (isAbortError(error)) {
          stopped = true;
        } else {
          const status = extractErrorStatus(error);
          logger.error(
            {
              error: error instanceof Error ? error.stack : String(error),
              status,
              model: activeModelId,
            },
            "Model generation failed",
          );
          outputBuffer = describeGenerationError(error);
        }
      } finally {
        typingStop();
        if (activeStreams.get(conversationKey) === controller) {
          activeStreams.delete(conversationKey);
        }
      }

      if (stopped) {
        outputBuffer = `${outputBuffer.trim()}\n\n[stopped]`.trim();
      }
      if (!outputBuffer.trim()) {
        outputBuffer =
          "I hit an issue generating a reply. Please try again in a moment.";
      }

      outputBuffer = formatProfessionalReply(outputBuffer);

      const chunks = chunkText(outputBuffer, TELEGRAM_CHUNK_LIMIT);
      if (chunks.length === 0) {
        chunks.push(outputBuffer);
      }

      finalized = true;
      await waitForFlushIdle();

      if (TYPEWRITER_FALLBACK_ENABLED && !sawLiveDelta) {
        await runTypewriterEdit(ctx, placeholder.message_id, chunks[0], controller.signal);
        for (let i = 1; i < chunks.length; i += 1) {
          const messageId = await safeReplyAndGetMessageId(ctx, "...");
          if (messageId) {
            await runTypewriterEdit(ctx, messageId, chunks[i], controller.signal);
          } else {
            await safeReplyText(ctx, chunks[i]);
          }
        }
      } else {
        await safeEditText(ctx, placeholder.message_id, chunks[0]);
        for (let i = 1; i < chunks.length; i += 1) {
          await safeReplyText(ctx, chunks[i]);
        }
      }

      const shouldSendSticker =
        !/issue generating a reply/i.test(outputBuffer) &&
        Math.random() < REPLY_STICKER_PROBABILITY;
      if (shouldSendSticker) {
        await sendReplySticker(ctx);
      }

      await options.store.appendMessage(chatInfo.chat.id, {
        role: MessageRole.ASSISTANT,
        content: outputBuffer,
      });

      // Run summary update after user-visible response is already delivered.
      void options.store
        .refreshChat(chatInfo.chat.id)
        .then((refreshed) => {
          if (!refreshed) return;
          return options.summarizer.summarizeIfNeeded(refreshed);
        })
        .catch((error) => {
          logger.warn(
            { chatId: chatInfo.chat.id, error: error instanceof Error ? error.message : String(error) },
            "Post-response summarization failed",
          );
        });
    });
  };

  bot.start(async (ctx) => {
    await ctx.reply(
      [
        "Welcome. I am your ChatGPT-style Telegram assistant powered by OpenRouter.",
        "",
        "Quick tips:",
        "- Ask coding, math, writing, planning, interview, and research-style questions.",
        "- Use /model to switch models or keep auto-routing.",
        "- Use /settings to change temperature and verbosity.",
        "- Use /reset to clear this conversation memory.",
        "- Use /stop to stop an in-progress response.",
      ].join("\n"),
      Markup.inlineKeyboard([
        [Markup.button.callback("Reset chat", "action:reset")],
        [Markup.button.callback("Switch model", "action:switch-model")],
        [Markup.button.callback("Toggle concise/detailed", "settings:toggle-verbosity")],
      ]),
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      [
        "Commands:",
        "/start - onboarding",
        "/help - this help message",
        "/reset - clear chat history for this chat context",
        "/model [auto|fast|smart|code|math|vision] - model selection",
        "/settings - view or update settings",
        "/export - export this conversation as txt/json",
        "/stop - stop active streaming response",
        "",
        "Examples:",
        "- /settings temperature 0.2",
        "- /settings verbosity detailed",
        "- /model code",
      ].join("\n"),
    );
  });

  bot.command("reset", async (ctx) => {
    await handleReset(ctx);
  });

  bot.command("model", async (ctx) => {
    await handleModelCommand(ctx);
  });

  bot.command("settings", async (ctx) => {
    await handleSettingsCommand(ctx);
  });

  bot.command("export", async (ctx) => {
    await handleExport(ctx);
  });

  bot.command("stop", async (ctx) => {
    const conversationKey = getConversationKey(ctx);
    if (!conversationKey) return;
    const stopped = await stopActiveStream(conversationKey);
    await ctx.reply(stopped ? "Stopped current response." : "No active stream to stop.");
  });

  bot.on("callback_query", async (ctx) => {
    if (!("data" in ctx.callbackQuery)) return;
    const data = ctx.callbackQuery.data;
    const chatInfo = await ensureChat(ctx);
    if (!chatInfo) return;

    if (data === "action:reset") {
      await options.store.clearChat(chatInfo.chat.id);
      await ctx.answerCbQuery("Chat reset.");
      await ctx.reply("Conversation reset.");
      return;
    }

    if (data === "action:switch-model") {
      await ctx.answerCbQuery();
      await ctx.reply("Choose model:", createModelKeyboard());
      return;
    }

    if (data === "settings:toggle-verbosity") {
      const current = (await options.store.refreshChat(chatInfo.chat.id)) ?? chatInfo.chat;
      const next =
        current.verbosity === "concise"
          ? "detailed"
          : current.verbosity === "detailed"
            ? "normal"
            : "concise";
      const updated = await options.store.updateSettings(chatInfo.chat.id, {
        verbosity: next,
      });
      await ctx.answerCbQuery(`Verbosity: ${updated.verbosity}`);
      await ctx.reply(`Verbosity changed to ${updated.verbosity}.`);
      return;
    }

    if (data.startsWith("model:")) {
      const key = data.slice("model:".length).trim().toLowerCase();
      const match = MODEL_LIST.find((model) => model.key === key);
      if (!match) {
        await ctx.answerCbQuery("Unknown model");
        return;
      }
      await options.store.updateSettings(chatInfo.chat.id, {
        currentModel: match.key,
      });
      await ctx.answerCbQuery(`Model: ${match.label}`);
      await ctx.reply(`Model switched to ${match.label} (${match.id}).`);
      return;
    }

    await ctx.answerCbQuery();
  });

  bot.on("text", async (ctx) => {
    if (!ctx.message?.text) return;
    if (ctx.message.text.startsWith("/")) return;

    try {
      await generateReply(ctx, ctx.message.text);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.stack : String(error) },
        "Failed to handle text message",
      );
      await ctx.reply(
        "Sorry, something went wrong while processing your message. Please try again.",
      );
    }
  });

  bot.on("photo", async (ctx) => {
    try {
      const caption = ctx.message.caption || "Please analyze this image.";
      const proxyText = `[image]\n${caption}`;
      await generateReply(ctx, proxyText, true);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.stack : String(error) },
        "Failed to handle photo message",
      );
      await ctx.reply("I could not process this image right now.");
    }
  });

  bot.catch((error) => {
    logger.error(
      { error: error instanceof Error ? error.stack : String(error) },
      "Telegraf global error",
    );
  });

  return bot;
};
