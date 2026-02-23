import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import session from "express-session";
import { buildBot } from "./bot.js";
import { prisma } from "./db/prisma.js";
import { OpenRouterClient } from "./openrouter/client.js";
import { MemoryStore } from "./memory/store.js";
import { ConversationSummarizer } from "./memory/summarizer.js";
import { DatabaseRateLimiter } from "./utils/rateLimit.js";
import { DbLockManager } from "./utils/locks.js";
import { logger } from "./utils/logger.js";

type AuthSessionUser = {
  id: string;
  email: string;
  name: string;
  photo?: string;
};

declare module "express-session" {
  interface SessionData {
    authUser?: AuthSessionUser;
    oauthState?: string;
  }
}

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
const FRONTEND_URL = (process.env.FRONTEND_URL || "").trim().replace(/\/+$/, "");
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || "").trim();
const GOOGLE_CLIENT_SECRET = (process.env.GOOGLE_CLIENT_SECRET || "").trim();
const GOOGLE_CALLBACK_URL = (
  process.env.GOOGLE_CALLBACK_URL ||
  (APP_URL ? `${APP_URL}/auth/google/callback` : "")
)
  .trim()
  .replace(/\/+$/, "");
const SESSION_SECRET =
  (process.env.SESSION_SECRET || "").trim() ||
  "dev_session_secret_change_me_please_32_chars";
const PORT = Number(process.env.PORT || 4000);
const MAX_INPUT_CHARS = Math.max(
  1000,
  Number(process.env.MAX_INPUT_CHARS || 12000),
);
const MAX_OUTPUT_TOKENS = Math.max(
  300,
  Number(process.env.MAX_OUTPUT_TOKENS || 1800),
);
const STREAM_EDIT_INTERVAL_MS = Math.max(
  40,
  Number(process.env.STREAM_EDIT_INTERVAL_MS || 60),
);
const OPENROUTER_TIMEOUT_MS = Math.max(
  8000,
  Number(process.env.OPENROUTER_TIMEOUT_MS || 22000),
);
const OPENROUTER_MAX_RETRIES = Math.max(
  0,
  Math.min(4, Number(process.env.OPENROUTER_MAX_RETRIES || 2)),
);
const OPENROUTER_RETRY_BASE_DELAY_MS = Math.max(
  50,
  Number(process.env.OPENROUTER_RETRY_BASE_DELAY_MS || 180),
);
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const FRONTEND_LOGIN_URL = FRONTEND_URL
  ? `${FRONTEND_URL}/#/login`
  : "http://localhost:3000/#/login";
const FRONTEND_HOME_URL = FRONTEND_URL
  ? `${FRONTEND_URL}/#/`
  : "http://localhost:3000/#/";

const openRouter = new OpenRouterClient({
  apiKey: OPENROUTER_API_KEY,
  baseUrl: OPENROUTER_BASE_URL,
  appUrl: APP_URL || "http://localhost",
  title: "Telegram Chat Bot",
  timeoutMs: OPENROUTER_TIMEOUT_MS,
  maxRetries: OPENROUTER_MAX_RETRIES,
  retryBaseDelayMs: OPENROUTER_RETRY_BASE_DELAY_MS,
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
if (IS_PRODUCTION) {
  app.set("trust proxy", 1);
}
const allowedOrigins = new Set(
  [
    FRONTEND_URL,
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://localhost:3000",
  ].filter(Boolean),
);
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  }),
);
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      httpOnly: true,
      sameSite: IS_PRODUCTION ? "none" : "lax",
      secure: IS_PRODUCTION,
      maxAge: 24 * 60 * 60 * 1000,
    },
  }),
);
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    mode: "bot-runtime-with-auth-fallback",
    hasGoogleConfig: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
  });
});

