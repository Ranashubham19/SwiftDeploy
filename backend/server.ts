import fs from 'fs';
import path from 'path';
import { randomUUID, verify as cryptoVerify, createHmac, timingSafeEqual } from 'crypto';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import TelegramBot from 'node-telegram-bot-api';
import { Client as DiscordClient, GatewayIntentBits } from 'discord.js';
import passport from 'passport';
import session from 'express-session';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { sendVerificationEmail, sendTestEmail, validateVerificationCode, getPendingVerifications, isEmailRegistered, markEmailAsRegistered, getUserByEmail, updateUserPassword, storePendingSignup, getPendingSignup, clearPendingSignup } from './emailService.js';
import { huggingFaceService } from './huggingfaceService.js';
import { generateBotResponse, estimateTokens, needsRealtimeSearch } from './geminiService.js';
import { Request } from 'express';
import bcrypt from 'bcrypt';
import rateLimit from 'express-rate-limit';

const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '..', '.env')
];

for (const candidate of envCandidates) {
  if (!fs.existsSync(candidate)) continue;
  dotenv.config({ path: candidate });
}

const shouldManualParseEnv = [
  'SESSION_SECRET',
  'FRONTEND_URL',
  'SMTP_USER',
  'SMTP_PASS'
].some((key) => !process.env[key]);

if (shouldManualParseEnv) {
  for (const candidate of envCandidates) {
    if (!fs.existsSync(candidate)) continue;
    const envContent = fs.readFileSync(candidate, 'utf8');
    const lines = envContent.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex <= 0) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

// Extend Express Request type to include login method
declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      name: string;
      photo?: string;
      plan?: 'FREE' | 'PRO_MONTHLY' | 'PRO_YEARLY' | 'CUSTOM';
      isSubscribed?: boolean;
    }
    
    interface Request {
      login(user: User, callback: (err: any) => void): void;
      login(user: User): Promise<void>;
      logout(callback: (err: any) => void): void;
      logout(): Promise<void>;
      rawBody?: string;
    }
  }
}

// In-memory storage for bot tokens
const botTokens = new Map<string, string>();
type DiscordBotConfig = {
  botId: string;
  botToken: string;
  applicationId: string;
  publicKey: string;
  botUsername?: string;
  createdBy: string;
  createdAt: string;
};
const discordBots = new Map<string, DiscordBotConfig>();
const discordGatewayClients = new Map<string, DiscordClient>();
const managedBots = new Map<string, TelegramBot>();
const managedBotListeners = new Set<string>();
const telegramBotOwners = new Map<string, string>();
type TelegramBotConfig = {
  botId: string;
  botToken: string;
  ownerEmail: string;
  createdAt: string;
};
type PersistedBotState = {
  version: 1;
  telegramBots: TelegramBotConfig[];
  discordBots: DiscordBotConfig[];
};
type BotPlatform = 'TELEGRAM' | 'DISCORD';
type BotTelemetry = {
  botId: string;
  platform: BotPlatform;
  ownerEmail: string;
  createdAt: string;
  messageCount: number;
  responseCount: number;
  errorCount: number;
  tokenUsage: number;
  totalLatencyMs: number;
  latencySamples: number;
  lastActiveAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
};
const botTelemetry = new Map<string, BotTelemetry>();
const aiResponseCache = new Map<string, { text: string; expiresAt: number }>();
const aiInFlightRequests = new Map<string, Promise<string>>();
type BotChatTurn = { role: 'user' | 'model'; parts: { text: string }[] };
const chatHistoryStore = new Map<string, { history: BotChatTurn[]; updatedAt: number }>();
const CHAT_HISTORY_TTL_MS = 30 * 60 * 1000;
const CHAT_HISTORY_MAX_TURNS = parseInt(process.env.CHAT_HISTORY_MAX_TURNS || '120', 10);
const CHAT_HISTORY_TOKEN_BUDGET = parseInt(process.env.HISTORY_TOKEN_BUDGET || '6000', 10);
const AI_CACHE_TTL_MS = 2 * 60 * 1000;
const AI_CACHE_MAX_ENTRIES = parseInt(process.env.AI_CACHE_MAX_ENTRIES || '800', 10);
const MAX_USER_PROMPT_LENGTH = parseInt(process.env.MAX_USER_PROMPT_LENGTH || '6000', 10);
const CHAT_MEMORY_FILE = (process.env.BOT_MEMORY_FILE || '').trim()
  || (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'swiftdeploy-chat-memory.json')
    : path.resolve(process.cwd(), 'runtime', 'swiftdeploy-chat-memory.json'));
type ContextMetric = { totalPromptTokens: number; totalResponseTokens: number; updatedAt: number };
const contextMetrics = new Map<string, ContextMetric>();
const CONTEXT_DB_FILE = (process.env.CONTEXT_DB_FILE || '').trim()
  || (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'swiftdeploy-context-db.json')
    : path.resolve(process.cwd(), 'runtime', 'swiftdeploy-context-db.json'));
type UserProfile = {
  preferredTone?: 'professional' | 'formal' | 'casual' | 'concise';
  prefersConcise?: boolean;
  recurringTopics: string[];
  topicCounts: Record<string, number>;
  updatedAt: number;
};
const userProfiles = new Map<string, UserProfile>();
const USER_PROFILE_FILE = (process.env.USER_PROFILE_FILE || '').trim()
  || (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'swiftdeploy-user-profiles.json')
    : path.resolve(process.cwd(), 'runtime', 'swiftdeploy-user-profiles.json'));
const FREE_DEPLOY_LIMIT = 1;
const FREE_TRIAL_DAYS = 7;
type PlanType = 'FREE' | 'PRO_MONTHLY' | 'PRO_YEARLY' | 'CUSTOM';
type BillingTier = 'STARTER' | 'PRO' | 'ENTERPRISE';
type SubscriptionState = {
  plan: PlanType;
  isSubscribed: boolean;
  freeDeployCount: number;
  freeTrialEndsAt: number;
};
const userSubscriptionState = new Map<string, SubscriptionState>();
type AutomationTrigger = 'KEYWORD' | 'MENTION' | 'SILENCE_GAP' | 'HIGH_VOLUME';
type AutomationAction = 'AUTO_REPLY' | 'ESCALATE' | 'TAG' | 'DELAY_REPLY';
type AutomationRule = {
  id: string;
  name: string;
  description: string;
  trigger: AutomationTrigger;
  action: AutomationAction;
  keyword?: string;
  cooldownSec: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  runCount: number;
  successCount: number;
};
const automationRulesByUser = new Map<string, AutomationRule[]>();

const ensureUserSubscriptionState = (email: string): SubscriptionState => {
  const normalized = email.trim().toLowerCase();
  const existing = userSubscriptionState.get(normalized);
  if (existing) return existing;
  const fresh: SubscriptionState = {
    plan: 'FREE',
    isSubscribed: false,
    freeDeployCount: 0,
    freeTrialEndsAt: Date.now() + FREE_TRIAL_DAYS * 24 * 60 * 60 * 1000
  };
  userSubscriptionState.set(normalized, fresh);
  return fresh;
};

const setUserPlan = (email: string, plan: PlanType): SubscriptionState => {
  const state = ensureUserSubscriptionState(email);
  const next: SubscriptionState = {
    ...state,
    plan,
    isSubscribed: plan !== 'FREE'
  };
  userSubscriptionState.set(email.trim().toLowerCase(), next);
  return next;
};

const getAutomationRulesForUser = (email: string): AutomationRule[] => {
  const key = email.trim().toLowerCase();
  const existing = automationRulesByUser.get(key);
  if (existing) return existing;
  const seed: AutomationRule[] = [
    {
      id: randomUUID(),
      name: 'Pricing Intent Fast Reply',
      description: 'Auto reply with plan summary when user mentions pricing keywords.',
      trigger: 'KEYWORD',
      action: 'AUTO_REPLY',
      keyword: 'pricing',
      cooldownSec: 45,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      runCount: 0,
      successCount: 0
    }
  ];
  automationRulesByUser.set(key, seed);
  return seed;
};

const ensureBotTelemetry = (botId: string, platform: BotPlatform, ownerEmail: string): BotTelemetry => {
  const normalizedOwner = ownerEmail.trim().toLowerCase();
  const existing = botTelemetry.get(botId);
  if (existing) {
    if (!existing.ownerEmail && normalizedOwner) {
      existing.ownerEmail = normalizedOwner;
      botTelemetry.set(botId, existing);
    }
    return existing;
  }
  const fresh: BotTelemetry = {
    botId,
    platform,
    ownerEmail: normalizedOwner,
    createdAt: new Date().toISOString(),
    messageCount: 0,
    responseCount: 0,
    errorCount: 0,
    tokenUsage: 0,
    totalLatencyMs: 0,
    latencySamples: 0,
    lastActiveAt: null,
    lastErrorAt: null,
    lastErrorMessage: null
  };
  botTelemetry.set(botId, fresh);
  return fresh;
};

const recordBotIncoming = (botId: string): void => {
  const telemetry = botTelemetry.get(botId);
  if (!telemetry) return;
  telemetry.messageCount += 1;
  telemetry.lastActiveAt = new Date().toISOString();
  botTelemetry.set(botId, telemetry);
};

const recordBotResponse = (botId: string, responseText: string, latencyMs?: number): void => {
  const telemetry = botTelemetry.get(botId);
  if (!telemetry) return;
  telemetry.responseCount += 1;
  telemetry.tokenUsage += estimateTokens(String(responseText || ''));
  if (typeof latencyMs === 'number' && Number.isFinite(latencyMs) && latencyMs >= 0) {
    telemetry.totalLatencyMs += latencyMs;
    telemetry.latencySamples += 1;
  }
  telemetry.lastActiveAt = new Date().toISOString();
  botTelemetry.set(botId, telemetry);
};

const recordBotError = (botId: string, error: unknown): void => {
  const telemetry = botTelemetry.get(botId);
  if (!telemetry) return;
  telemetry.errorCount += 1;
  telemetry.lastErrorAt = new Date().toISOString();
  telemetry.lastErrorMessage = error instanceof Error ? error.message : String(error || 'Unknown error');
  botTelemetry.set(botId, telemetry);
};

const getBotIdByTelegramToken = (botToken: string): string | null => {
  for (const [id, token] of botTokens.entries()) {
    if (token === botToken) return id;
  }
  return null;
};

const persistBotState = (): void => {
  const telegramBots: TelegramBotConfig[] = Array.from(botTokens.entries()).map(([botId, botToken]) => ({
    botId,
    botToken,
    ownerEmail: telegramBotOwners.get(botId) || '',
    createdAt: new Date().toISOString()
  }));
  const state: PersistedBotState = {
    version: 1,
    telegramBots,
    discordBots: Array.from(discordBots.values())
  };

  try {
    const dir = path.dirname(BOT_STATE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(BOT_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (error) {
    console.warn('[BOT_STATE] Failed to persist deployed bot state:', (error as Error).message);
  }
};

const loadPersistedBotState = (): PersistedBotState => {
  try {
    if (!fs.existsSync(BOT_STATE_FILE)) {
      return { version: 1, telegramBots: [], discordBots: [] };
    }

    const raw = fs.readFileSync(BOT_STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as PersistedBotState;
    return {
      version: 1,
      telegramBots: Array.isArray(parsed.telegramBots) ? parsed.telegramBots : [],
      discordBots: Array.isArray(parsed.discordBots) ? parsed.discordBots : []
    };
  } catch (error) {
    console.warn('[BOT_STATE] Failed to load persisted state:', (error as Error).message);
    return { version: 1, telegramBots: [], discordBots: [] };
  }
};

// Validate required environment variables
const requiredEnvVars = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'TELEGRAM_BOT_TOKEN',
  'SESSION_SECRET'
] as const;

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.warn("WARNING: Missing required environment variables");
  console.warn(`For local development, please ensure the following are set in your .env file: ${missingEnvVars.join(', ')}`);
  console.log("Continuing with placeholder values for local development...");
}

// Type-safe environment variable access with fallbacks for local development
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'placeholder_token';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'placeholder_client_id';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'placeholder_client_secret';
const SESSION_SECRET = process.env.SESSION_SECRET || 'very_long_random_session_secret_for_dev_testing_only';
const isProduction = process.env.NODE_ENV === 'production';
const defaultPortFromEnv = (process.env.PORT || '4000').trim() || '4000';
const derivedBaseUrl = (process.env.BASE_URL || '').trim()
  || (isProduction && process.env.RAILWAY_STATIC_URL ? `https://${process.env.RAILWAY_STATIC_URL}` : `http://localhost:${defaultPortFromEnv}`);
const BOT_STATE_FILE = (process.env.BOT_STATE_FILE || '').trim()
  || (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'swiftdeploy-bots.json')
    : path.resolve(process.cwd(), 'runtime', 'swiftdeploy-bots.json'));

const app = express();
const startedAtIso = new Date().toISOString();
if (isProduction) {
  app.set('trust proxy', 1);
}

// Lightweight health endpoints first: avoid session/auth middleware interference.
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    startedAt: startedAtIso,
    uptime: process.uptime(),
    message: 'Application is running'
  });
});

app.get('/', (_req, res) => {
  res.status(200).send('SwiftDeploy backend is live');
});

/**
 * LOCALHOST DEVELOPMENT CONFIGURATION
 */

const PORT = parseInt(process.env.PORT || "4000", 10);
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BASE_URL = derivedBaseUrl.replace(/\/+$/, '');
const TELEGRAM_MAX_MESSAGE_LENGTH = 4000;
const FAST_REPLY_MODE = (process.env.FAST_REPLY_MODE || 'true').trim().toLowerCase() !== 'false';
const AI_RESPONSE_TIMEOUT_MS = parseInt(process.env.AI_RESPONSE_TIMEOUT_MS || (FAST_REPLY_MODE ? '25000' : '60000'), 10);
const AI_MAX_RETRY_PASSES = Math.max(0, parseInt(process.env.AI_MAX_RETRY_PASSES || (FAST_REPLY_MODE ? '0' : '1'), 10));
const AI_ENABLE_STRICT_RETRY = (process.env.AI_ENABLE_STRICT_RETRY || (FAST_REPLY_MODE ? 'false' : 'true')).trim().toLowerCase() !== 'false';
const AI_ENABLE_SELF_VERIFY = (process.env.AI_ENABLE_SELF_VERIFY || (FAST_REPLY_MODE ? 'false' : 'true')).trim().toLowerCase() !== 'false';
const TELEGRAM_STREAMING_ENABLED = (process.env.TELEGRAM_STREAMING_ENABLED || 'true').trim().toLowerCase() !== 'false';
const TELEGRAM_STREAM_START_DELAY_MS = parseInt(process.env.TELEGRAM_STREAM_START_DELAY_MS || '700', 10);
const TELEGRAM_STREAM_PROGRESS_INTERVAL_MS = parseInt(process.env.TELEGRAM_STREAM_PROGRESS_INTERVAL_MS || '3500', 10);
const WEBHOOK_SECRET_MASTER = String(process.env.TELEGRAM_WEBHOOK_SECRET || SESSION_SECRET || '').trim();
const ADMIN_API_KEY = String(process.env.ADMIN_API_KEY || '').trim();

