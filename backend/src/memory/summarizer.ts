import { MemoryStore, type ChatSettings } from "./store.js";
import { OpenRouterClient } from "../openrouter/client.js";
import { SUMMARY_PROMPT } from "../openrouter/prompts.js";
import { MODEL_REGISTRY } from "../openrouter/models.js";
import { logger } from "../utils/logger.js";

type ConversationSummarizerOptions = {
  keepLastMessages?: number;
  minNewMessagesToSummarize?: number;
};

export class ConversationSummarizer {
  private readonly keepLastMessages: number;
  private readonly minNewMessagesToSummarize: number;

  public constructor(
    private readonly store: MemoryStore,
    private readonly client: OpenRouterClient,
    options?: ConversationSummarizerOptions,
  ) {
    this.keepLastMessages = options?.keepLastMessages ?? 12;
    this.minNewMessagesToSummarize = options?.minNewMessagesToSummarize ?? 8;
  }

  public async summarizeIfNeeded(chat: ChatSettings): Promise<void> {
    const allMessages = await this.store.getAllMessages(chat.id);
    if (allMessages.length <= this.keepLastMessages + this.minNewMessagesToSummarize) {
      return;
    }

    const summaryCutoff = allMessages.length - this.keepLastMessages;
    const alreadySummarized = chat.summaryMessageCount;
    const pendingCount = summaryCutoff - alreadySummarized;

    if (pendingCount < this.minNewMessagesToSummarize) return;

    const pending = allMessages.slice(alreadySummarized, summaryCutoff);
    if (pending.length === 0) return;

    const transcript = pending
      .map((message) => {
        const role = message.role.toLowerCase();
        const content =
          message.content.length > 900
            ? `${message.content.slice(0, 900)}...`
            : message.content;
        return `${role}: ${content}`;
      })
      .join("\n");

    const model = (process.env.SUMMARY_MODEL || "").trim() || MODEL_REGISTRY.fast.id;

    try {
      const completion = await this.client.chatCompletion({
        model,
        temperature: 0.15,
        max_tokens: 360,
        messages: [
          {
            role: "system",
            content: SUMMARY_PROMPT,
          },
          {
            role: "user",
            content: [
              "Existing summary:",
              chat.summaryText || "(none)",
              "",
              "New conversation segment:",
              transcript,
            ].join("\n"),
          },
        ],
      });

      const nextSummary = completion.content.trim();
      if (!nextSummary) return;

      await this.store.updateSummary(chat.id, nextSummary, summaryCutoff);
    } catch (error) {
      logger.warn(
        { chatId: chat.id, error: error instanceof Error ? error.message : String(error) },
        "Failed to update conversation summary",
      );
    }
  }
}
