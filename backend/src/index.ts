import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import express from "express";
import { buildBot } from "./bot.js";
import { prisma } from "./db/prisma.js";
import { OpenRouterClient } from "./openrouter/client.js";
import { MemoryStore } from "./memory/store.js";
import { ConversationSummarizer } from "./memory/summarizer.js";
import { DatabaseRateLimiter } from "./utils/rateLimit.js";
import { DbLockManager } from "./utils/locks.js";
import { logger } from "./utils/logger.js";

const envCandidates = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "..", ".env"),
];
for (const candidate of envCandidates) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
  }
}

const requireEnv = (key: string): string => {
  const value = (process.env[key] || "").trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
};

const TELEGRAM_BOT_TOKEN = requireEnv("TELEGRAM_BOT_TOKEN");
const OPENROUTER_API_KEY = requireEnv("OPENROUTER_API_KEY");
const OPENROUTER_BASE_URL =
  (process.env.OPENROUTER_BASE_URL || "").trim() || "https://openrouter.ai/api/v1";
const APP_URL = (process.env.APP_URL || "").trim().replace(/\/+$/, "");
const PORT = Number(process.env.PORT || 4000);
const MAX_INPUT_CHARS = Math.max(
  1000,
  Number(process.env.MAX_INPUT_CHARS || 12000),
);
const MAX_OUTPUT_TOKENS = Math.max(
  200,
  Number(process.env.MAX_OUTPUT_TOKENS || 1200),
);
const STREAM_EDIT_INTERVAL_MS = Math.max(
  350,
  Number(process.env.STREAM_EDIT_INTERVAL_MS || 900),
);

const openRouter = new OpenRouterClient({
  apiKey: OPENROUTER_API_KEY,
  baseUrl: OPENROUTER_BASE_URL,
  appUrl: APP_URL || "http://localhost",
  title: "Telegram Chat Bot",
});

const store = new MemoryStore(prisma);
const summarizer = new ConversationSummarizer(store, openRouter);
const rateLimiter = new DatabaseRateLimiter(prisma, 20, 10 * 60 * 1000);
const lockManager = new DbLockManager(prisma);

const bot = buildBot({
  token: TELEGRAM_BOT_TOKEN,
  store,
  summarizer,
  openRouter,
  rateLimiter,
  lockManager,
  streamEditIntervalMs: STREAM_EDIT_INTERVAL_MS,
  maxInputChars: MAX_INPUT_CHARS,
  maxOutputTokens: MAX_OUTPUT_TOKENS,
});

const app = express();
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/webhook", async (req, res) => {
  try {
    await bot.handleUpdate(req.body, res);
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.stack : String(error) },
      "Webhook handler failed",
    );
    if (!res.headersSent) {
      res.status(500).json({ ok: false });
    }
  }
});

const server = app.listen(PORT, "0.0.0.0", async () => {
  logger.info({ port: PORT }, "Telegram bot server started");

  await bot.telegram.setMyCommands([
    { command: "start", description: "Start bot and onboarding" },
    { command: "help", description: "Show command help" },
    { command: "reset", description: "Reset chat history" },
    { command: "model", description: "Show or switch model" },
    { command: "settings", description: "Configure temperature and verbosity" },
    { command: "export", description: "Export conversation data" },
    { command: "stop", description: "Stop active streaming response" },
  ]);

  if (APP_URL) {
    const webhookUrl = `${APP_URL}/webhook`;
    await bot.telegram.setWebhook(webhookUrl);
    logger.info({ webhookUrl }, "Webhook mode enabled");
  } else {
    await bot.launch();
    logger.info("Long-polling mode enabled (APP_URL not set)");
  }
});

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, "Shutting down");
  try {
    await bot.stop(signal);
  } catch {}
  await prisma.$disconnect().catch(() => {});
  server.close(() => {
    process.exit(0);
  });
};

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});