// Rate limiting configuration
const authRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 5, // Limit each IP to 5 requests per windowMs
  message: {
    message: 'Too many requests'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const normalizeSecret = (raw: string): string => {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const getStripeSecretKey = (): string => {
  const explicit = normalizeSecret(
    process.env.STRIPE_SECRET_KEY ||
    process.env.STRIPE_SECRET ||
    ''
  );
  if (explicit.startsWith('sk_')) {
    return explicit;
  }

  // Fallback: auto-detect misnamed Stripe secret variables in hosting dashboards.
  for (const [key, value] of Object.entries(process.env)) {
    if (!/STRIPE/i.test(key)) continue;
    if (!/(SECRET|KEY)/i.test(key)) continue;
    const normalized = normalizeSecret(String(value || ''));
    if (normalized.startsWith('sk_')) {
      return normalized;
    }
  }

  return explicit;
};

const billingRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => {
    const reqUser = req.user as Express.User | undefined;
    const email = (reqUser?.email || '').trim().toLowerCase();
    if (email) {
      return `billing:user:${email}`;
    }
    return `billing:ip:${req.ip || req.socket.remoteAddress || 'unknown'}`;
  },
  skipSuccessfulRequests: true,
  message: {
    message: 'Too many checkout attempts. Please wait and try again.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const deployRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 6,
  keyGenerator: (req) => {
    const reqUser = req.user as Express.User | undefined;
    const email = (reqUser?.email || '').trim().toLowerCase();
    if (email) return `deploy:user:${email}`;
    return `deploy:ip:${req.ip || req.socket.remoteAddress || 'unknown'}`;
  },
  message: { message: 'Too many deploy attempts. Please wait and try again.' },
  standardHeaders: true,
  legacyHeaders: false
});

const webhookRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 150,
  message: { message: 'Too many webhook requests' },
  standardHeaders: true,
  legacyHeaders: false
});

const hasValidAdminKey = (req: express.Request): boolean => {
  if (!ADMIN_API_KEY) return false;
  const header = String(req.headers['x-admin-key'] || '').trim();
  if (!header) return false;
  try {
    return timingSafeEqual(Buffer.from(header), Buffer.from(ADMIN_API_KEY));
  } catch {
    return false;
  }
};

const requireAdminAccess = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.isAuthenticated?.() || hasValidAdminKey(req)) {
    return next();
  }
  return res.status(403).json({ message: 'Admin access required' });
};

const buildTelegramWebhookSecret = (botId: string): string => {
  if (!WEBHOOK_SECRET_MASTER) return '';
  return createHmac('sha256', WEBHOOK_SECRET_MASTER)
    .update(`telegram-webhook:${botId}`)
    .digest('hex')
    .slice(0, 48);
};

const verifyTelegramWebhookRequest = (req: express.Request, botId: string): boolean => {
  if (!isProduction) return true;
  const expected = buildTelegramWebhookSecret(botId);
  if (!expected) return false;
  const header = String(req.headers['x-telegram-bot-api-secret-token'] || '').trim();
  if (!header) return false;
  try {
    return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
  } catch {
    return false;
  }
};

const getActiveAiConfig = (): { provider: string; model: string } => {
  const provider = (process.env.AI_PROVIDER || 'moonshot').trim().toLowerCase();
  const model =
    provider === 'moonshot'
      ? (process.env.MOONSHOT_MODEL || 'moonshotai/kimi-k2.5').trim()
      : provider === 'openai'
        ? (process.env.OPENAI_MODEL || 'gpt-5.2').trim()
        : provider === 'anthropic'
          ? (process.env.ANTHROPIC_MODEL || 'claude-opus-4-5').trim()
          : provider === 'openrouter'
            ? (process.env.OPENROUTER_MODEL || 'moonshotai/kimi-k2').trim()
            : provider === 'sarvam'
              ? (process.env.SARVAM_MODEL || 'sarvam-m').trim()
              : (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
  return { provider, model };
};

// Middleware configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}) as any);

// Apply rate limiting to authentication routes
app.use('/send-verification', authRateLimit);
app.use('/resend-verification', authRateLimit);
app.use('/login', authRateLimit);
app.use('/verify-email', authRateLimit);
app.use('/webhook', webhookRateLimit);

// Authentication middleware
const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: 'Authentication required' });
};

// Configure session
const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'super_secret_session_key_32_chars',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: isProduction ? ('none' as const) : ('lax' as const),
    secure: isProduction,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  },
  proxy: true
};

app.use(session(sessionConfig));

app.use(express.json({
  limit: '2mb',
  verify: (req, _res, buf) => {
    const request = req as Request;
    if ((request.originalUrl || '').startsWith('/discord/interactions/')) {
      request.rawBody = buf.toString('utf8');
    }
  }
}) as any);
app.use(passport.initialize());
app.use(passport.session());

// Passport.js Google OAuth Configuration
if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || `${BASE_URL}/auth/google/callback`
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      // Create or update user in your database
      // For now, we'll just return the profile info
      const user = {
        id: profile.id,
        name: profile.displayName || profile.username || 'Anonymous',
        email: profile.emails?.[0].value || '',
        photo: profile.photos?.[0].value
      };
      return done(null, user);
    } catch (error) {
      return done(error as any, undefined);
    }
  }
  ));
} else {
  console.log("WARNING: Google OAuth is disabled - missing credentials");
}

// Serialize user into the sessions
passport.serializeUser((user: any, done) => {
  done(null, user);
});

// Deserialize user from the sessions
passport.deserializeUser((user: any, done) => {
  done(null, user);
});

// Initialize Telegram Bot with direct message handling
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: isProduction ? false : true });

// Listen for messages directly
bot.on('message', async (msg) => {
  console.log(`[TELEGRAM] Direct message received from ${msg.from?.username || 'Unknown'}: ${msg.text}`);
  await handleTelegramMessage(msg);
});

// Declare global function type
declare global {
  var setWebhookForBot: (botToken: string, botId: string) => Promise<{ success: boolean; data?: any; error?: string }>;
}

// Function to set webhook for a bot
(global as any).setWebhookForBot = async (botToken: string, botId: string) => {
  if (!isProduction) {
    console.log(`[WEBHOOK] Local mode detected. Skipping webhook for bot ${botId} and using polling.`);
    return { success: true, data: { ok: true, result: 'Local mode: polling enabled' } };
  }

  const webhookUrl = `${BASE_URL}/webhook/${botId}`;
  const secretToken = buildTelegramWebhookSecret(botId);
  const setWebhookUrl = `https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}${secretToken ? `&secret_token=${encodeURIComponent(secretToken)}` : ''}`;
  
  console.log(`[WEBHOOK] Setting webhook for bot ${botId}: ${webhookUrl}`);
  
  try {
    const response = await fetch(setWebhookUrl);
    const data: any = await response.json();
    
    console.log(`[WEBHOOK] Telegram API Response for ${botId}:`, data);
    
    if (data.ok) {
      console.log(`[WEBHOOK] Successfully set webhook for bot ${botId}`);
      return { success: true, data };
    } else {
      console.error(`[WEBHOOK] Failed to set webhook for bot ${botId}:`, data.description);
      return { success: false, error: data.description };
    }
  } catch (error) {
    console.error(`[WEBHOOK] Error setting webhook for bot ${botId}:`, error);
    return { success: false, error: (error as Error).message || 'Unknown error' };
  }
};

/**
 * Get AI response using Hugging Face API
 * Compliant with Hugging Face requirements
 */
async function getAIResponse(userText: string): Promise<string> {
  if (!process.env.HUGGINGFACE_API_KEY) {
    return generateEmergencyReply(userText);
  }
  // Always attempt fallback generation; the service already handles missing keys safely.
  const response = await huggingFaceService.generateResponse(
    userText,
    "You are the SimpleClaw AI assistant. You are a highly professional, accurate, and strategic AI agent. Your goal is to provide world-class technical and general assistance."
  );
  const safeResponse = String(response || '').trim();
  if (!safeResponse) return 'Hello! How can I help you today?';
  return safeResponse;
}

const generateEmergencyReply = (messageText: string): string => {
  const text = String(messageText || '').trim();
  const lower = text.toLowerCase();
  if (!text) return 'Please send a message and I will help you right away.';
  if (/^(hi|hii|hello|hey)\b/.test(lower)) {
    return 'Hi! I am online and ready to help. Ask me anything about your bot, deployment, or setup.';
  }
  if (/(how are you|how r u|how're you)/.test(lower)) {
    return 'I am doing well and ready to help. Tell me what you need and I will assist right away.';
  }
  if (/(bye|good ?night|good ?bye)/.test(lower)) {
    return 'Goodbye. I will stay online 24/7 whenever you need help again.';
  }
  if (/(help|support|issue|error|problem)/.test(lower)) {
    return 'I can help. Please share the exact error text or screenshot details, and I will give a step-by-step fix.';
  }
  return 'I am online and ready to help. Please ask your question again and I will answer directly.';
};

const withTimeout = async <T,>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> => {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(timeoutMessage)), ms))
  ]);
};

const normalizeHex = (value: string): string => value.trim().toLowerCase();

const toDiscordPublicKeyPem = (publicKeyHex: string): string => {
  const normalized = normalizeHex(publicKeyHex);
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error('Invalid Discord public key format');
  }
  const keyBytes = Buffer.from(normalized, 'hex');
  const ed25519SpkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
  const der = Buffer.concat([ed25519SpkiPrefix, keyBytes]);
  const base64 = der.toString('base64').match(/.{1,64}/g)?.join('\n') || der.toString('base64');
  return `-----BEGIN PUBLIC KEY-----\n${base64}\n-----END PUBLIC KEY-----`;
};

const verifyDiscordInteraction = (req: Request, publicKeyHex: string): boolean => {
  const signature = String(req.headers['x-signature-ed25519'] || '').trim();
  const timestamp = String(req.headers['x-signature-timestamp'] || '').trim();
  const rawBody = req.rawBody || '';
  if (!signature || !timestamp || !rawBody) return false;
  if (!/^[0-9a-fA-F]+$/.test(signature)) return false;
  try {
    const publicKeyPem = toDiscordPublicKeyPem(publicKeyHex);
    const message = Buffer.from(`${timestamp}${rawBody}`);
    return cryptoVerify(null, message, publicKeyPem, Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
};

const connectDiscordGatewayClient = async (botId: string, botToken: string): Promise<DiscordClient> => {
  const existing = discordGatewayClients.get(botId);
  if (existing) {
    try {
      existing.destroy();
    } catch {}
    discordGatewayClients.delete(botId);
  }

  const enableMessageIntent = (process.env.DISCORD_ENABLE_MESSAGE_INTENT || '').trim().toLowerCase() === 'true';
  const intents = [GatewayIntentBits.Guilds];
  if (enableMessageIntent) {
    intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
  }
  const client = new DiscordClient({ intents });

  client.on('error', (error) => {
    console.error(`[DISCORD_GATEWAY:${botId}] Client error:`, error);
  });
  client.on('shardError', (error) => {
    console.error(`[DISCORD_GATEWAY:${botId}] Shard error:`, error);
  });
  client.on('warn', (warning) => {
    console.warn(`[DISCORD_GATEWAY:${botId}] Warn:`, warning);
  });
  client.once('ready', () => {
    console.log(`[DISCORD_GATEWAY:${botId}] Online as ${client.user?.tag || 'unknown user'}`);
  });
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const commandName = interaction.commandName.toLowerCase();
    recordBotIncoming(botId);
    if (commandName === 'ping') {
      const pingReply = 'SwiftDeploy Discord node is online and ready.';
      await interaction.reply({ content: pingReply });
      recordBotResponse(botId, pingReply, 0);
      return;
    }
    if (commandName !== 'ask') {
      await interaction.reply({ content: 'Unknown command.', ephemeral: true });
      recordBotError(botId, 'Unknown slash command');
      return;
    }

    const question = interaction.options.getString('question', true).trim();
    if (!question) {
      await interaction.reply({ content: 'Please provide a question.', ephemeral: true });
      return;
    }

    try {
      const startedAt = Date.now();
      await interaction.deferReply();
      const answer = await generateProfessionalReply(question, interaction.user?.id, `discord:${botId}:slash`);
      const chunks = answer.match(/[\s\S]{1,1900}/g) || [];
      await interaction.editReply(chunks[0] || 'No response generated.');
      for (let i = 1; i < chunks.length; i += 1) {
        await interaction.followUp(chunks[i]);
      }
      recordBotResponse(botId, answer, Date.now() - startedAt);
    } catch (error) {
      console.error(`[DISCORD_GATEWAY:${botId}] /ask failed:`, error);
      recordBotError(botId, error);
      const fallback = 'Signal processing issue detected. Please retry in a few seconds.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(fallback);
      } else {
        await interaction.reply({ content: fallback, ephemeral: true });
      }
    }
  });
  if (enableMessageIntent) {
    client.on('messageCreate', async (message) => {
      if (message.author?.bot) return;
      const raw = String(message.content || '').trim();
      if (!raw) return;

      const botUserId = client.user?.id || '';
      const mentionPattern = botUserId ? new RegExp(`<@!?${botUserId}>`, 'g') : null;
      const isMentioned = Boolean(mentionPattern && mentionPattern.test(raw));
      const isAskPrefix = /^\/?ask\b/i.test(raw);
      if (!isMentioned && !isAskPrefix) return;

      const prompt = (mentionPattern ? raw.replace(mentionPattern, ' ') : raw).replace(/^\/?ask\b/i, '').trim();
      if (!prompt) {
        await message.reply('Send a prompt after mentioning me, or use: `ask your question`');
        recordBotError(botId, 'Missing prompt in message');
        return;
      }

      try {
        const startedAt = Date.now();
        recordBotIncoming(botId);
        await message.channel.sendTyping();
        const answer = await generateProfessionalReply(prompt, message.author?.id, `discord:${botId}:message`);
        const chunks = answer.match(/[\s\S]{1,1900}/g) || [];
        await message.reply(chunks[0] || 'No response generated.');
        for (let i = 1; i < chunks.length; i += 1) {
          await message.channel.send(chunks[i]);
        }
        recordBotResponse(botId, answer, Date.now() - startedAt);
      } catch (error) {
        console.error(`[DISCORD_GATEWAY:${botId}] message response failed:`, error);
        recordBotError(botId, error);
        await message.reply('Signal processing issue detected. Please retry in a few seconds.');
      }
    });
  } else {
    console.log(`[DISCORD_GATEWAY:${botId}] Message content intent disabled; use slash commands (/ask, /ping).`);
  }

  await client.login(botToken);
  discordGatewayClients.set(botId, client);
  return client;
};