app.get("/auth/google", (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CALLBACK_URL) {
    res.redirect(`${FRONTEND_LOGIN_URL}?error=google_not_configured`);
    return;
  }

  const state = randomUUID();
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_CALLBACK_URL,
    response_type: "code",
    scope: "openid email profile",
    access_type: "online",
    prompt: "select_account",
    state,
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

app.get("/auth/google/callback", async (req, res) => {
  try {
    const code = String(req.query.code || "").trim();
    const state = String(req.query.state || "").trim();
    if (!code) {
      res.redirect(`${FRONTEND_LOGIN_URL}?error=google_code_missing`);
      return;
    }
    if (!state || state !== req.session.oauthState) {
      res.redirect(`${FRONTEND_LOGIN_URL}?error=google_state_invalid`);
      return;
    }

    const tokenBody = new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_CALLBACK_URL,
      grant_type: "authorization_code",
    });
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
    });
    const tokenData = (await tokenResponse.json().catch(() => ({}))) as {
      access_token?: string;
    };
    if (!tokenResponse.ok || !tokenData.access_token) {
      res.redirect(`${FRONTEND_LOGIN_URL}?error=google_token_failed`);
      return;
    }

    const userInfoResponse = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      },
    );
    const userInfo = (await userInfoResponse.json().catch(() => ({}))) as {
      sub?: string;
      email?: string;
      name?: string;
      picture?: string;
    };
    if (!userInfoResponse.ok || !userInfo.email) {
      res.redirect(`${FRONTEND_LOGIN_URL}?error=google_profile_failed`);
      return;
    }

    req.session.authUser = {
      id: userInfo.sub || `google_${Date.now()}`,
      email: userInfo.email.toLowerCase(),
      name: userInfo.name || userInfo.email.split("@")[0],
      photo: userInfo.picture,
    };
    req.session.oauthState = undefined;
    req.session.save(() => {
      res.redirect(FRONTEND_HOME_URL);
    });
  } catch {
    res.redirect(`${FRONTEND_LOGIN_URL}?error=google_callback_failed`);
  }
});

app.post("/auth/google/access-token", async (req, res) => {
  const accessToken =
    typeof req.body?.accessToken === "string" ? req.body.accessToken.trim() : "";
  if (!accessToken) {
    res.status(400).json({ success: false, message: "Missing Google access token" });
    return;
  }

  try {
    const tokenInfoRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
    );
    if (!tokenInfoRes.ok) {
      res.status(401).json({ success: false, message: "Invalid Google access token" });
      return;
    }
    const tokenInfo = (await tokenInfoRes.json().catch(() => ({}))) as {
      aud?: string;
    };
    if (GOOGLE_CLIENT_ID && tokenInfo.aud && tokenInfo.aud !== GOOGLE_CLIENT_ID) {
      res.status(401).json({ success: false, message: "Google client mismatch" });
      return;
    }

    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const userInfo = (await userInfoRes.json().catch(() => ({}))) as {
      sub?: string;
      email?: string;
      name?: string;
      picture?: string;
    };
    if (!userInfoRes.ok || !userInfo.email) {
      res.status(401).json({ success: false, message: "Failed to fetch Google profile" });
      return;
    }

    const user: AuthSessionUser = {
      id: userInfo.sub || `google_${Date.now()}`,
      email: userInfo.email.toLowerCase(),
      name: userInfo.name || userInfo.email.split("@")[0],
      photo: userInfo.picture,
    };
    req.session.authUser = user;
    req.session.save(() => {
      res.json({
        success: true,
        message: "Google login successful",
        user,
      });
    });
  } catch {
    res.status(500).json({ success: false, message: "Google sign-in failed" });
  }
});

app.get("/me", (req, res) => {
  if (!req.session.authUser) {
    res.status(401).json({ message: "Not authenticated" });
    return;
  }
  res.json({ user: req.session.authUser });
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.redirect(FRONTEND_LOGIN_URL);
  });
});

app.get("/bots", (_req, res) => {
  // Lightweight fallback for the bot runtime.
  res.json({ bots: [] });
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

  try {
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
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.stack : String(error) },
      "Telegram startup failed; HTTP server remains online",
    );
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