const restorePersistedBots = async (): Promise<void> => {
  const state = loadPersistedBotState();
  if (!state.telegramBots.length && !state.discordBots.length) {
    return;
  }

  for (const tg of state.telegramBots) {
    const botId = String(tg.botId || '').trim();
    const botToken = String(tg.botToken || '').trim();
    if (!botId || !botToken) continue;

    botTokens.set(botId, botToken);
    if (tg.ownerEmail) {
      telegramBotOwners.set(botId, tg.ownerEmail.trim().toLowerCase());
      ensureBotTelemetry(botId, 'TELEGRAM', tg.ownerEmail.trim().toLowerCase());
    }

    if (!isProduction) {
      let localBot = managedBots.get(botToken);
      if (!localBot) {
        localBot = new TelegramBot(botToken, { polling: true });
        managedBots.set(botToken, localBot);
      }
      if (!managedBotListeners.has(botToken)) {
        localBot.on('message', async (msg) => {
          await handleBotMessage(botToken, msg);
        });
        managedBotListeners.add(botToken);
      }
    } else {
      try {
        await (global as any).setWebhookForBot(botToken, botId);
      } catch (error) {
        console.warn(`[BOT_STATE] Telegram webhook restore failed for ${botId}:`, (error as Error).message);
      }
    }
  }

  for (const dc of state.discordBots) {
    const botId = String(dc.botId || '').trim();
    const botToken = String(dc.botToken || '').trim();
    if (!botId || !botToken) continue;
    discordBots.set(botId, dc);
    ensureBotTelemetry(botId, 'DISCORD', (dc.createdBy || '').trim().toLowerCase());
    try {
      await connectDiscordGatewayClient(botId, botToken);
    } catch (error) {
      console.warn(`[BOT_STATE] Discord gateway restore failed for ${botId}:`, (error as Error).message);
    }
  }

  console.log(`[BOT_STATE] Restored ${state.telegramBots.length} Telegram and ${state.discordBots.length} Discord deployments`);
};

const getPersistedTelegramOwner = (botId: string): string => {
  const state = loadPersistedBotState();
  const item = state.telegramBots.find((b) => String(b.botId || '').trim() === botId);
  return String(item?.ownerEmail || '').trim().toLowerCase();
};

const getPersistedDiscordOwner = (botId: string): string => {
  const state = loadPersistedBotState();
  const item = state.discordBots.find((b) => String(b.botId || '').trim() === botId);
  return String(item?.createdBy || '').trim().toLowerCase();
};

const sendDiscordFollowUp = async (
  applicationId: string,
  interactionToken: string,
  content: string
): Promise<void> => {
  const safeContent = content.trim().slice(0, 1900) || 'No response generated.';
  await fetch(`https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: safeContent })
  });
};

const ensurePrimaryTelegramWebhook = async (): Promise<void> => {
  if (!isProduction || !TELEGRAM_TOKEN) return;
  const webhookUrl = `${BASE_URL}/webhook`;
  const secretToken = buildTelegramWebhookSecret('primary');
  const registerUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}${secretToken ? `&secret_token=${encodeURIComponent(secretToken)}` : ''}`;
  try {
    const response = await fetch(registerUrl);
    const data: any = await response.json().catch(() => ({}));
    if (!data?.ok) {
      console.warn('[WEBHOOK] Failed to auto-set primary Telegram webhook:', data?.description || 'Unknown error');
      return;
    }
    console.log('[WEBHOOK] Primary Telegram webhook is active:', webhookUrl);
  } catch (error) {
    console.warn('[WEBHOOK] Primary Telegram webhook auto-setup failed:', (error as Error).message);
  }
};

const sanitizeForTelegram = (text: string): string => {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/\*\*/g, '')
    .trim();
};

const toSentenceChunks = (text: string): string[] => {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
};

const isGreetingPrompt = (text: string): boolean => {
  const v = String(text || '').trim().toLowerCase();
  return /^(hi|hii|hello|hey|yo|good morning|good afternoon|good evening)\b[!. ]*$/.test(v);
};

const isSimplePrompt = (text: string): boolean => {
  const v = String(text || '').trim();
  if (!v) return true;
  if (v.length <= 40 && v.split(/\s+/).length <= 8) return true;
  return false;
};

const formatProfessionalResponse = (text: string, prompt: string): string => {
  const raw = sanitizeForTelegram(text);
  if (!raw) return raw;

  let cleaned = raw
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/^summary:\s*/i, '')
    .replace(/^next step:\s*/i, '')
    .replace(/^key points:\s*/i, '')
    .trim();

  if (isGreetingPrompt(prompt)) {
    return 'Hello! How can I help you today?';
  }

  // Remove forced boilerplate sections and keep direct answer only.
  cleaned = cleaned
    .replace(/\n{2,}(next step|summary|key points):[\s\S]*$/i, '')
    .trim();

  if (isSimplePrompt(prompt)) {
    const first = toSentenceChunks(cleaned)[0] || cleaned;
    return first;
  }
  return cleaned;
};

const ensureEmojiInReply = (text: string, prompt: string): string => {
  const value = String(text || '').trim();
  if (!value) return 'Got it.';
  return value;
};

const stripReconnectLoopReply = (text: string): string => {
  const value = String(text || '').trim();
  if (!value) return value;
  if (
    /reconnect(ing)?\s+ai\s+providers/i.test(value)
    || /please\s+retry\s+in\s+\d+\s*-\s*\d+\s*seconds/i.test(value)
    || /please\s+retry\s+in\s+\d+\s*seconds/i.test(value)
  ) {
    return 'I am online and ready to help right now. Please ask your question again.';
  }
  return value;
};

const hasCapabilityBoilerplate = (text: string): boolean => {
  const value = String(text || '').toLowerCase();
  return /early access|limitations|knowledge cutoff|october 2023|no real-time data access|i'm currently at v\d/.test(value);
};

const isTimeSensitivePrompt = (text: string): boolean => {
  const value = String(text || '').toLowerCase();
  return /(latest|today|current|recent|now|this year|202[4-9]|forecast|estimate|prediction|market|price|revenue|gdp|election|news)/.test(value);
};

const isComplexPrompt = (text: string): boolean => {
  const value = String(text || '').toLowerCase();
  return /(why|how|compare|strategy|analysis|estimate|forecast|roadmap|reason|explain|detailed|step by step)/.test(value) || value.length > 120;
};

const looksLowQualityAnswer = (answer: string, prompt: string): boolean => {
  const out = String(answer || '').trim();
  if (!out) return true;
  if (hasCapabilityBoilerplate(out)) return true;
  const lower = out.toLowerCase();
  if (/i am reconnecting ai providers|please retry in 10-20 seconds/.test(lower)) return true;
  if (isComplexPrompt(prompt) && out.length < 120) return true;
  return false;
};

const splitTelegramMessage = (text: string, maxLen: number = TELEGRAM_MAX_MESSAGE_LENGTH): string[] => {
  if (text.length <= maxLen) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    const idx = remaining.lastIndexOf('\n', maxLen);
    const cut = idx > 500 ? idx : maxLen;
    parts.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) parts.push(remaining);
  return parts;
};

const sendTelegramReply = async (targetBot: TelegramBot, chatId: number, text: string, replyTo?: number) => {
  const safe = sanitizeForTelegram(stripReconnectLoopReply(text));
  const chunks = splitTelegramMessage(safe);
  for (let i = 0; i < chunks.length; i += 1) {
    await targetBot.sendMessage(chatId, chunks[i], i === 0 && replyTo ? { reply_to_message_id: replyTo } : {});
  }
};

const sendTelegramStreamingReply = async (
  targetBot: TelegramBot,
  chatId: number,
  responsePromise: Promise<string>,
  replyTo?: number
): Promise<string> => {
  if (!TELEGRAM_STREAMING_ENABLED) {
    const resolved = await responsePromise;
    await sendTelegramReply(targetBot, chatId, resolved, replyTo);
    return resolved;
  }

  const progressFrames = [
    'Thinking...',
    'Analyzing your request...',
    'Preparing a high-quality response...'
  ];
  let frameIndex = 0;
  let placeholderMessageId: number | null = null;
  let progressInterval: NodeJS.Timeout | null = null;
  let awaiting = true;

  const startPlaceholderTimer = setTimeout(async () => {
    if (!awaiting) return;
    try {
      const placeholder = await targetBot.sendMessage(
        chatId,
        progressFrames[0],
        replyTo ? { reply_to_message_id: replyTo } : {}
      );
      placeholderMessageId = placeholder.message_id;
      progressInterval = setInterval(async () => {
        if (!awaiting || placeholderMessageId === null) return;
        frameIndex = (frameIndex + 1) % progressFrames.length;
        try {
          await targetBot.editMessageText(progressFrames[frameIndex], {
            chat_id: chatId,
            message_id: placeholderMessageId
          });
        } catch {
          // Ignore transient Telegram edit failures while waiting.
        }
      }, TELEGRAM_STREAM_PROGRESS_INTERVAL_MS);
    } catch {
      // Ignore placeholder failures and continue with final response send.
    }
  }, TELEGRAM_STREAM_START_DELAY_MS);

  try {
    const resolved = await responsePromise;
    awaiting = false;
    clearTimeout(startPlaceholderTimer);
    if (progressInterval) clearInterval(progressInterval);

    const safe = sanitizeForTelegram(stripReconnectLoopReply(resolved));
    const chunks = splitTelegramMessage(safe);
    if (placeholderMessageId !== null) {
      try {
        await targetBot.editMessageText(chunks[0] || 'No response generated.', {
          chat_id: chatId,
          message_id: placeholderMessageId
        });
        for (let i = 1; i < chunks.length; i += 1) {
          await targetBot.sendMessage(chatId, chunks[i]);
        }
      } catch {
        await sendTelegramReply(targetBot, chatId, resolved, replyTo);
      }
    } else {
      await sendTelegramReply(targetBot, chatId, resolved, replyTo);
    }
    return resolved;
  } catch (error) {
    awaiting = false;
    clearTimeout(startPlaceholderTimer);
    if (progressInterval) clearInterval(progressInterval);
    throw error;
  }
};

const buildConversationKey = (scope: string, chatIdentity?: string | number): string | null => {
  if (chatIdentity === undefined || chatIdentity === null) return null;
  const id = String(chatIdentity).trim();
  if (!id) return null;
  return `${scope}:${id}`;
};

const pruneAiResponseCache = (): void => {
  const now = Date.now();
  for (const [key, value] of aiResponseCache.entries()) {
    if (value.expiresAt <= now) {
      aiResponseCache.delete(key);
    }
  }
  const overflow = aiResponseCache.size - AI_CACHE_MAX_ENTRIES;
  if (overflow > 0) {
    const keysToDrop = Array.from(aiResponseCache.keys()).slice(0, overflow);
    for (const key of keysToDrop) {
      aiResponseCache.delete(key);
    }
  }
};

const clearConversationState = (conversationKey: string): void => {
  chatHistoryStore.delete(conversationKey);
  contextMetrics.delete(conversationKey);
  userProfiles.delete(conversationKey);
  for (const key of aiResponseCache.keys()) {
    if (key.startsWith(`${conversationKey}:`)) {
      aiResponseCache.delete(key);
    }
  }
  for (const key of aiInFlightRequests.keys()) {
    if (key.startsWith(`${conversationKey}:`)) {
      aiInFlightRequests.delete(key);
    }
  }
  persistChatMemory();
  persistContextMetrics();
  persistUserProfiles();
};

const getCommandReply = (messageText: string, conversationKey?: string): string | null => {
  const text = String(messageText || '').trim();
  const cmd = text.match(/^\/([a-z]+)(?:@\w+)?\b/i)?.[1]?.toLowerCase();
  if (!cmd) return null;
  if (cmd === 'help') {
    return 'Commands:\n/start - welcome message\n/help - show commands\n/reset - clear chat memory\n\nAsk any question directly after these commands.';
  }
  if (cmd === 'reset') {
    if (conversationKey) {
      clearConversationState(conversationKey);
    }
    return 'Your chat memory for this bot has been cleared. Start a new question.';
  }
  return null;
};

const getChatHistory = (conversationKey?: string): BotChatTurn[] => {
  if (!conversationKey) return [];
  const entry = chatHistoryStore.get(conversationKey);
  if (!entry) return [];
  if (Date.now() - entry.updatedAt > CHAT_HISTORY_TTL_MS) {
    chatHistoryStore.delete(conversationKey);
    return [];
  }
  return entry.history;
};

const persistChatMemory = (): void => {
  try {
    const dir = path.dirname(CHAT_MEMORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const serialized = JSON.stringify(
      Object.fromEntries(
        Array.from(chatHistoryStore.entries()).map(([chatId, entry]) => [String(chatId), entry])
      ),
      null,
      2
    );
    fs.writeFileSync(CHAT_MEMORY_FILE, serialized, 'utf8');
  } catch (error) {
    console.warn('[CHAT_MEMORY] Failed to persist chat memory:', (error as Error).message);
  }
};

const loadChatMemory = (): void => {
  try {
    if (!fs.existsSync(CHAT_MEMORY_FILE)) return;
    const raw = fs.readFileSync(CHAT_MEMORY_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, { history: BotChatTurn[]; updatedAt: number }>;
    for (const [storedKey, entry] of Object.entries(parsed || {})) {
      const legacyChatId = Number(storedKey);
      const conversationKey = storedKey.includes(':')
        ? storedKey
        : Number.isFinite(legacyChatId)
          ? buildConversationKey('telegram:primary', legacyChatId)
          : null;
      if (!conversationKey) continue;
      const history = Array.isArray(entry?.history) ? entry.history.slice(-CHAT_HISTORY_MAX_TURNS) : [];
      const updatedAt = Number(entry?.updatedAt || 0);
      if (!history.length) continue;
      if (updatedAt && Date.now() - updatedAt > CHAT_HISTORY_TTL_MS) continue;
      chatHistoryStore.set(conversationKey, { history, updatedAt: updatedAt || Date.now() });
    }
  } catch (error) {
    console.warn('[CHAT_MEMORY] Failed to load chat memory:', (error as Error).message);
  }
};

const persistContextMetrics = (): void => {
  try {
    const dir = path.dirname(CONTEXT_DB_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const serialized = JSON.stringify(
      Object.fromEntries(Array.from(contextMetrics.entries()).map(([chatId, metric]) => [String(chatId), metric])),
      null,
      2
    );
    fs.writeFileSync(CONTEXT_DB_FILE, serialized, 'utf8');
  } catch (error) {
    console.warn('[CONTEXT_DB] Failed to persist context metrics:', (error as Error).message);
  }
};

const loadContextMetrics = (): void => {
  try {
    if (!fs.existsSync(CONTEXT_DB_FILE)) return;
    const raw = fs.readFileSync(CONTEXT_DB_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, ContextMetric>;
    for (const [storedKey, metric] of Object.entries(parsed || {})) {
      const legacyChatId = Number(storedKey);
      const conversationKey = storedKey.includes(':')
        ? storedKey
        : Number.isFinite(legacyChatId)
          ? buildConversationKey('telegram:primary', legacyChatId)
          : null;
      if (!conversationKey) continue;
      contextMetrics.set(conversationKey, {
        totalPromptTokens: Number(metric?.totalPromptTokens || 0),
        totalResponseTokens: Number(metric?.totalResponseTokens || 0),
        updatedAt: Number(metric?.updatedAt || Date.now())
      });
    }
  } catch (error) {
    console.warn('[CONTEXT_DB] Failed to load context metrics:', (error as Error).message);
  }
};

const persistUserProfiles = (): void => {
  try {
    const dir = path.dirname(USER_PROFILE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const serialized = JSON.stringify(
      Object.fromEntries(Array.from(userProfiles.entries()).map(([chatId, profile]) => [String(chatId), profile])),
      null,
      2
    );
    fs.writeFileSync(USER_PROFILE_FILE, serialized, 'utf8');
  } catch (error) {
    console.warn('[USER_PROFILE] Failed to persist profiles:', (error as Error).message);
  }
};

const loadUserProfiles = (): void => {
  try {
    if (!fs.existsSync(USER_PROFILE_FILE)) return;
    const raw = fs.readFileSync(USER_PROFILE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, UserProfile>;
    for (const [storedKey, profile] of Object.entries(parsed || {})) {
      const legacyChatId = Number(storedKey);
      const conversationKey = storedKey.includes(':')
        ? storedKey
        : Number.isFinite(legacyChatId)
          ? buildConversationKey('telegram:primary', legacyChatId)
          : null;
      if (!conversationKey) continue;
      userProfiles.set(conversationKey, {
        preferredTone: profile?.preferredTone,
        prefersConcise: Boolean(profile?.prefersConcise),
        recurringTopics: Array.isArray(profile?.recurringTopics) ? profile.recurringTopics.slice(0, 5) : [],
        topicCounts: typeof profile?.topicCounts === 'object' && profile.topicCounts ? profile.topicCounts : {},
        updatedAt: Number(profile?.updatedAt || Date.now())
      });
    }
  } catch (error) {
    console.warn('[USER_PROFILE] Failed to load profiles:', (error as Error).message);
  }
};

const updateUserProfile = (conversationKey: string | undefined, userText: string): UserProfile | undefined => {
  if (!conversationKey) return undefined;
  const current = userProfiles.get(conversationKey) || {
    recurringTopics: [],
    topicCounts: {},
    updatedAt: Date.now()
  };
  const text = String(userText || '').toLowerCase();
  if (/(concise|short|brief)/.test(text)) {
    current.prefersConcise = true;
    current.preferredTone = 'concise';
  } else if (/\bformal\b/.test(text)) {
    current.preferredTone = 'formal';
  } else if (/\bcasual\b/.test(text)) {
    current.preferredTone = 'casual';
  } else if (/\bprofessional\b/.test(text)) {
    current.preferredTone = 'professional';
  }

  const stop = new Set(['what', 'when', 'where', 'which', 'about', 'with', 'this', 'that', 'have', 'from', 'your', 'please', 'tell', 'make', 'give']);
  const topics = text
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !stop.has(t))
    .slice(0, 12);
  for (const topic of topics) {
    current.topicCounts[topic] = (current.topicCounts[topic] || 0) + 1;
  }
  current.recurringTopics = Object.entries(current.topicCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([topic]) => topic);
  current.updatedAt = Date.now();
  userProfiles.set(conversationKey, current);
  persistUserProfiles();
  return current;
};

const appendChatHistory = (conversationKey: string | undefined, userText: string, modelText: string): void => {
  if (!conversationKey) return;
  const existing = getChatHistory(conversationKey);
  const next: BotChatTurn[] = [
    ...existing,
    { role: 'user' as const, parts: [{ text: userText }] },
    { role: 'model' as const, parts: [{ text: modelText }] }
  ].slice(-CHAT_HISTORY_MAX_TURNS);
  chatHistoryStore.set(conversationKey, { history: next, updatedAt: Date.now() });
  persistChatMemory();
};

const buildSystemPrompt = (
  intent: 'math' | 'current_event' | 'coding' | 'general',
  userProfile?: UserProfile
): string => {
  const timezone = (process.env.BOT_USER_TIMEZONE || '').trim();
  const role = (process.env.BOT_USER_ROLE || '').trim();
  const priorities = (process.env.BOT_USER_PRIORITIES || '').trim();

  const envProfile = [
    timezone ? `Timezone: ${timezone}` : '',
    role ? `User role: ${role}` : '',
    priorities ? `Top priorities: ${priorities}` : ''
  ].filter(Boolean).join('\n');

  const profileHints = [
    userProfile?.preferredTone ? `Preferred tone: ${userProfile.preferredTone}` : '',
    userProfile?.prefersConcise ? 'User prefers concise answers.' : '',
    userProfile?.recurringTopics?.length ? `Recurring topics: ${userProfile.recurringTopics.join(', ')}` : ''
  ].filter(Boolean).join('\n');

  const modeBlock = intent === 'coding'
    ? `Mode: Coding\n- Act like a senior engineer.\n- Prioritize correct, runnable solutions.\n- Keep explanations tight and practical.`
    : intent === 'math'
      ? `Mode: Math\n- Solve clearly and verify final result.`
      : intent === 'current_event'
        ? `Mode: Current Event\n- Prefer verified live context.\n- State "As of" date.\n- If uncertain, say what is uncertain.`
        : `Mode: General\n- Be clear, useful, and concise.`;

  const base = `
You are SwiftDeploy AI, a GPT-5.2 style professional assistant.

Rules:
- Give direct, accurate answers first.
- Use conversational tone by default; use structure only when it helps.
- Do not invent facts or sources.
- For time-sensitive questions, include current-year handling and "As of" date.
- For complex tasks, provide actionable steps.
${modeBlock}
${envProfile ? `\nUser profile:\n${envProfile}` : ''}
${profileHints ? `\nPersonalization hints:\n${profileHints}` : ''}
`.trim();
  const custom = (process.env.BOT_SYSTEM_PROMPT || '').trim();
  return custom ? `${base}\n\nAdditional instructions:\n${custom}` : base;
};

const detectIntent = (text: string): 'math' | 'current_event' | 'coding' | 'general' => {
  const value = String(text || '').toLowerCase();
  if ((/[+\-*/()]/.test(value) && /\d/.test(value) && value.length < 100) || /(^|\s)(solve|calculate|evaluate)\b/.test(value)) {
    return 'math';
  }
  if (/(code|typescript|javascript|python|sql|regex|debug|stack trace|api|function|class)/.test(value)) {
    return 'coding';
  }
  if (needsRealtimeSearch(value) || isTimeSensitivePrompt(value) || /(richest|top company|best phone|prime minister|president|ceo|stock price|net worth|ranking|leader|breaking news)/.test(value)) {
    return 'current_event';
  }
  return 'general';
};

const tryComputeMath = (text: string): string | null => {
  const cleaned = String(text || '').replace(/[^0-9+\-*/().\s]/g, '').trim();
  if (!cleaned || !/[+\-*/]/.test(cleaned) || !/\d/.test(cleaned)) return null;
  if (cleaned.length > 120) return null;
  try {
    const value = Function(`"use strict"; return (${cleaned});`)();
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return `### Direct Answer\n${value}\n\n### Explanation\nComputed directly from: \`${cleaned}\``;
  } catch {
    return null;
  }
};

const looksSuspiciousResponse = (prompt: string, response: string): boolean => {
  const out = String(response || '').trim();
  if (!out) return true;
  const q = String(prompt || '').toLowerCase();
  const r = out.toLowerCase();
  if (/(2026|2025|2024)/.test(q) && /\b2023\b/.test(r) && !/\b202[4-9]\b/.test(r)) return true;
  if (/i (can('?t|not)|don't) (browse|access real[- ]?time|verify current)/.test(r) && needsRealtimeSearch(q)) return true;
  if (/(market cap|gdp|revenue|population)/.test(q) && !/\d/.test(r)) return true;
  return false;
};

const hasLowConfidenceMarkers = (response: string): boolean => {
  const r = String(response || '').toLowerCase();
  return /as of 2023|based on available data|i may be wrong|might be outdated|not sure|cannot confirm/.test(r);
};

const selfVerifyAnswer = async (
  question: string,
  draftAnswer: string,
  history: BotChatTurn[],
  systemPrompt: string
): Promise<string> => {
  const verifyPrompt = `Verify the following answer for factual consistency and correctness. If incorrect, return a corrected answer in the same professional structure.\n\nQuestion:\n${question}\n\nDraft Answer:\n${draftAnswer}\n\nReturn only the final corrected answer.`;
  const verified = await withTimeout(
    generateBotResponse(verifyPrompt, undefined, history, systemPrompt),
    AI_RESPONSE_TIMEOUT_MS,
    'AI verification timeout'
  );
  return String(verified || draftAnswer).trim();
};

const generateProfessionalReply = async (
  messageText: string,
  chatIdentity?: string | number,
  scope: string = 'telegram:primary'
): Promise<string> => {
  const trimmedInput = String(messageText || '').trim();
  if (!trimmedInput) {
    return 'Please send a message so I can help.';
  }
  if (trimmedInput.length > MAX_USER_PROMPT_LENGTH) {
    return `Your message is too long (${trimmedInput.length} chars). Please keep it under ${MAX_USER_PROMPT_LENGTH} characters.`;
  }
  const conversationKey = buildConversationKey(scope, chatIdentity) || undefined;
  const commandReply = getCommandReply(trimmedInput, conversationKey);
  if (commandReply) {
    return commandReply;
  }

  const normalizedPrompt = trimmedInput.toLowerCase().replace(/\s+/g, ' ');
  if (isGreetingPrompt(normalizedPrompt)) {
    const fastGreeting = 'Hello! How can I help you today?';
    appendChatHistory(conversationKey, trimmedInput, fastGreeting);
    return fastGreeting;
  }
  if (/(what('?s| is)\s+your\s+name|your name\??)/.test(normalizedPrompt)) {
    const answer = 'I am SwiftDeploy AI assistant. I can help with coding, debugging, bot setup, deployment, and general questions.';
    appendChatHistory(conversationKey, trimmedInput, answer);
    return answer;
  }
  if (/(what can you do|capabilities|how can you help|what do you do)/.test(normalizedPrompt)) {
    const answer = 'I can answer questions, help fix code, troubleshoot deployment issues, and guide Telegram/Discord bot setup step by step.';
    appendChatHistory(conversationKey, trimmedInput, answer);
    return answer;
  }
  const timeSensitive = isTimeSensitivePrompt(normalizedPrompt);
  const intent = detectIntent(trimmedInput);
  const realtimeSearchRequested = needsRealtimeSearch(trimmedInput);
  const cacheScope = conversationKey || `${scope}:anonymous`;
  const cacheKey = `${cacheScope}:${normalizedPrompt}`;
  const cached = timeSensitive ? undefined : aiResponseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.text;
  }
  if (cached) {
    aiResponseCache.delete(cacheKey);
  }

  if (intent === 'math') {
    const computed = tryComputeMath(trimmedInput);
    if (computed) {
      appendChatHistory(conversationKey, trimmedInput, computed);
      return computed;
    }
  }

  const existingInFlight = aiInFlightRequests.get(cacheKey);
  if (existingInFlight) {
    return existingInFlight;
  }

  const run = (async (): Promise<string> => {
    const userProfile = updateUserProfile(conversationKey, trimmedInput);
    const systemPrompt = buildSystemPrompt(intent, userProfile);
    const startedAt = Date.now();
    console.log('[AI_LOG] request', JSON.stringify({
      chatId: chatIdentity || null,
      scope,
      intent,
      realtimeSearchTriggered: realtimeSearchRequested,
      question: trimmedInput.slice(0, 400)
    }));
    try {
      const history = getChatHistory(conversationKey);
      const response = await withTimeout(
        generateBotResponse(trimmedInput, undefined, history, systemPrompt),
        AI_RESPONSE_TIMEOUT_MS,
        'AI response timeout'
      );
      const polished = formatProfessionalResponse(response || 'No response generated.', trimmedInput);
      let clean = ensureEmojiInReply(
        polished,
        trimmedInput
      );
      if (AI_ENABLE_STRICT_RETRY && (intent === 'current_event' || timeSensitive) && hasLowConfidenceMarkers(clean)) {
        const strictRetryPrompt = `${trimmedInput}\n\nRealtime expected. Use verified live data strictly. Do not fall back to 2023 memory.`;
        const strictRetry = await withTimeout(
          generateBotResponse(strictRetryPrompt, undefined, history, systemPrompt),
          AI_RESPONSE_TIMEOUT_MS,
          'AI strict retry timeout'
        );
        clean = ensureEmojiInReply(
          formatProfessionalResponse(strictRetry || clean, trimmedInput),
          trimmedInput
        );
      }
      const shouldRetry = AI_MAX_RETRY_PASSES > 0
        && !isSimplePrompt(trimmedInput)
        && (looksLowQualityAnswer(clean, trimmedInput) || looksSuspiciousResponse(trimmedInput, clean));
      if (shouldRetry) {
        const retryPrompt = `${trimmedInput}\n\nAnswer directly with accurate, complete details. Avoid generic limitations text. For time-sensitive questions, include current-year context and assumptions.`;
        const retry = await withTimeout(
          generateBotResponse(retryPrompt, undefined, history, systemPrompt),
          AI_RESPONSE_TIMEOUT_MS,
          'AI response timeout'
        );
        const retryPolished = formatProfessionalResponse(retry || clean, trimmedInput);
        let retryClean = ensureEmojiInReply(
          retryPolished,
          trimmedInput
        );
        if (AI_ENABLE_SELF_VERIFY && intent === 'current_event' && !isSimplePrompt(trimmedInput)) {
          retryClean = ensureEmojiInReply(
            formatProfessionalResponse(await selfVerifyAnswer(trimmedInput, retryClean, history, systemPrompt), trimmedInput),
            trimmedInput
          );
        }
        appendChatHistory(conversationKey, trimmedInput, retryClean);
        if (!timeSensitive) {
          aiResponseCache.set(cacheKey, { text: retryClean, expiresAt: Date.now() + AI_CACHE_TTL_MS });
          pruneAiResponseCache();
        }
        console.log('[AI_LOG] response', JSON.stringify({
          chatId: chatIdentity || null,
          scope,
          intent,
          realtimeSearchTriggered: realtimeSearchRequested,
          latencyMs: Date.now() - startedAt,
          responseLength: retryClean.length,
          retried: true
        }));
        return retryClean;
      }
      if (AI_ENABLE_SELF_VERIFY && intent === 'current_event' && !isSimplePrompt(trimmedInput)) {
        clean = ensureEmojiInReply(
          formatProfessionalResponse(await selfVerifyAnswer(trimmedInput, clean, history, systemPrompt), trimmedInput),
          trimmedInput
        );
      }
      appendChatHistory(conversationKey, trimmedInput, clean);
      if (!timeSensitive) {
        aiResponseCache.set(cacheKey, { text: clean, expiresAt: Date.now() + AI_CACHE_TTL_MS });
        pruneAiResponseCache();
      }
      console.log('[AI_LOG] response', JSON.stringify({
        chatId: chatIdentity || null,
        scope,
        intent,
        realtimeSearchTriggered: realtimeSearchRequested,
        latencyMs: Date.now() - startedAt,
        responseLength: clean.length,
        retried: false
      }));
      return clean;
    } catch (error) {
      if (error instanceof Error && error.message.includes('LIVE_CONTEXT_UNAVAILABLE')) {
        return 'I cannot verify live current-year data right now. Please retry in a few seconds, and I will fetch fresh sources before answering.';
      }
      if (timeSensitive) {
        return 'Live verification failed for this time-sensitive query. Please retry in a few seconds so I can return a current, source-grounded answer.';
      }
      console.error('[AI] Primary model failed, switching to fallback:', error);
      try {
        const fallback = await withTimeout(
          getAIResponse(trimmedInput),
          AI_RESPONSE_TIMEOUT_MS,
          'Fallback AI response timeout'
        );
        const fallbackPolished = formatProfessionalResponse(fallback || 'No fallback response generated.', trimmedInput);
        const clean = ensureEmojiInReply(
          fallbackPolished,
          trimmedInput
        );
        appendChatHistory(conversationKey, trimmedInput, clean);
        if (!timeSensitive) {
          aiResponseCache.set(cacheKey, { text: clean, expiresAt: Date.now() + AI_CACHE_TTL_MS });
          pruneAiResponseCache();
        }
        console.log('[AI_LOG] response', JSON.stringify({
          chatId: chatIdentity || null,
          scope,
          intent,
          realtimeSearchTriggered: realtimeSearchRequested,
          latencyMs: Date.now() - startedAt,
          responseLength: clean.length,
          fallbackUsed: true
        }));
        return clean;
      } catch (fallbackError) {
        console.error('[AI] Fallback model failed:', fallbackError);
        const emergency = generateEmergencyReply(trimmedInput);
        aiResponseCache.set(cacheKey, { text: emergency, expiresAt: Date.now() + 15_000 });
        pruneAiResponseCache();
        console.error('[AI_LOG] error', JSON.stringify({
          chatId: chatIdentity || null,
          scope,
          intent,
          realtimeSearchTriggered: realtimeSearchRequested,
          latencyMs: Date.now() - startedAt,
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        }));
        return emergency;
      }
    }
  })();

  aiInFlightRequests.set(cacheKey, run);
  try {
    return await run;
  } finally {
    aiInFlightRequests.delete(cacheKey);
  }
};

// Telegram Bot Handler with debug logging
const handleTelegramMessage = async (msg: TelegramBot.Message) => {
  const chatId = msg.chat.id;
  const messageText = String(msg.text || '').trim();
  if (!messageText) return;
  
  console.log(`[TELEGRAM] Received message from ${msg.from?.username || 'Unknown'}: ${messageText}`);
  try {
    await bot.sendChatAction(chatId, 'typing');
    const response = await sendTelegramStreamingReply(
      bot,
      chatId,
      generateProfessionalReply(messageText, chatId, 'telegram:primary'),
      msg.message_id
    );
    console.log(`[TELEGRAM] Sending response length=${response.length}`);
  } catch (error) {
    console.error('[TELEGRAM] Failed to handle message:', error);
    await sendTelegramReply(bot, chatId, 'Signal processing issue detected. Please retry in a few seconds.', msg.message_id);
  }
};

// Function to handle messages for specific bots
const handleBotMessage = async (botToken: string, msg: any) => {
  const chatId = msg.chat.id;
  const text = String(msg.text || '').trim();
  const botId = getBotIdByTelegramToken(botToken);

  if (!text) return;
  if (text.length > MAX_USER_PROMPT_LENGTH) {
    const botInstance = managedBots.get(botToken) || new TelegramBot(botToken, { polling: false });
    if (!managedBots.has(botToken)) managedBots.set(botToken, botInstance);
    await sendTelegramReply(
      botInstance,
      chatId,
      `Your message is too long (${text.length} chars). Please keep it under ${MAX_USER_PROMPT_LENGTH} characters.`,
      msg.message_id
    );
    return;
  }
  if (botId) recordBotIncoming(botId);

  let botInstance = managedBots.get(botToken);
  if (!botInstance) {
    botInstance = new TelegramBot(botToken, { polling: false });
    managedBots.set(botToken, botInstance);
  }

  console.log(`[BOT_${botToken.substring(0, 8)}] Incoming message from ChatID: ${chatId}`);
  const botScope = `telegram:${botId || botToken.slice(0, 12)}`;

  if (/^\/start(?:@\w+)?$/i.test(text)) {
    const mode = (process.env.BOT_MODE || 'premium').trim().toLowerCase();
    const provider = (process.env.AI_PROVIDER || 'gemini').trim().toLowerCase();
    const activeModel =
      provider === 'gemini'
        ? (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim()
        : provider === 'moonshot'
          ? (process.env.MOONSHOT_MODEL || 'kimi-k2.5').trim()
          : provider === 'openai'
            ? (process.env.OPENAI_MODEL || 'gpt-5.2').trim()
            : provider === 'anthropic'
              ? (process.env.ANTHROPIC_MODEL || 'claude-opus-4-5').trim()
              : provider === 'openrouter'
                ? (process.env.OPENROUTER_MODEL || 'moonshotai/kimi-k2').trim()
                : provider === 'sarvam'
                  ? (process.env.SARVAM_MODEL || 'sarvam-m').trim()
                  : 'auto';
    const welcome = `*SwiftDeploy Bot Active.*\n\nAI Provider: ${provider}\nAI Model: ${activeModel}\nMode: ${mode === 'premium' ? 'Premium Assistant' : 'Standard'}\nStatus: Operational\n\nSend a message to start chatting with AI.`;
    await botInstance.sendMessage(chatId, welcome, { parse_mode: 'Markdown' });
    if (botId) recordBotResponse(botId, welcome, 0);
    return;
  }
  const commandReply = getCommandReply(text, buildConversationKey(botScope, chatId) || undefined);
  if (commandReply) {
    await sendTelegramReply(botInstance, chatId, commandReply, msg.message_id);
    if (botId) recordBotResponse(botId, commandReply, 0);
    return;
  }

  try {
    const startedAt = Date.now();
    await botInstance.sendChatAction(chatId, 'typing');
    const aiReply = await sendTelegramStreamingReply(
      botInstance,
      chatId,
      generateProfessionalReply(text, chatId, botScope),
      msg.message_id
    );
    if (botId) recordBotResponse(botId, aiReply, Date.now() - startedAt);
  } catch (err) {
    console.error(`[BOT_${botToken.substring(0, 8)}_FAIL] Failed to route signal:`, err);
    if (botId) recordBotError(botId, err);
    await sendTelegramReply(botInstance, chatId, 'Signal processing issue detected. Please retry in a few seconds.', msg.message_id);
  }
};

/**
 * Webhook Ingestion Routes
 */
// Webhook endpoint for Telegram
app.post('/webhook', (req, res) => {
  if (!verifyTelegramWebhookRequest(req, 'primary')) {
    return res.status(401).json({ error: 'Unauthorized webhook source' });
  }
  const message = req.body.message;
  if (message) {
    handleTelegramMessage(message);
  }
  return res.sendStatus(200);
});

// Bot-specific webhook routes
app.post('/webhook/:botId', (req, res) => {
  const { botId } = req.params;
  if (!verifyTelegramWebhookRequest(req, botId)) {
    return res.status(401).json({ error: 'Unauthorized webhook source' });
  }
  let botToken = botTokens.get(botId);

  // Lazy recovery: if process restarted and in-memory map is empty, hydrate from persisted state.
  if (!botToken) {
    const state = loadPersistedBotState();
    const match = state.telegramBots.find((b) => b.botId === botId);
    if (match?.botToken) {
      botToken = match.botToken;
      botTokens.set(match.botId, match.botToken);
      if (match.ownerEmail) {
        telegramBotOwners.set(match.botId, match.ownerEmail.trim().toLowerCase());
        ensureBotTelemetry(match.botId, 'TELEGRAM', match.ownerEmail.trim().toLowerCase());
      }
    }
  }
  
  if (!botToken) {
    console.error(`[WEBHOOK] No token found for bot ${botId}`);
    return res.status(404).json({ error: 'Bot not found' });
  }
  
  console.log(`[WEBHOOK] Received signal update for bot ${botId}`);
  
  // Handle the message
  if (req.body.message) {
    handleBotMessage(botToken, req.body.message).catch((error) => {
      console.error(`[WEBHOOK] Failed to handle message for bot ${botId}:`, error);
    });
  }
  
  return res.sendStatus(200);
});

/**
 * Gateway Provisioning
 */
app.get('/set-webhook', requireAdminAccess, async (req, res) => {
  if (!isProduction) {
    return res.json({
      ok: true,
      status: "Local Development Mode",
      endpoint: `${BASE_URL}/webhook`,
      telegram_meta: {
        ok: true,
        result: "Webhook skipped in local mode. Polling is active."
      }
    });
  }

  if (!TELEGRAM_TOKEN) {
    return res.status(400).json({ error: 'TELEGRAM_BOT_TOKEN is not configured' });
  }

  const webhookUrl = `${BASE_URL}/webhook`;
  const secretToken = buildTelegramWebhookSecret('primary');
  const registerUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}${secretToken ? `&secret_token=${encodeURIComponent(secretToken)}` : ''}`;
  
  console.log(`[PROVISIONING] Attempting to link webhook to: ${webhookUrl}`);
  
  try {
    const response = await fetch(registerUrl);
    const data: any = await response.json();
    
    console.log("[TELEGRAM_API] Handshake Response:", data);
    
    res.json({
      ok: true,
      status: "Operational",
      endpoint: webhookUrl,
      telegram_meta: data
    });
  } catch (err) {
    console.error("[HANDSHAKE_ERROR] Provisioning failed:", err);
    res.status(500).json({ error: "Provisioning gateway unreachable." });
  }
});


/**
 * Get Webhook Info
 */
app.get('/get-webhook-info', requireAdminAccess, async (req, res) => {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return res.status(400).json({ success: false, error: 'TELEGRAM_BOT_TOKEN is not configured' });
    }
    const getInfoUrl = `https://api.telegram.org/bot${botToken}/getWebhookInfo`;
    
    console.log('[WEBHOOK_INFO] Getting webhook info');
    
    const response = await fetch(getInfoUrl);
    const data: any = await response.json();
    
    console.log('[WEBHOOK_INFO] Telegram Response:', data);
    
    res.json({
      success: true,
      webhookInfo: data
    });
  } catch (error) {
    console.error(`[WEBHOOK_INFO] Error getting webhook info:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to get webhook info',
      details: (error as Error).message || 'Unknown error'
    });
  }
});

/**
 * Bot Deployment Route
 */
app.post('/deploy-bot', requireAuth, deployRateLimit, async (req, res) => {
  const botToken = typeof req.body?.botToken === 'string' ? req.body.botToken.trim() : '';
  const requestedBotId = typeof req.body?.botId === 'string' ? req.body.botId.trim() : '';
  const reqUser = req.user as Express.User | undefined;
  const userEmail = (reqUser?.email || '').trim().toLowerCase();
  
  if (!botToken) {
    return res.status(400).json({ error: 'Bot token is required' });
  }
  if (!userEmail) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(botToken)) {
    return res.status(400).json({ error: 'Invalid Telegram bot token format' });
  }

  const subscription = ensureUserSubscriptionState(userEmail);
  const isFreeExpired = subscription.plan === 'FREE' && Date.now() > subscription.freeTrialEndsAt;
  if (isFreeExpired || (subscription.plan === 'FREE' && subscription.freeDeployCount >= FREE_DEPLOY_LIMIT)) {
    return res.status(402).json({
      success: false,
      error: 'Free limit reached. Upgrade to Pro Fleet to deploy more bots.',
      plan: subscription.plan,
      freeDeployCount: subscription.freeDeployCount,
      freeDeployLimit: FREE_DEPLOY_LIMIT
    });
  }
  
  const fallbackBotId = botToken.split(':')[0] || '';
  const candidateBotId = requestedBotId || fallbackBotId;
  if (!candidateBotId) {
    return res.status(400).json({ error: 'Unable to derive bot ID from token. Please provide botId.' });
  }
  console.log(`[DEPLOY] Deploying bot ${candidateBotId} with token ${botToken.substring(0, 10)}...`);
  
  try {
    const verifyResponse = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const verifyData: any = await verifyResponse.json();
    if (!verifyData?.ok) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Telegram token',
        details: verifyData?.description || 'Telegram token validation failed'
      });
    }
    const telegramNumericId = String(verifyData?.result?.id || '').trim();
    const botId = telegramNumericId || candidateBotId;
    const currentOwner = (telegramBotOwners.get(botId) || getPersistedTelegramOwner(botId) || '').trim().toLowerCase();
    if (currentOwner && currentOwner !== userEmail) {
      return res.status(403).json({ success: false, error: 'Bot ID already belongs to another account' });
    }
    const botUsername = String(verifyData?.result?.username || '').trim();
    const botName = String(verifyData?.result?.first_name || '').trim();
    if (!botUsername) {
      return res.status(400).json({
        success: false,
        error: 'Telegram bot username missing',
        details: 'Create bot via @BotFather first, then use its token here.'
      });
    }
    const aiConfig = getActiveAiConfig();

    // Store the bot token
    botTokens.set(botId, botToken);
    telegramBotOwners.set(botId, userEmail);
    ensureBotTelemetry(botId, 'TELEGRAM', userEmail);

    if (!isProduction) {
      let localBot = managedBots.get(botToken);
      if (!localBot) {
        localBot = new TelegramBot(botToken, { polling: true });
        managedBots.set(botToken, localBot);
      }

      if (!managedBotListeners.has(botToken)) {
        localBot.on('message', async (msg) => {
          await handleBotMessage(botToken, msg);
        });
        managedBotListeners.add(botToken);
      }
    }
    
    // Set webhook for the bot
    const webhookResult = await (global as any).setWebhookForBot(botToken, botId);
    
    if (webhookResult.success) {
      if (subscription.plan === 'FREE') {
        userSubscriptionState.set(userEmail, {
          ...subscription,
          freeDeployCount: subscription.freeDeployCount + 1
        });
      }
      persistBotState();
      console.log(`[DEPLOY] Successfully deployed bot ${botId}`);
      res.json({
        success: true,
        message: 'Bot deployed successfully',
        botId,
        botUsername: botUsername || null,
        botName: botName || null,
        telegramLink: botUsername ? `https://t.me/${botUsername}` : null,
        aiProvider: aiConfig.provider,
        aiModel: aiConfig.model,
        aiModelLocked: true,
        webhookUrl: `${BASE_URL}/webhook/${botId}`,
        telegramResponse: webhookResult.data
      });
    } else {
      // Remove the bot token if webhook setup failed
      botTokens.delete(botId);
      telegramBotOwners.delete(botId);
      persistBotState();
      console.error(`[DEPLOY] Failed to deploy bot ${botId}:`, webhookResult.error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to set webhook', 
        details: webhookResult.error 
      });
    }
  } catch (error) {
    console.error(`[DEPLOY] Error deploying bot ${candidateBotId}:`, error);
    res.status(500).json({ 
      success: false, 
      error: 'Deployment failed', 
      details: (error as Error).message || 'Unknown error'
    });
  }
});

app.post('/deploy-discord-bot', requireAuth, deployRateLimit, async (req, res) => {
  const reqUser = req.user as Express.User | undefined;
  const userEmail = (reqUser?.email || '').trim().toLowerCase();
  const botId = typeof req.body?.botId === 'string' ? req.body.botId.trim() : '';
  const botToken = typeof req.body?.botToken === 'string' ? req.body.botToken.trim() : '';
  const applicationId = typeof req.body?.applicationId === 'string' ? req.body.applicationId.trim() : '';
  const publicKey = normalizeHex(typeof req.body?.publicKey === 'string' ? req.body.publicKey : '');

  if (!userEmail) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  if (!botId || !botToken || !applicationId || !publicKey) {
    return res.status(400).json({ success: false, error: 'Bot ID, token, application ID, and public key are required' });
  }
  if (!/^\d{17,20}$/.test(applicationId)) {
    return res.status(400).json({ success: false, error: 'Invalid Discord application ID format' });
  }
  if (!/^[0-9a-f]{64}$/.test(publicKey)) {
    return res.status(400).json({ success: false, error: 'Invalid Discord public key format' });
  }
  if (botToken.length < 50 || !botToken.includes('.')) {
    return res.status(400).json({ success: false, error: 'Invalid Discord bot token format' });
  }
  const discordOwner = (discordBots.get(botId)?.createdBy || getPersistedDiscordOwner(botId) || '').trim().toLowerCase();
  if (discordOwner && discordOwner !== userEmail) {
    return res.status(403).json({ success: false, error: 'Bot ID already belongs to another account' });
  }

  const subscription = ensureUserSubscriptionState(userEmail);
  const isFreeExpired = subscription.plan === 'FREE' && Date.now() > subscription.freeTrialEndsAt;
  if (isFreeExpired || (subscription.plan === 'FREE' && subscription.freeDeployCount >= FREE_DEPLOY_LIMIT)) {
    return res.status(402).json({
      success: false,
      error: 'Free limit reached. Upgrade to Pro Fleet to deploy more bots.',
      plan: subscription.plan,
      freeDeployCount: subscription.freeDeployCount,
      freeDeployLimit: FREE_DEPLOY_LIMIT
    });
  }

  try {
    const aiConfig = getActiveAiConfig();
    const meResponse = await fetch('https://discord.com/api/v10/users/@me', {
      method: 'GET',
      headers: { Authorization: `Bot ${botToken}` }
    });
    const meData: any = await meResponse.json().catch(() => ({}));
    if (!meResponse.ok || !meData?.id) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Discord bot token',
        details: meData?.message || 'Token validation failed'
      });
    }

    const commandsPayload = [
      {
        name: 'ask',
        description: 'Ask SwiftDeploy AI anything',
        type: 1,
        options: [
          {
            type: 3,
            name: 'question',
            description: 'Your question',
            required: true
          }
        ]
      },
      {
        name: 'ping',
        description: 'Check if your SwiftDeploy Discord bot is online',
        type: 1
      }
    ];

    const commandsResponse = await fetch(`https://discord.com/api/v10/applications/${applicationId}/commands`, {
      method: 'PUT',
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(commandsPayload)
    });
    const commandsData: any = await commandsResponse.json().catch(() => ({}));
    if (!commandsResponse.ok) {
      return res.status(502).json({
        success: false,
        error: 'Failed to register Discord slash commands',
        details: commandsData?.message || 'Discord API request failed'
      });
    }

    const gatewayClient = await connectDiscordGatewayClient(botId, botToken);
    ensureBotTelemetry(botId, 'DISCORD', userEmail);

    discordBots.set(botId, {
      botId,
      botToken,
      applicationId,
      publicKey,
      botUsername: gatewayClient.user?.tag || (meData?.username ? `${meData.username}${meData.discriminator ? `#${meData.discriminator}` : ''}` : undefined),
      createdBy: userEmail,
      createdAt: new Date().toISOString()
    });
    persistBotState();

    if (subscription.plan === 'FREE') {
      userSubscriptionState.set(userEmail, {
        ...subscription,
        freeDeployCount: subscription.freeDeployCount + 1
      });
    }

    const interactionUrl = `${BASE_URL}/discord/interactions/${botId}`;
    const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${applicationId}&permissions=274877975552&scope=bot%20applications.commands`;

    return res.json({
      success: true,
      botId,
      interactionUrl,
      inviteUrl,
      botName: meData?.username || 'Discord Bot',
      aiProvider: aiConfig.provider,
      aiModel: aiConfig.model,
      aiModelLocked: true,
      message: 'Discord bot deployed successfully'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Discord deployment failed',
      details: (error as Error).message || 'Unknown error'
    });
  }
});

app.post('/discord/interactions/:botId', async (req, res) => {
  const botId = String(req.params.botId || '').trim();
  const config = discordBots.get(botId);
  if (!config) {
    return res.status(404).json({ error: 'Bot not found' });
  }
  if (!verifyDiscordInteraction(req, config.publicKey)) {
    return res.status(401).json({ error: 'Invalid Discord signature' });
  }

  const body = req.body as any;
  const interactionType = Number(body?.type || 0);
  if (interactionType === 1) {
    return res.status(200).json({ type: 1 });
  }
  if (interactionType !== 2) {
    return res.status(200).json({ type: 4, data: { content: 'Unsupported interaction type.' } });
  }

  const commandName = String(body?.data?.name || '').toLowerCase();
  recordBotIncoming(botId);
  if (commandName === 'ping') {
    const pingReply = 'SwiftDeploy Discord node is online and ready.';
    recordBotResponse(botId, pingReply, 0);
    return res.status(200).json({
      type: 4,
      data: {
        content: pingReply
      }
    });
  }

  if (commandName !== 'ask') {
    recordBotError(botId, 'Unknown interaction command');
    return res.status(200).json({ type: 4, data: { content: 'Unknown command.' } });
  }

  const options = Array.isArray(body?.data?.options) ? body.data.options : [];
  const questionOption = options.find((opt: any) => opt?.name === 'question');
  const prompt = String(questionOption?.value || '').trim();
  if (!prompt) {
    return res.status(200).json({ type: 4, data: { content: 'Please provide a question.' } });
  }

  const interactionToken = String(body?.token || '').trim();
  const applicationId = String(body?.application_id || config.applicationId).trim();

  res.status(200).json({ type: 5 });

  try {
    const startedAt = Date.now();
    const discordUserId = String(body?.member?.user?.id || body?.user?.id || '').trim();
    const answer = await generateProfessionalReply(prompt, discordUserId, `discord:${botId}:interaction`);
    await sendDiscordFollowUp(applicationId, interactionToken, answer);
    recordBotResponse(botId, answer, Date.now() - startedAt);
  } catch (error) {
    recordBotError(botId, error);
    await sendDiscordFollowUp(applicationId, interactionToken, 'Signal processing issue detected. Please retry in a few seconds.');
  }
});

app.get('/discord/bot-status/:botId', requireAuth, (req, res) => {
  const botId = String(req.params.botId || '').trim();
  const reqUser = req.user as Express.User | undefined;
  const userEmail = (reqUser?.email || '').trim().toLowerCase();
  const config = discordBots.get(botId);
  const gatewayClient = discordGatewayClients.get(botId);
  if (!config) {
    return res.status(404).json({ success: false, error: 'Discord bot not found' });
  }
  if (!userEmail || String(config.createdBy || '').trim().toLowerCase() !== userEmail) {
    return res.status(403).json({ success: false, error: 'Access denied' });
  }
  return res.json({
    success: true,
    botId,
    interactionUrl: `${BASE_URL}/discord/interactions/${botId}`,
    commandsConfigured: true,
    gatewayConnected: Boolean(gatewayClient?.isReady()),
    botUsername: config.botUsername || 'Discord Bot',
    createdAt: config.createdAt
  });
});

/**
 * Get deployed bots
 */
app.get('/bots', requireAuth, (req, res) => {
  const reqUser = req.user as Express.User | undefined;
  const userEmail = (reqUser?.email || '').trim().toLowerCase();
  const telegramBots = Array.from(botTokens.entries())
    .filter(([id]) => String(telegramBotOwners.get(id) || '').trim().toLowerCase() === userEmail)
    .map(([id, token]) => ({
    id,
    platform: 'TELEGRAM',
    token: token.substring(0, 10) + '...' // Mask the token
  }));
  const discordItems = Array.from(discordBots.entries())
    .filter(([, cfg]) => String(cfg.createdBy || '').trim().toLowerCase() === userEmail)
    .map(([id, cfg]) => ({
    id,
    platform: 'DISCORD',
    token: cfg.botToken.slice(0, 10) + '...',
    applicationId: cfg.applicationId
  }));

  res.json({ bots: [...telegramBots, ...discordItems] });
});

/**
 * Email Verification Routes
 */

// Simulate email domain validation - in production, use actual MX record checking
const validateEmailDomain = async (domain: string): Promise<boolean> => {
  // In production, you would:
  // 1. Check MX records using DNS lookup
  // 2. Verify the domain exists and accepts emails
  // 3. Check against known spam/blocked domains
  
  // For development, we'll simulate a basic check
  const blockedDomains = [
    'example.com', 'test.com', 'invalid.com', 'fake.com'
  ];
  
  if (blockedDomains.includes(domain.toLowerCase())) {
    return false;
  }
  
  // Simulate network delay for domain validation
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // For now, return true for most domains in development
  // In production, implement actual MX record validation
  return true;
};

// Password strength validation
const validatePasswordStrength = (password: string) => {
  const minLength = password.length >= 8;
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumbers = /[0-9]/.test(password);
  const hasSpecialChar = /[!@#$%^&*(),.?"{}|<>]/.test(password);
  
  return {
    isValid: minLength && hasUpperCase && hasLowerCase && hasNumbers && hasSpecialChar,
    errors: [
      !minLength && 'At least 8 characters',
      !hasUpperCase && 'One uppercase letter',
      !hasLowerCase && 'One lowercase letter',
      !hasNumbers && 'One number',
      !hasSpecialChar && 'One special character'
    ].filter(Boolean)
  };
};

const isValidEmailFormat = (email: string) => {
  const emailRegex = /^(?=.{1,254}$)(?=.{1,64}@)[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;
  return emailRegex.test(email);
};

const sendError = (res: express.Response, status: number, message: string) => {
  return res.status(status).json({ message });
};

// Send verification email with enhanced security
app.post('/send-verification', async (req, res) => {
  const { email, name, password } = req.body;
  
  if (!email || !name || !password) {
    return sendError(res, 400, 'Email, name, and password are required');
  }

  if (!isValidEmailFormat(email)) {
    return sendError(res, 400, 'Invalid email format');
  }
  
  // Check for disposable email providers (common spam domains)
  const disposableDomains = [
    'tempmail.com', '10minutemail.com', 'guerrillamail.com', 'mailinator.com',
    'yopmail.com', 'temp-mail.org', 'throwawaymail.com', 'fakeinbox.com'
  ];
  
  const emailDomain = email.split('@')[1].toLowerCase();
  if (disposableDomains.includes(emailDomain)) {
    return sendError(res, 400, 'Invalid email format');
  }
  
  // Check if email is already registered
  if (isEmailRegistered(email)) {
    return sendError(res, 403, 'Account already exists');
  }
  
  // Password strength validation
  const passwordStrength = validatePasswordStrength(password);
  if (!passwordStrength.isValid) {
    return sendError(res, 400, 'Password must meet security requirements');
  }
  
  // 5. Enhanced email existence validation (MX record check)
  try {
    const domain = email.split('@')[1];
    // In production, you'd want to check MX records here
    // For now, we'll do a basic domain validation
    console.log(`[EMAIL] Validating domain: ${domain}`);
    
    // Simulate domain validation - in production use actual MX record checking
    // This is a placeholder for real email validation service
    const isValidDomain = await validateEmailDomain(domain);
    if (!isValidDomain) {
      return sendError(res, 400, 'Email domain does not exist or is not accepting emails');
    }
  } catch (error) {
    console.error(`[EMAIL] Domain validation error:`, error);
    // Don't fail the request for domain validation errors in development
    if (process.env.NODE_ENV === 'production') {
      return sendError(res, 400, 'Unable to validate email domain. Please check the email address.');
    }
  }
  
  console.log(`[EMAIL] Proceeding with verification for ${email}`);
  

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    storePendingSignup(email, name, passwordHash);

    const success = await sendVerificationEmail(email, name);

    if (!success) {
      clearPendingSignup(email);
      return sendError(res, 500, 'Failed to send verification email');
    }

    return res.json({
      success: true,
      message: 'OTP sent'
    });
  } catch (error) {
    clearPendingSignup(email);
    return sendError(res, 500, 'Internal server error');
  }
});

app.post('/resend-verification', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return sendError(res, 400, 'Email is required');
  }

  if (!isValidEmailFormat(email)) {
    return sendError(res, 400, 'Invalid email format');
  }

  if (isEmailRegistered(email)) {
    return sendError(res, 403, 'Account already exists');
  }

  const pending = getPendingSignup(email);
  if (!pending) {
    return sendError(res, 400, 'Invalid request');
  }

  try {
    const success = await sendVerificationEmail(email, pending.name);
    if (!success) {
      return sendError(res, 500, 'Failed to send verification email');
    }

    return res.json({ success: true, message: 'OTP sent' });
  } catch (error) {
    return sendError(res, 500, 'Internal server error');
  }
});

// Verify email code
app.post('/verify-email', async (req, res) => {
  const { email, code } = req.body;
  
  if (!email || !code) {
    return sendError(res, 400, 'Email and code are required');
  }

  if (!isValidEmailFormat(email)) {
    return sendError(res, 400, 'Invalid email format');
  }

  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    return sendError(res, 400, 'Invalid or expired verification code');
  }

  const pending = getPendingSignup(email);
  if (!pending) {
    return sendError(res, 400, 'Invalid or expired verification code');
  }

  const verificationResult = validateVerificationCode(email, code);
  if (!verificationResult.ok) {
    if (verificationResult.reason === 'attempts_exceeded') {
      return sendError(res, 403, 'OTP verification attempts exceeded');
    }
    return sendError(res, 400, 'Invalid or expired verification code');
  }

  const user = markEmailAsRegistered(email, pending.name, pending.passwordHash);
  const subscription = setUserPlan(user.email, user.plan);
  const userInfo = {
    id: user.id,
    email: user.email,
    name: user.name,
    photo: undefined,
    plan: subscription.plan,
    isSubscribed: subscription.isSubscribed
  };

  (req as any).login(userInfo, (err: any) => {
    if (err) {
      return sendError(res, 500, 'Internal server error');
    }
    return res.json({
      success: true,
      message: 'Email verified successfully',
      user: userInfo
    });
  });
});

// Test email route
app.post('/test-email', requireAdminAccess, async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  
  console.log(`[EMAIL] Sending test email to ${email}`);
  
  try {
    const success = await sendTestEmail(email);
    
    if (success) {
      res.json({ 
        success: true, 
        message: 'Test email sent successfully' 
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: 'Failed to send test email' 
      });
    }
  } catch (error) {
    console.error(`[EMAIL] Error sending test email:`, error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

// Get pending verifications (for debugging)
app.get('/pending-verifications', requireAdminAccess, (req, res) => {
  const verifications = getPendingVerifications();
  res.json({ verifications });
});

/**
 * System Health Check
 */
// Google OAuth Routes
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login` }),
  (req, res) => {
    // Successful authentication - redirect to home page
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/`);
  }
);

app.post('/auth/google/access-token', async (req, res) => {
  const accessToken = typeof req.body?.accessToken === 'string' ? req.body.accessToken.trim() : '';
  if (!accessToken) {
    return sendError(res, 400, 'Missing Google access token');
  }

  try {
    const tokenInfoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
    if (!tokenInfoRes.ok) {
      return sendError(res, 401, 'Invalid Google access token');
    }

    const tokenInfo: any = await tokenInfoRes.json();
    const expectedAud = process.env.GOOGLE_CLIENT_ID;
    if (expectedAud && tokenInfo.aud !== expectedAud) {
      return sendError(res, 401, 'Google client mismatch');
    }

    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!userInfoRes.ok) {
      return sendError(res, 401, 'Failed to fetch Google profile');
    }

    const profile: any = await userInfoRes.json();
    if (!profile?.email || !profile?.sub || !profile?.email_verified) {
      return sendError(res, 401, 'Google account verification failed');
    }

    const subscription = ensureUserSubscriptionState(String(profile.email).toLowerCase());
    const userInfo = {
      id: String(profile.sub),
      email: String(profile.email).toLowerCase(),
      name: String(profile.name || profile.email).trim(),
      photo: profile.picture ? String(profile.picture) : undefined,
      plan: subscription.plan,
      isSubscribed: subscription.isSubscribed
    };

    (req as any).login(userInfo, (err: any) => {
      if (err) {
        return sendError(res, 500, 'Internal server error');
      }

      return res.json({
        success: true,
        message: 'Google login successful',
        user: userInfo
      });
    });
  } catch {
    return sendError(res, 500, 'Google sign-in failed');
  }
});

// Login route - validate credentials and authenticate user
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return sendError(res, 400, 'Email and password are required');
  }
  
  if (!isValidEmailFormat(email)) {
    return sendError(res, 400, 'Invalid email format');
  }
  
  if (!isEmailRegistered(email)) {
    return sendError(res, 401, 'Account does not exist');
  }
  
  const user = getUserByEmail(email);
  
  if (!user) {
    return sendError(res, 401, 'Account does not exist');
  }
  
  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
  
  if (!isPasswordValid) {
    return sendError(res, 401, 'Invalid email or password');
  }
  
  const subscription = ensureUserSubscriptionState(user.email);
  if (user.plan && user.plan !== subscription.plan) {
    setUserPlan(user.email, user.plan as PlanType);
  }
  const latestSubscription = ensureUserSubscriptionState(user.email);
  const userInfo = {
    id: user.id,
    email: user.email,
    name: user.name,
    photo: undefined,
    plan: latestSubscription.plan,
    isSubscribed: latestSubscription.isSubscribed
  };
  
  (req as any).login(userInfo, (err: any) => {
    if (err) {
      return sendError(res, 500, 'Internal server error');
    }
    
    res.json({ 
      success: true,
      message: 'Login successful',
      user: userInfo
    });
  });
});

// Get current user info
app.get('/me', (req, res) => {
  if (req.user) {
    const sessionUser = req.user as Express.User;
    const email = (sessionUser.email || '').trim().toLowerCase();
    const subscription = email ? ensureUserSubscriptionState(email) : { plan: 'FREE' as PlanType, isSubscribed: false };
    res.json({
      user: {
        ...sessionUser,
        plan: subscription.plan,
        isSubscribed: subscription.isSubscribed
      }
    });
  } else {
    res.status(401).json({ message: 'Not authenticated' });
  }
});

// Logout route
app.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ message: 'Error logging out' });
    }
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: 'Error destroying session' });
      }
      res.clearCookie('connect.sid');
      res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`);
    });
  });
});

app.get('/automation/rules', requireAuth, (req, res) => {
  const reqUser = req.user as Express.User | undefined;
  const email = (reqUser?.email || '').trim().toLowerCase();
  if (!email) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  const rules = getAutomationRulesForUser(email);
  return res.json({ success: true, rules });
});

app.post('/automation/rules', requireAuth, (req, res) => {
  const reqUser = req.user as Express.User | undefined;
  const email = (reqUser?.email || '').trim().toLowerCase();
  if (!email) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  const name = String(req.body?.name || '').trim();
  const description = String(req.body?.description || '').trim();
  const trigger = String(req.body?.trigger || '').trim().toUpperCase() as AutomationTrigger;
  const action = String(req.body?.action || '').trim().toUpperCase() as AutomationAction;
  const keyword = String(req.body?.keyword || '').trim().toLowerCase();
  const cooldownSec = Math.max(0, Math.min(3600, Number(req.body?.cooldownSec || 0)));

  const validTriggers: AutomationTrigger[] = ['KEYWORD', 'MENTION', 'SILENCE_GAP', 'HIGH_VOLUME'];
  const validActions: AutomationAction[] = ['AUTO_REPLY', 'ESCALATE', 'TAG', 'DELAY_REPLY'];
  if (!name || !description || !validTriggers.includes(trigger) || !validActions.includes(action)) {
    return res.status(400).json({ success: false, message: 'Invalid automation rule payload' });
  }
  if (trigger === 'KEYWORD' && !keyword) {
    return res.status(400).json({ success: false, message: 'Keyword is required for KEYWORD trigger' });
  }

  const rules = getAutomationRulesForUser(email);
  const now = new Date().toISOString();
  const newRule: AutomationRule = {
    id: randomUUID(),
    name,
    description,
    trigger,
    action,
    keyword: trigger === 'KEYWORD' ? keyword : undefined,
    cooldownSec,
    active: true,
    createdAt: now,
    updatedAt: now,
    runCount: 0,
    successCount: 0
  };
  rules.unshift(newRule);
  automationRulesByUser.set(email, rules);
  return res.json({ success: true, rule: newRule, rules });
});

app.patch('/automation/rules/:ruleId', requireAuth, (req, res) => {
  const reqUser = req.user as Express.User | undefined;
  const email = (reqUser?.email || '').trim().toLowerCase();
  const ruleId = String(req.params.ruleId || '').trim();
  if (!email) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  const rules = getAutomationRulesForUser(email);
  const idx = rules.findIndex((r) => r.id === ruleId);
  if (idx < 0) {
    return res.status(404).json({ success: false, message: 'Rule not found' });
  }

  const current = rules[idx];
  const nextActive = typeof req.body?.active === 'boolean' ? req.body.active : !current.active;
  const updated: AutomationRule = {
    ...current,
    active: nextActive,
    updatedAt: new Date().toISOString()
  };
  rules[idx] = updated;
  automationRulesByUser.set(email, rules);
  return res.json({ success: true, rule: updated, rules });
});

app.delete('/automation/rules/:ruleId', requireAuth, (req, res) => {
  const reqUser = req.user as Express.User | undefined;
  const email = (reqUser?.email || '').trim().toLowerCase();
  const ruleId = String(req.params.ruleId || '').trim();
  if (!email) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  const rules = getAutomationRulesForUser(email);
  const next = rules.filter((r) => r.id !== ruleId);
  automationRulesByUser.set(email, next);
  return res.json({ success: true, rules: next });
});

app.post('/automation/rules/:ruleId/simulate', requireAuth, (req, res) => {
  const reqUser = req.user as Express.User | undefined;
  const email = (reqUser?.email || '').trim().toLowerCase();
  const ruleId = String(req.params.ruleId || '').trim();
  const botId = String(req.body?.botId || '').trim();
  if (!email) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  const rules = getAutomationRulesForUser(email);
  const rule = rules.find((r) => r.id === ruleId);
  if (!rule) {
    return res.status(404).json({ success: false, message: 'Rule not found' });
  }

  const telemetry = botId ? botTelemetry.get(botId) : undefined;
  const traffic = telemetry?.messageCount || 0;
  const baseRuns = Math.max(1, Math.round(traffic * 0.25));
  const actionFactor = rule.action === 'AUTO_REPLY' ? 0.86 : rule.action === 'ESCALATE' ? 0.72 : rule.action === 'TAG' ? 0.92 : 0.78;
  const triggerFactor = rule.trigger === 'KEYWORD' ? 0.75 : rule.trigger === 'MENTION' ? 0.82 : rule.trigger === 'SILENCE_GAP' ? 0.66 : 0.58;
  const estimatedRuns = Math.max(1, Math.round(baseRuns * triggerFactor));
  const estimatedSuccess = Math.max(0, Math.round(estimatedRuns * actionFactor));
  const estimatedImpactPct = Math.max(5, Math.min(70, Math.round((estimatedSuccess / Math.max(1, traffic || estimatedRuns)) * 100 + 12)));
  const confidencePct = Math.max(45, Math.min(97, Math.round(60 + triggerFactor * 20 + actionFactor * 10)));

  rule.runCount += estimatedRuns;
  rule.successCount += estimatedSuccess;
  rule.updatedAt = new Date().toISOString();
  automationRulesByUser.set(email, rules);

  return res.json({
    success: true,
    simulation: {
      ruleId: rule.id,
      ruleName: rule.name,
      estimatedRuns,
      estimatedSuccess,
      estimatedImpactPct,
      confidencePct,
      basedOnBotId: botId || null,
      observedTraffic: traffic
    },
    rule
  });
});

app.post('/ai/respond', requireAuth, async (req, res) => {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!prompt) {
    return res.status(400).json({ success: false, message: 'Prompt is required' });
  }
  if (prompt.length > 4000) {
    return res.status(400).json({ success: false, message: 'Prompt is too long' });
  }
  try {
    const response = await generateProfessionalReply(prompt);
    return res.json({ success: true, response });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to generate response' });
  }
});

app.get('/plan/status', requireAuth, (req, res) => {
  const user = req.user as Express.User;
  const email = (user.email || '').trim().toLowerCase();
  const subscription = ensureUserSubscriptionState(email);
  return res.json({
    success: true,
    plan: subscription.plan,
    isSubscribed: subscription.isSubscribed,
    freeDeployCount: subscription.freeDeployCount,
    freeDeployLimit: FREE_DEPLOY_LIMIT,
    freeTrialEndsAt: new Date(subscription.freeTrialEndsAt).toISOString()
  });
});

app.post('/forgot-password/send-code', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!email) {
    return sendError(res, 400, 'Email is required');
  }
  if (!isValidEmailFormat(email)) {
    return sendError(res, 400, 'Invalid email format');
  }

  const user = getUserByEmail(email);
  if (!user) {
    return sendError(res, 404, 'No account found for this email');
  }

  try {
    const verification = await sendVerificationEmail(email, user.name || 'User');
    if (!verification.success) {
      return sendError(res, 500, verification.message || 'Failed to send reset code');
    }
    return res.json({
      success: true,
      message: 'Password reset code sent to your email'
    });
  } catch {
    return sendError(res, 500, 'Failed to send reset code');
  }
});

app.post('/forgot-password/reset', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!email || !code || !password) {
    return sendError(res, 400, 'Email, code and new password are required');
  }
  if (!isValidEmailFormat(email)) {
    return sendError(res, 400, 'Invalid email format');
  }
  if (!/^\d{6}$/.test(code)) {
    return sendError(res, 400, 'Invalid reset code');
  }

  const user = getUserByEmail(email);
  if (!user) {
    return sendError(res, 404, 'No account found for this email');
  }

  const passwordStrength = validatePasswordStrength(password);
  if (!passwordStrength.isValid) {
    return sendError(res, 400, `Password must contain: ${passwordStrength.errors.join(', ')}`);
  }
  if (password.length > 128) {
    return sendError(res, 400, 'Password must be 128 characters or less');
  }

  const verificationResult = validateVerificationCode(email, code);
  if (!verificationResult.ok) {
    return sendError(res, 400, 'Invalid or expired reset code');
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    updateUserPassword(email, passwordHash);
    return res.json({
      success: true,
      message: 'Password reset successful'
    });
  } catch {
    return sendError(res, 500, 'Failed to reset password');
  }
});

app.get('/billing/stripe-account', requireAuth, (req, res) => {
  const stripeSecretKey = getStripeSecretKey();
  const stripePublishableKey = (process.env.STRIPE_PUBLISHABLE_KEY || '').trim();
  const configured = stripeSecretKey.startsWith('sk_');
  const publishableConfigured = stripePublishableKey.startsWith('pk_');
  const mode = stripeSecretKey.startsWith('sk_live_') ? 'live' : 'test';
  const accountLabel = (process.env.STRIPE_ACCOUNT_LABEL || 'Stripe Secure Checkout').trim();

  return res.json({
    success: true,
    configured,
    publishableConfigured,
    mode: configured ? mode : 'not_configured',
    accountLabel,
    processor: 'Stripe'
  });
});

app.post('/billing/activate-plan', requireAuth, (req, res) => {
  const reqUser = req.user as Express.User | undefined;
  const email = (reqUser?.email || '').trim().toLowerCase();
  if (!email) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  const tierRaw = String(req.body?.tier || 'PRO').trim().toUpperCase();
  const tier: BillingTier = tierRaw === 'STARTER' ? 'STARTER' : tierRaw === 'ENTERPRISE' ? 'ENTERPRISE' : 'PRO';
  const plan: PlanType = tier === 'STARTER' ? 'PRO_MONTHLY' : tier === 'PRO' ? 'PRO_YEARLY' : 'CUSTOM';
  const updated = setUserPlan(email, plan);
  return res.json({ success: true, plan: updated.plan, tier, isSubscribed: updated.isSubscribed });
});

app.post('/billing/create-checkout-session', requireAuth, billingRateLimit, async (req, res) => {
  const plan = String(req.body?.plan || '').trim().toUpperCase();
  let tier: BillingTier | null = null;
  if (plan === 'STARTER' || plan === 'PRO' || plan === 'ENTERPRISE') {
    tier = plan;
  }
  if (!tier) {
    return res.status(400).json({ success: false, message: 'Invalid billing plan selected.' });
  }

  const providerRaw = String(req.body?.provider || req.body?.paymentProvider || 'stripe').trim().toLowerCase();
  const provider: 'stripe' | 'razorpay' = providerRaw === 'razorpay' ? 'razorpay' : 'stripe';

  const tierPricing = {
    STARTER: { usdCents: 2900, inrPaise: 99900 },
    PRO: { usdCents: 7900, inrPaise: 349900 },
    ENTERPRISE: { usdCents: 39900, inrPaise: 1299900 }
  } as const;

  const billingDetails = req.body?.billingDetails ?? {};
  const fullName = typeof billingDetails.fullName === 'string' ? billingDetails.fullName.trim() : '';
  const reqUser = req.user as Express.User | undefined;
  const emailSource = typeof billingDetails.email === 'string' && billingDetails.email.trim()
    ? billingDetails.email
    : (reqUser?.email || '');
  const email = emailSource.trim().toLowerCase();
  const country = typeof billingDetails.country === 'string' ? billingDetails.country.trim() : '';
  const city = typeof billingDetails.city === 'string' ? billingDetails.city.trim() : '';
  const addressLine1 = typeof billingDetails.addressLine1 === 'string' ? billingDetails.addressLine1.trim() : '';
  const postalCode = typeof billingDetails.postalCode === 'string' ? billingDetails.postalCode.trim() : '';

  const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

  if (!email || email.length > 254 || !emailRegex.test(email)) {
    return res.status(400).json({ success: false, message: 'Please provide a valid billing email.' });
  }
  if (fullName.length > 100) {
    return res.status(400).json({ success: false, message: 'Please provide a valid full name.' });
  }
  if (country.length > 80 || city.length > 80) {
    return res.status(400).json({ success: false, message: 'Please provide valid billing location details.' });
  }
  if (addressLine1.length > 140 || postalCode.length > 20) {
    return res.status(400).json({ success: false, message: 'Please provide a valid billing address.' });
  }

  const frontUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const successUrl = `${frontUrl}/#/billing?plan=${tier.toLowerCase()}&checkout=success`;
  const cancelUrl = `${frontUrl}/#/billing?plan=${tier.toLowerCase()}&checkout=cancel`;

  try {
    if (provider === 'stripe') {
      const stripeSecretKey = getStripeSecretKey();
      if (!stripeSecretKey || !stripeSecretKey.startsWith('sk_')) {
        return res.status(500).json({ success: false, message: 'Stripe is not configured on the server.' });
      }

      const params = new URLSearchParams();
      params.set('mode', 'subscription');
      params.set('success_url', successUrl);
      params.set('cancel_url', cancelUrl);
      params.set('customer_email', email);
      params.set('billing_address_collection', 'required');
      params.set('payment_method_types[0]', 'card');
      params.set('client_reference_id', reqUser?.id || randomUUID());
      params.set('metadata[plan]', tier);
      params.set('metadata[provider]', 'stripe');
      params.set('metadata[user_email]', email);
      params.set('line_items[0][price_data][currency]', 'usd');
      params.set('line_items[0][price_data][recurring][interval]', 'month');
      params.set('line_items[0][price_data][unit_amount]', String(tierPricing[tier].usdCents));
      params.set('line_items[0][price_data][product_data][name]', `SwiftDeploy ${tier} Plan`);
      params.set('line_items[0][quantity]', '1');

      const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${stripeSecretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Idempotency-Key': randomUUID()
        },
        body: params.toString()
      });
      const stripeData: any = await stripeResponse.json().catch(() => ({}));
      if (!stripeResponse.ok || !stripeData?.url) {
        return res.status(502).json({ success: false, message: stripeData?.error?.message || 'Unable to create Stripe checkout session.' });
      }
      return res.json({ success: true, provider: 'stripe', checkoutUrl: stripeData.url, sessionId: stripeData.id });
    }

    const razorpayKeyId = (process.env.RAZORPAY_KEY_ID || '').trim();
    const razorpayKeySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
    if (!razorpayKeyId || !razorpayKeySecret) {
      return res.status(500).json({ success: false, message: 'Razorpay is not configured on the server.' });
    }

    const auth = Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString('base64');
    const payload = {
      amount: tierPricing[tier].inrPaise,
      currency: 'INR',
      accept_partial: false,
      description: `SwiftDeploy ${tier} Plan (Monthly)`,
      customer: {
        name: fullName || reqUser?.name || 'SwiftDeploy User',
        email
      },
      notify: { sms: false, email: true },
      reminder_enable: true,
      callback_url: successUrl,
      callback_method: 'get',
      notes: {
        plan: tier,
        provider: 'razorpay',
        country,
        city
      }
    };

    const razorpayResponse = await fetch('https://api.razorpay.com/v1/payment_links', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const razorpayData: any = await razorpayResponse.json().catch(() => ({}));
    if (!razorpayResponse.ok || !razorpayData?.short_url) {
      return res.status(502).json({ success: false, message: razorpayData?.error?.description || 'Unable to create Razorpay payment link.' });
    }
    return res.json({
      success: true,
      provider: 'razorpay',
      checkoutUrl: razorpayData.short_url,
      sessionId: razorpayData.id
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: 'Failed to initialize secure checkout.'
    });
  }
});

app.post('/billing/create-credit-session', requireAuth, billingRateLimit, async (req, res) => {
  const reqUser = req.user as Express.User | undefined;
  const email = (reqUser?.email || '').trim().toLowerCase();
  if (!email) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  const amountRaw = Number(req.body?.amountUsd);
  if (!Number.isFinite(amountRaw)) {
    return res.status(400).json({ success: false, message: 'Please enter a valid amount.' });
  }
  const amountUsd = Math.floor(amountRaw);
  if (amountUsd < 10) {
    return res.status(400).json({ success: false, message: 'Minimum credit purchase is $10.' });
  }
  if (amountUsd > 5000) {
    return res.status(400).json({ success: false, message: 'Maximum single purchase is $5000.' });
  }

  const stripeSecretKey = getStripeSecretKey();
  if (!stripeSecretKey || !stripeSecretKey.startsWith('sk_')) {
    return res.status(500).json({ success: false, message: 'Stripe is not configured on the server.' });
  }

  const frontUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const successUrl = `${frontUrl}/#/connect/telegram?stage=success&credit=success`;
  const cancelUrl = `${frontUrl}/#/connect/telegram?stage=success&credit=cancel`;

  try {
    const params = new URLSearchParams();
    params.set('mode', 'payment');
    params.set('success_url', successUrl);
    params.set('cancel_url', cancelUrl);
    params.set('customer_email', email);
    params.set('payment_method_types[0]', 'card');
    params.set('client_reference_id', reqUser?.id || randomUUID());
    params.set('metadata[purchase_type]', 'credit_topup');
    params.set('metadata[user_email]', email);
    params.set('metadata[amount_usd]', String(amountUsd));
    params.set('line_items[0][price_data][currency]', 'usd');
    params.set('line_items[0][price_data][unit_amount]', String(amountUsd * 100));
    params.set('line_items[0][price_data][product_data][name]', `SwiftDeploy Credit Top-up ($${amountUsd})`);
    params.set('line_items[0][quantity]', '1');

    const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': randomUUID()
      },
      body: params.toString()
    });
    const stripeData: any = await stripeResponse.json().catch(() => ({}));
    if (!stripeResponse.ok || !stripeData?.url) {
      return res.status(502).json({ success: false, message: stripeData?.error?.message || 'Unable to create Stripe checkout session.' });
    }
    return res.json({ success: true, provider: 'stripe', checkoutUrl: stripeData.url, sessionId: stripeData.id });
  } catch {
    return res.status(500).json({ success: false, message: 'Failed to initialize secure checkout.' });
  }
});

// Test endpoint for Hugging Face
app.get('/api/test-hf', requireAdminAccess, async (req, res) => {
  try {
    const testResponse = await huggingFaceService.generateResponse("Hello, how are you?");
    res.json({ 
      success: true, 
      message: "Hugging Face API is working!",
      response: testResponse
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: "Hugging Face API test failed",
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Log required environment variables at startup
setTimeout(() => {
  const allowVerboseStartupLogs = process.env.NODE_ENV !== 'production'
    || (process.env.DEBUG_STARTUP_LOGS || '').trim().toLowerCase() === 'true';
  if (!allowVerboseStartupLogs) return;
  console.log('=== Environment Variables Loaded ===');
  console.log('CWD:', process.cwd());
  console.log('CWD .env exists:', fs.existsSync(path.resolve(process.cwd(), '.env')));
  console.log('PORT:', PORT);
  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log('BASE_URL:', BASE_URL);
  console.log('FRONTEND_URL:', process.env.FRONTEND_URL);
  console.log('BOT_STATE_FILE:', BOT_STATE_FILE);
  console.log('TELEGRAM_BOT_TOKEN exists:', !!process.env.TELEGRAM_BOT_TOKEN);
  console.log('GEMINI_API_KEY exists:', !!process.env.GEMINI_API_KEY);
  console.log('GOOGLE_CLIENT_ID exists:', !!process.env.GOOGLE_CLIENT_ID);
  console.log('GOOGLE_CLIENT_SECRET exists:', !!process.env.GOOGLE_CLIENT_SECRET);
  console.log('SMTP_USER exists:', !!process.env.SMTP_USER);
  console.log('SMTP_HOST:', process.env.SMTP_HOST);
  console.log('EMAIL_FROM:', process.env.EMAIL_FROM);
  console.log('===============================');
}, 100); // Small delay to ensure environment variables are loaded

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  if (process.env.NODE_ENV !== 'production') {
    process.exit(1);
  }
});

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
  loadChatMemory();
  loadUserProfiles();
  restorePersistedBots().catch((error) => {
    console.warn('[BOT_STATE] Restore routine failed:', (error as Error).message);
  });
  ensurePrimaryTelegramWebhook().catch((error) => {
    console.warn('[WEBHOOK] Primary webhook setup failed:', (error as Error).message);
  });
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  discordGatewayClients.forEach((client) => {
    try {
      client.destroy();
    } catch {}
  });
  discordGatewayClients.clear();
  server.close(() => {
    console.log('Process terminated');
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  discordGatewayClients.forEach((client) => {
    try {
      client.destroy();
    } catch {}
  });
  discordGatewayClients.clear();
  server.close(() => {
    console.log('Process terminated');
  });
});


