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
const telegramBotUsernames = new Map<string, string>();
const telegramBotNames = new Map<string, string>();
const telegramBotAiProviders = new Map<string, string>();
const telegramBotAiModels = new Map<string, string>();
type BotCreditState = {
  remainingUsd: number;
  lastChargedAt: number;
  depleted: boolean;
  updatedAt: number;
  policyVersion: number;
};
const botCredits = new Map<string, BotCreditState>();
// Credit policy (locked by product requirement):
// - Initial credit: $10
// - Deduction: $1 every 1.5 days (36 hours)
const INITIAL_BOT_CREDIT_USD = 10;
const CREDIT_DEDUCT_INTERVAL_MS = 36 * 60 * 60 * 1000;
const CREDIT_DEDUCT_AMOUNT_USD = 1;
const BOT_CREDIT_POLICY_VERSION = 2;
const CREDIT_ENFORCEMENT_ENABLED = (process.env.BOT_CREDIT_ENFORCEMENT_ENABLED || 'true').trim().toLowerCase() === 'true';
const CREDIT_ENFORCEMENT_PAUSED = (process.env.BOT_CREDIT_ENFORCEMENT_PAUSED || 'false').trim().toLowerCase() !== 'false';
const CREDIT_ENFORCEMENT_ACTIVE = CREDIT_ENFORCEMENT_ENABLED && !CREDIT_ENFORCEMENT_PAUSED;
const processedCreditSessions = new Set<string>();
type TelegramBotConfig = {
  botId: string;
  botToken: string;
  ownerEmail: string;
  botUsername?: string;
  botName?: string;
  aiProvider?: string;
  aiModel?: string;
  creditRemainingUsd?: number;
  creditLastChargedAt?: number;
  creditDepleted?: boolean;
  creditPolicyVersion?: number;
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
const RESPONSE_STYLE_VERSION = 'pro_layout_v3';
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
  assistantName?: string;
  emojiStyle?: 'rich' | 'minimal';
  stickersEnabled?: boolean;
  recurringTopics: string[];
  topicCounts: Record<string, number>;
  updatedAt: number;
};
const userProfiles = new Map<string, UserProfile>();
const DEFAULT_ASSISTANT_NAME = (process.env.BOT_ASSISTANT_NAME || 'SwiftDeploy AI').trim() || 'SwiftDeploy AI';
const TG_STICKER_GREETING_ID = (process.env.TG_STICKER_GREETING_ID || '').trim();
const TG_STICKER_SUCCESS_ID = (process.env.TG_STICKER_SUCCESS_ID || '').trim();
const TG_STICKER_CODING_ID = (process.env.TG_STICKER_CODING_ID || '').trim();
const TG_STICKER_MATH_ID = (process.env.TG_STICKER_MATH_ID || '').trim();
const TG_STICKER_MOTIVATION_ID = (process.env.TG_STICKER_MOTIVATION_ID || '').trim();
const parseStickerPool = (csvRaw: string, singleFallback: string): string[] => {
  const fromCsv = String(csvRaw || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const unique = Array.from(new Set([...fromCsv, String(singleFallback || '').trim()].filter(Boolean)));
  return unique;
};
const TG_STICKER_GREETING_IDS = parseStickerPool(process.env.TG_STICKER_GREETING_IDS || '', TG_STICKER_GREETING_ID);
const TG_STICKER_SUCCESS_IDS = parseStickerPool(process.env.TG_STICKER_SUCCESS_IDS || '', TG_STICKER_SUCCESS_ID);
const TG_STICKER_CODING_IDS = parseStickerPool(process.env.TG_STICKER_CODING_IDS || '', TG_STICKER_CODING_ID);
const TG_STICKER_MATH_IDS = parseStickerPool(process.env.TG_STICKER_MATH_IDS || '', TG_STICKER_MATH_ID);
const TG_STICKER_MOTIVATION_IDS = parseStickerPool(process.env.TG_STICKER_MOTIVATION_IDS || '', TG_STICKER_MOTIVATION_ID);
const FORCE_RICH_EMOJI_STYLE = (process.env.BOT_FORCE_RICH_EMOJI_STYLE || 'true').trim().toLowerCase() !== 'false';
const FORCE_STICKERS_ON = (process.env.BOT_FORCE_STICKERS_ON || 'true').trim().toLowerCase() !== 'false';
const USER_PROFILE_FILE = (process.env.USER_PROFILE_FILE || '').trim()
  || (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'swiftdeploy-user-profiles.json')
    : path.resolve(process.cwd(), 'runtime', 'swiftdeploy-user-profiles.json'));
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
const SUBSCRIPTION_STATE_FILE = (process.env.SUBSCRIPTION_STATE_FILE || '').trim()
  || (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'swiftdeploy-subscriptions.json')
    : path.resolve(process.cwd(), 'runtime', 'swiftdeploy-subscriptions.json'));
const TELEGRAM_SUBSCRIPTION_PRICE_USD_CENTS = Math.max(100, parseInt(process.env.TELEGRAM_SUBSCRIPTION_PRICE_USD_CENTS || '2900', 10));
const TELEGRAM_SUBSCRIPTION_INTERVAL = (process.env.TELEGRAM_SUBSCRIPTION_INTERVAL || 'month').trim().toLowerCase() === 'year' ? 'year' : 'month';
const TELEGRAM_SUBSCRIPTION_LABEL = (process.env.TELEGRAM_SUBSCRIPTION_LABEL || 'SwiftDeploy').trim() || 'SwiftDeploy';
const TELEGRAM_SUBSCRIPTION_DESCRIPTION = (process.env.TELEGRAM_SUBSCRIPTION_DESCRIPTION || 'SwiftDeploy Pro Plan').trim();
type PendingTelegramDeployIntent = {
  intentId: string;
  userEmail: string;
  botToken: string;
  selectedModel: string;
  createdAt: number;
};
const pendingTelegramDeployIntents = new Map<string, PendingTelegramDeployIntent>();
const processedTelegramSubscriptionSessions = new Map<string, { intentId: string; userEmail: string; deployed: boolean; processedAt: number; deployPayload?: any }>();
const PENDING_TELEGRAM_INTENT_TTL_MS = 2 * 60 * 60 * 1000;
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

const persistSubscriptionState = (): void => {
  try {
    const dir = path.dirname(SUBSCRIPTION_STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const serialized = JSON.stringify(
      Object.fromEntries(Array.from(userSubscriptionState.entries()).map(([email, state]) => [String(email), state])),
      null,
      2
    );
    fs.writeFileSync(SUBSCRIPTION_STATE_FILE, serialized, 'utf8');
  } catch (error) {
    console.warn('[SUBSCRIPTION] Failed to persist subscriptions:', (error as Error).message);
  }
};

const loadSubscriptionState = (): void => {
  try {
    if (!fs.existsSync(SUBSCRIPTION_STATE_FILE)) return;
    const raw = fs.readFileSync(SUBSCRIPTION_STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, SubscriptionState>;
    for (const [email, state] of Object.entries(parsed || {})) {
      const normalized = String(email || '').trim().toLowerCase();
      if (!normalized) continue;
      const plan = String(state?.plan || 'FREE').trim().toUpperCase() as PlanType;
      const safePlan: PlanType = plan === 'PRO_MONTHLY' || plan === 'PRO_YEARLY' || plan === 'CUSTOM' ? plan : 'FREE';
      userSubscriptionState.set(normalized, {
        plan: safePlan,
        isSubscribed: Boolean(state?.isSubscribed) || safePlan !== 'FREE',
        freeDeployCount: Math.max(0, Math.floor(Number(state?.freeDeployCount || 0))),
        freeTrialEndsAt: Math.max(0, Number(state?.freeTrialEndsAt || Date.now()))
      });
    }
  } catch (error) {
    console.warn('[SUBSCRIPTION] Failed to load subscriptions:', (error as Error).message);
  }
};

const setUserPlan = (email: string, plan: PlanType): SubscriptionState => {
  const state = ensureUserSubscriptionState(email);
  const next: SubscriptionState = {
    ...state,
    plan,
    isSubscribed: plan !== 'FREE'
  };
  userSubscriptionState.set(email.trim().toLowerCase(), next);
  persistSubscriptionState();
  return next;
};

const purgeExpiredTelegramDeployIntents = (): void => {
  const now = Date.now();
  for (const [intentId, intent] of pendingTelegramDeployIntents.entries()) {
    if (!intent?.createdAt || now - intent.createdAt > PENDING_TELEGRAM_INTENT_TTL_MS) {
      pendingTelegramDeployIntents.delete(intentId);
    }
  }
};

const userHasAnyDeployedTelegramBot = (email: string): boolean => {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  for (const owner of telegramBotOwners.values()) {
    if (String(owner || '').trim().toLowerCase() === normalized) return true;
  }
  const state = loadPersistedBotState();
  if (state.telegramBots.some((b) => String(b?.ownerEmail || '').trim().toLowerCase() === normalized)) return true;
  return false;
};

const requiresTelegramSubscription = (email: string): boolean => {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return true;
  // Existing Telegram bot owners (grandfathered) skip the subscription gate.
  if (userHasAnyDeployedTelegramBot(normalized)) return false;
  return !ensureUserSubscriptionState(normalized).isSubscribed;
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

const ensureBotCreditState = (botId: string): BotCreditState => {
  const existing = botCredits.get(botId);
  if (existing) {
    if (!existing.policyVersion || existing.policyVersion < BOT_CREDIT_POLICY_VERSION) {
      existing.remainingUsd = INITIAL_BOT_CREDIT_USD;
      existing.lastChargedAt = Date.now();
      existing.depleted = false;
      existing.updatedAt = Date.now();
      existing.policyVersion = BOT_CREDIT_POLICY_VERSION;
      botCredits.set(botId, existing);
      persistBotState();
    }
    return existing;
  }
  const fresh: BotCreditState = {
    remainingUsd: INITIAL_BOT_CREDIT_USD,
    lastChargedAt: Date.now(),
    depleted: false,
    updatedAt: Date.now(),
    policyVersion: BOT_CREDIT_POLICY_VERSION
  };
  botCredits.set(botId, fresh);
  return fresh;
};

const applyCreditDecay = (botId: string, now: number = Date.now()): BotCreditState => {
  const state = ensureBotCreditState(botId);
  if (!CREDIT_ENFORCEMENT_ACTIVE) {
    // Paused mode: no deduction and no depletion lock.
    state.depleted = false;
    state.updatedAt = now;
    state.policyVersion = BOT_CREDIT_POLICY_VERSION;
    botCredits.set(botId, state);
    return state;
  }
  if (state.depleted || state.remainingUsd <= 0) {
    state.remainingUsd = 0;
    state.depleted = true;
    state.updatedAt = now;
    state.policyVersion = BOT_CREDIT_POLICY_VERSION;
    botCredits.set(botId, state);
    return state;
  }
  const elapsed = Math.max(0, now - state.lastChargedAt);
  const steps = Math.floor(elapsed / CREDIT_DEDUCT_INTERVAL_MS);
  if (steps <= 0) return state;
  const deducted = steps * CREDIT_DEDUCT_AMOUNT_USD;
  state.remainingUsd = Math.max(0, state.remainingUsd - deducted);
  state.lastChargedAt += steps * CREDIT_DEDUCT_INTERVAL_MS;
  state.depleted = state.remainingUsd <= 0;
  state.updatedAt = now;
  state.policyVersion = BOT_CREDIT_POLICY_VERSION;
  botCredits.set(botId, state);
  return state;
};

const addCreditToBot = (botId: string, amountUsd: number, now: number = Date.now()): BotCreditState => {
  const state = applyCreditDecay(botId, now);
  state.remainingUsd = Math.max(0, state.remainingUsd + Math.max(0, Math.floor(amountUsd)));
  // Restart deduction window from recharge time.
  state.lastChargedAt = now;
  state.depleted = state.remainingUsd <= 0;
  state.updatedAt = now;
  state.policyVersion = BOT_CREDIT_POLICY_VERSION;
  botCredits.set(botId, state);
  return state;
};

const getBotIdByTelegramToken = (botToken: string): string | null => {
  for (const [id, token] of botTokens.entries()) {
    if (token === botToken) return id;
  }
  return null;
};

const persistBotState = (): void => {
  const telegramBots: TelegramBotConfig[] = Array.from(botTokens.entries()).map(([botId, botToken]) => {
    const credit = applyCreditDecay(botId);
    return {
      botId,
      botToken,
      ownerEmail: telegramBotOwners.get(botId) || '',
      botUsername: telegramBotUsernames.get(botId) || undefined,
      botName: telegramBotNames.get(botId) || undefined,
      aiProvider: telegramBotAiProviders.get(botId) || undefined,
      aiModel: telegramBotAiModels.get(botId) || undefined,
      creditRemainingUsd: credit.remainingUsd,
      creditLastChargedAt: credit.lastChargedAt,
      creditDepleted: credit.depleted,
      creditPolicyVersion: credit.policyVersion,
      createdAt: new Date().toISOString()
    };
  });
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
const rawTimeoutMs = parseInt(process.env.AI_RESPONSE_TIMEOUT_MS || (FAST_REPLY_MODE ? '15000' : '25000'), 10);
const AI_RESPONSE_TIMEOUT_MS = Math.max(5000, Math.min(rawTimeoutMs, 20000));
const AI_MAX_RETRY_PASSES = FAST_REPLY_MODE ? 0 : Math.max(0, parseInt(process.env.AI_MAX_RETRY_PASSES || '1', 10));
const AI_ENABLE_STRICT_RETRY = FAST_REPLY_MODE ? false : (process.env.AI_ENABLE_STRICT_RETRY || 'true').trim().toLowerCase() !== 'false';
const AI_ENABLE_SELF_VERIFY = FAST_REPLY_MODE ? false : (process.env.AI_ENABLE_SELF_VERIFY || 'true').trim().toLowerCase() !== 'false';
const TELEGRAM_STREAMING_ENABLED = false;
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
  const hasOpenRouterPool = Boolean((process.env.OPENROUTER_MODELS || '').trim());
  const model =
    provider === 'moonshot'
      ? (process.env.MOONSHOT_MODEL || 'moonshotai/kimi-k2.5').trim()
      : provider === 'openai'
        ? (process.env.OPENAI_MODEL || 'gpt-5.2').trim()
        : provider === 'anthropic'
          ? (process.env.ANTHROPIC_MODEL || 'claude-opus-4-5').trim()
          : provider === 'openrouter'
            ? (hasOpenRouterPool ? 'auto-router (intent-based)' : (process.env.OPENROUTER_MODEL || 'moonshotai/kimi-k2').trim())
            : provider === 'sarvam'
              ? (process.env.SARVAM_MODEL || 'sarvam-m').trim()
              : (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
  return { provider, model };
};

const TELEGRAM_DEFAULT_MODEL_SELECTION = (process.env.TELEGRAM_DEFAULT_MODEL_SELECTION || 'gpt-5-2').trim().toLowerCase();

const mapTelegramModelChoice = (choiceRaw: string): { provider: string; model: string } | null => {
  const choice = String(choiceRaw || '').trim().toLowerCase();
  if (choice === 'gpt-5-2' || choice === 'gpt-5.2') {
    return { provider: 'openai', model: 'gpt-5.2' };
  }
  if (choice === 'claude-opus-4-5' || choice === 'claude-4.5' || choice === 'claude_opus_4_5') {
    return { provider: 'anthropic', model: 'claude-opus-4-5' };
  }
  if (
    choice === 'gemini-3-flash' ||
    choice === 'gemini-3-flash-preview' ||
    choice === 'gemini-3-pro-preview' ||
    choice === 'gemini3flash'
  ) {
    return { provider: 'gemini', model: 'gemini-3-flash' };
  }
  return null;
};

const resolveTelegramAiConfig = (selectedModelRaw: string): { provider: string; model: string } => {
  const fromSelection = mapTelegramModelChoice(selectedModelRaw);
  if (fromSelection) return fromSelection;
  const fromDefault = mapTelegramModelChoice(TELEGRAM_DEFAULT_MODEL_SELECTION);
  if (fromDefault) return fromDefault;
  return { provider: 'openai', model: 'gpt-5.2' };
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
const fetchWikipediaFallbackAnswer = async (userText: string): Promise<string | null> => {
  const query = String(userText || '').trim();
  if (!query || query.length < 3) return null;
  try {
    const searchUrl =
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=1&format=json&srlimit=1`;
    const searchResp = await withTimeout(
      fetch(searchUrl, { headers: { 'User-Agent': 'SwiftDeployBot/1.0' } }),
      2800,
      'WIKI_SEARCH_TIMEOUT'
    );
    if (!searchResp.ok) return null;
    const searchData: any = await searchResp.json().catch(() => ({}));
    const first = Array.isArray(searchData?.query?.search) ? searchData.query.search[0] : null;
    const title = String(first?.title || '').trim();
    if (!title) return null;

    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const summaryResp = await withTimeout(
      fetch(summaryUrl, { headers: { 'User-Agent': 'SwiftDeployBot/1.0' } }),
      2800,
      'WIKI_SUMMARY_TIMEOUT'
    );
    if (!summaryResp.ok) return null;
    const summaryData: any = await summaryResp.json().catch(() => ({}));
    const extract = String(summaryData?.extract || '').replace(/\s+/g, ' ').trim();
    if (!extract) return null;
    return `${title}: ${extract}`;
  } catch {
    return null;
  }
};

async function getAIResponse(userText: string): Promise<string> {
  if (!process.env.HUGGINGFACE_API_KEY) {
    const webFallback = await fetchWikipediaFallbackAnswer(userText);
    if (webFallback) return webFallback;
    return generateEmergencyReply(userText);
  }
  // Always attempt fallback generation; the service already handles missing keys safely.
  const response = await huggingFaceService.generateResponse(
    userText,
    "You are the SimpleClaw AI assistant. You are a highly professional, accurate, and strategic AI agent. Your goal is to provide world-class technical and general assistance."
  );
  const safeResponse = String(response || '').trim();
  if (!safeResponse || isLowValueDeflectionReply(safeResponse)) {
    const webFallback = await fetchWikipediaFallbackAnswer(userText);
    if (webFallback) return webFallback;
  }
  if (!safeResponse) return generateEmergencyReply(userText);
  return safeResponse;
}

const generateEmergencyReply = (messageText: string): string => {
  const text = String(messageText || '').trim();
  const lower = text.toLowerCase();
  if (!text) return 'Please send your question and I will help immediately.';
  if (isGreetingPrompt(lower)) {
    return 'Hello. Ask your question and I will answer directly.';
  }
  if (/(how are you|how r u|how're you)/.test(lower)) {
    return 'I am ready to help. Tell me what you need.';
  }
  if (/(bye|good ?night|good ?bye)/.test(lower)) {
    return 'Goodbye. I will be here whenever you need help.';
  }
  if (/(ready to control my (life|mind)|control my (life|mind)|improve my life|discipline|focus|productivity)/.test(lower)) {
    return `Great mindset. Use this execution framework:

1. Set one clear target for the next 30 days.
2. Remove top distractions and lock focused work windows.
3. Execute daily with a fixed routine and review at night.
4. Track progress every day and correct the weakest habit first.`;
  }
  if (/(help|support|issue|error|problem|bug|not working)/.test(lower)) {
    return 'I can help. Share the exact error and I will give you a direct fix.';
  }
  if (/(code|coding|python|javascript|typescript|java|c\+\+|sql|algorithm|leetcode)/.test(lower)) {
    return 'Yes, I can help with coding. Send the exact problem statement and preferred language, and I will provide a correct solution with explanation.';
  }
  if (/(population of india|india population)/.test(lower)) {
    return 'India has an estimated population of about 1.43 billion people.';
  }
  if (/(population of china|china population)/.test(lower)) {
    return 'China has an estimated population of about 1.41 billion people.';
  }
  if (/(population of (usa|united states)|usa population|united states population)/.test(lower)) {
    return 'The United States has an estimated population of about 340 million people.';
  }
  if (/(population of world|world population|global population)/.test(lower)) {
    return 'The world population is estimated at about 8.1 billion people.';
  }
  if (/(who won the gold medal in tennis|gold medal in tennis)/.test(lower)) {
    return 'At the Paris 2024 Olympics tennis singles events, Novak Djokovic won men\'s gold and Zheng Qinwen won women\'s gold.';
  }
  if (/(who is sania mirza|sania mirza)/.test(lower)) {
    return 'Sania Mirza is an Indian former professional tennis player and Grand Slam champion, known as one of India\'s most successful women in tennis.';
  }
  if (/(snape|severus)/.test(lower)) {
    return 'Severus Snape is a key character in the Harry Potter series: a Hogwarts professor, former Death Eater, and ultimately a double agent who protected Harry.';
  }
  if (/(your real name|real name|official name)/.test(lower)) {
    return 'My official name is set by your Telegram bot profile.';
  }
  return 'Temporary AI service issue. Please retry in a few seconds.';
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
    if (tg.botUsername) telegramBotUsernames.set(botId, String(tg.botUsername).trim());
    if (tg.botName) telegramBotNames.set(botId, String(tg.botName).trim());
    if (tg.aiProvider) telegramBotAiProviders.set(botId, String(tg.aiProvider).trim().toLowerCase());
    if (tg.aiModel) telegramBotAiModels.set(botId, String(tg.aiModel).trim());
    botCredits.set(botId, {
      remainingUsd: Math.max(0, Number(tg.creditRemainingUsd ?? INITIAL_BOT_CREDIT_USD)),
      lastChargedAt: Math.max(0, Number(tg.creditLastChargedAt ?? Date.now())),
      depleted: Boolean(tg.creditDepleted) || Number(tg.creditRemainingUsd ?? INITIAL_BOT_CREDIT_USD) <= 0,
      updatedAt: Date.now(),
      policyVersion: Math.max(1, Number(tg.creditPolicyVersion || 1))
    });
    applyCreditDecay(botId);
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
    .replace(/â€™/g, "'")
    .replace(/â€“/g, '-')
    .replace(/â€”/g, '-')
    .trim();
};

const toSentenceChunks = (text: string): string[] => {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
};

const pickFromPool = (pool: string[]): string => {
  if (!Array.isArray(pool) || pool.length === 0) return '';
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx] || '';
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

const instantProfessionalReply = (text: string): string | null => {
  const q = String(text || '').trim().toLowerCase();
  if (!q) return null;
  if (isGreetingPrompt(q)) {
    return 'Hello. Ask your question and I will give a direct professional answer.';
  }
  if (/(can you do coding|do you know coding|can you code|are you good at coding)/.test(q)) {
    return 'Yes. I can write, debug, optimize, and explain code in Python, JavaScript/TypeScript, Java, C++, SQL, and more. Share the exact problem and preferred language.';
  }
  if (/who are you|what are you/.test(q)) {
    return 'I am your AI assistant for this bot. I can help with coding, strategy, learning, troubleshooting, and practical planning.';
  }
  if (/what can you do|your capabilities|how can you help/.test(q)) {
    return 'I can solve technical problems, explain concepts clearly, draft professional content, and provide actionable step-by-step plans.';
  }
  if (/what is ai\b|define ai\b/.test(q)) {
    return 'AI is software that performs tasks requiring human-like intelligence, such as understanding language, reasoning, prediction, and decision support.';
  }
  if (/(value of pi|what is pi\b|pi value)/.test(q)) {
    return 'Pi is approximately 3.141592653589793 (commonly 3.14).';
  }
  if (/(longest prime|largest prime|biggest prime)/.test(q)) {
    return 'There is no longest prime number. Primes are infinite.';
  }
  if (/(ready to control my (life|mind)|control my (life|mind)|fix my life|change my life|build discipline|improve my focus)/.test(q)) {
    return `Yes. I can help you build strong control with a practical system.

1. Define one 30-day target and one measurable daily action.
2. Block top distractions and run two deep-work sessions (50/10).
3. Follow a fixed routine: sleep, wake, work, and review at the same times.
4. Track daily execution score and adjust weak points every night.

Share your current routine, and I will give you a personalized plan.`;
  }
  if (/motivate me|motivation|i am lazy|procrastinating/.test(q)) {
    return 'Do not wait for motivation. Use action first: pick one 20-minute task, start a timer, finish it, then continue one more cycle.';
  }
  if (/rat in a maze|maze problem/.test(q)) {
    return `Yes. Here is a clean Python solution for "Rat in a Maze" using DFS and backtracking:

\`\`\`python
def rat_in_maze_paths(maze):
    n = len(maze)
    if n == 0 or maze[0][0] == 0 or maze[n - 1][n - 1] == 0:
        return []

    directions = [('D', 1, 0), ('L', 0, -1), ('R', 0, 1), ('U', -1, 0)]
    visited = [[False] * n for _ in range(n)]
    result = []

    def dfs(r, c, path):
        if r == n - 1 and c == n - 1:
            result.append(path)
            return
        visited[r][c] = True
        for ch, dr, dc in directions:
            nr, nc = r + dr, c + dc
            if 0 <= nr < n and 0 <= nc < n and not visited[nr][nc] and maze[nr][nc] == 1:
                dfs(nr, nc, path + ch)
        visited[r][c] = False

    dfs(0, 0, "")
    return sorted(result)
\`\`\`

If you want, I can also give C++ or Java version.`;
  }
  if (/what should i do now|next step/.test(q)) {
    return 'Immediate next step: define one priority, break it into 3 tasks, complete task 1 in the next 30 minutes.';
  }
  return null;
};

const normalizeParagraphFlow = (text: string): string => {
  const value = String(text || '').replace(/\r/g, '').trim();
  if (!value) return value;
  const segments = value.split(/(```[\s\S]*?```)/g).filter(Boolean);

  const normalizedSegments = segments.map((segment) => {
    if (segment.startsWith('```')) return segment.trim();
    const lines = segment
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) return '';

    const isListLine = (line: string) => /^(-|\*|\u2022|\d+[.)])\s+/.test(line);
    const isSectionLabel = (line: string) => /^[A-Z][A-Za-z0-9 /()-]{2,40}:$/.test(line);
    const hasStructuredLines = lines.some((line) => isListLine(line) || isSectionLabel(line));

    if (!hasStructuredLines) {
      return lines.join(' ').replace(/\s{2,}/g, ' ').trim();
    }

    const rebuilt: string[] = [];
    for (const line of lines) {
      if (isListLine(line) || isSectionLabel(line)) {
        rebuilt.push(line);
      } else if (rebuilt.length > 0) {
        rebuilt[rebuilt.length - 1] = `${rebuilt[rebuilt.length - 1]} ${line}`.replace(/\s{2,}/g, ' ').trim();
      } else {
        rebuilt.push(line);
      }
    }
    return rebuilt.join('\n');
  });

  return normalizedSegments
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const expandInlinePointMarkers = (text: string): string => {
  const value = String(text || '').replace(/\r/g, '').trim();
  if (!value) return value;
  const segments = value.split(/(```[\s\S]*?```)/g).filter(Boolean);

  const expandInSegment = (segment: string): string => {
    let out = segment;

    out = out.replace(/\s*[\u2022\u25CF\u25AA\u25E6\u25A0\u25B9\u25B8\u25BA]\s+/g, '\n- ');

    const splitMarkers = (input: string, markerRegex: RegExp): string => {
      const matches = input.match(markerRegex) || [];
      if (matches.length < 2) return input;
      return input.replace(markerRegex, (match, _g1, offset: number, source: string) => {
        if (offset <= 0) return match;
        const prevChar = source[offset - 1];
        if (prevChar === '\n') return match;
        if (prevChar === ':' || prevChar === ';' || /\s/.test(prevChar)) {
          return `\n${match}`;
        }
        return match;
      });
    };

    out = splitMarkers(out, /(\d+\))\s+/g);
    out = splitMarkers(out, /(\d+\.)\s+/g);

    // Handle one-line dash-separated point lists:
    // "A - B - C" => "A\n- B\n- C" (only when pattern looks like headings/items, not numeric ranges)
    const inlineDashMatches = out.match(/\s[-\u2013]\s(?=[A-Z(])/g) || [];
    if (!out.includes('\n') && inlineDashMatches.length >= 2) {
      const parts = out
        .split(/\s[-\u2013]\s(?=[A-Z(])/g)
        .map((x) => x.trim())
        .filter(Boolean);
      if (parts.length >= 3) {
        const lead = parts[0];
        const bullets = parts.slice(1).map((item) => `- ${item}`);
        out = `${lead}\n${bullets.join('\n')}`;
      }
    }

    return out
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  };

  return segments
    .map((segment) => (segment.startsWith('```') ? segment.trim() : expandInSegment(segment)))
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const isComparisonPrompt = (prompt: string): boolean => {
  const q = String(prompt || '').toLowerCase();
  return /(compare|comparison|difference|vs\b|versus|better than|pros and cons|pros & cons|advantages and disadvantages)/.test(q);
};

const isPointWisePrompt = (prompt: string): boolean => {
  const q = String(prompt || '').toLowerCase();
  return /(points|list|step by step|steps|plan|roadmap|compare|difference|pros|cons|how to|strategy|framework|action plan|discipline|productivity|routine|control my life|control my mind|improve my life|improve my focus)/.test(q);
};

const enforceStructuredPoints = (prompt: string, text: string): string => {
  const value = String(text || '').trim();
  if (!value || value.includes('```')) return value;
  if (!isPointWisePrompt(prompt)) return value;
  if (/\n\s*(-|\*|\u2022|\d+[.)])\s+/.test(value)) return value;

  const dashParts = value
    .split(/\s[-\u2013]\s(?=[A-Z(])/g)
    .map((x) => x.trim())
    .filter(Boolean);
  if (dashParts.length >= 3) {
    const lead = dashParts[0];
    const maxItems = isComparisonPrompt(prompt) ? 6 : 8;
    const items = dashParts
      .slice(1, 1 + maxItems)
      .map((item, i) => `${i + 1}. ${item.replace(/^[-*\u2022]\s+/, '').trim()}`);
    const label = isComparisonPrompt(prompt) ? 'Comparison Points' : 'Key Points';
    return `${lead}\n\n${label}:\n${items.join('\n\n')}`.trim();
  }

  const sentences = toSentenceChunks(value);
  if (sentences.length < 2) return value;
  const lead = sentences[0];
  const maxItems = isComparisonPrompt(prompt) ? 5 : 4;
  const items = sentences.slice(1, 1 + maxItems).map((s, i) => `${i + 1}. ${s}`);
  const label = isComparisonPrompt(prompt) ? 'Comparison Points' : 'Key Points';
  return `${lead}\n\n${label}:\n${items.join('\n\n')}`.trim();
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
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  // Drop quoted prompt echoes if model repeats user text as a heading.
  const normalizedPrompt = sanitizeForTelegram(prompt).toLowerCase();
  if (normalizedPrompt) {
    const lines = cleaned.split('\n').map((line) => line.trim());
    const firstLine = (lines[0] || '').toLowerCase();
    if (firstLine === normalizedPrompt || (normalizedPrompt.length > 24 && firstLine.startsWith(normalizedPrompt.slice(0, 24)))) {
      cleaned = lines.slice(1).join('\n').trim();
    }
  }

  cleaned = expandInlinePointMarkers(cleaned);
  cleaned = normalizeParagraphFlow(cleaned);

  if (isGreetingPrompt(prompt)) {
    return 'Hello! How can I help you today?';
  }

  // Remove forced boilerplate sections and keep direct answer only.
  cleaned = cleaned
    .replace(/\n{2,}(next step|summary|key points):[\s\S]*$/i, '')
    .trim();

  // Remove stale temporal qualifiers like "as of May 2024" from final text.
  cleaned = cleaned
    .replace(/\s*\((?:as of|updated as of|data as of)\s+[a-z]+\s+\d{4}\)\s*/gi, ' ')
    .replace(/\s*\((?:as of|updated as of|data as of)\s+\d{4}\)\s*/gi, ' ')
    .replace(/\b(?:as of|updated as of|data as of)\s+[a-z]+\s+\d{4}\b[:,]?\s*/gi, '')
    .replace(/\b(?:as of|updated as of|data as of)\s+\d{4}\b[:,]?\s*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Remove 2024 references from final output as requested.
  cleaned = cleaned
    .replace(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+2024\b/gi, '')
    .replace(/\b2024\b/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const shouldAutoPointify =
    !cleaned.includes('```')
    && !/\n\s*(-|\*|\u2022|\d+[.)])\s+/.test(cleaned)
    && (
      (
        /(how|why|strategy|framework|roadmap|routine|discipline|focus|productivity|mindset|control my life|control my mind|improve)/.test(String(prompt || '').toLowerCase())
        && toSentenceChunks(cleaned).length >= 3
      )
      || (cleaned.length >= 320 && toSentenceChunks(cleaned).length >= 5)
    );
  if (shouldAutoPointify) {
    cleaned = enforceStructuredPoints(`${prompt} points`, cleaned);
  }

  const hasStructuredPointLines = /\n\s*(-|\*|\u2022|\d+[.)])\s+/.test(cleaned);

  // Never truncate short prompts to one sentence when structured points are present.
  if (isSimplePrompt(prompt) && !hasStructuredPointLines && !isPointWisePrompt(prompt)) {
    const simpleSentences = toSentenceChunks(cleaned);
    if (simpleSentences.length > 0 && simpleSentences.length <= 3) {
      return simpleSentences.join(' ');
    }
  }

  // If a long answer comes as one block, split by paragraph-sized chunks.
  if (!cleaned.includes('\n') && cleaned.length > 420) {
    const chunks = toSentenceChunks(cleaned);
    cleaned = chunks.length > 4 ? chunks.join(' ') : cleaned;
  }

  cleaned = enforceStructuredPoints(prompt, cleaned);
  return applyProfessionalLayout(cleaned);
};

const applyProfessionalLayout = (text: string): string => {
  const value = String(text || '').replace(/\r/g, '').trim();
  if (!value) return value;
  const parts = value.split(/(```[\s\S]*?```)/g).filter(Boolean);
  const normalized = parts.map((part) => {
    if (part.startsWith('```')) {
      return part.trim();
    }
    return part
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  });
  return normalized
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const getEmojiStyleForConversation = (conversationKey?: string): 'rich' | 'minimal' => {
  if (FORCE_RICH_EMOJI_STYLE) return 'rich';
  if (!conversationKey) return 'rich';
  return userProfiles.get(conversationKey)?.emojiStyle === 'minimal' ? 'minimal' : 'rich';
};

const ensureEmojiInReply = (text: string, prompt: string, conversationKey?: string): string => {
  const value = String(text || '').trim();
  if (!value) return 'Got it.';
  if (getEmojiStyleForConversation(conversationKey) !== 'rich') {
    return value;
  }
  const p = `${String(prompt || '').toLowerCase()} ${value.toLowerCase()}`;
  const emoji =
    /(code|coding|python|javascript|typescript|java|c\+\+|sql|bug|algorithm)/.test(p) ? '\u{1F4BB}'
    : /(math|calculate|equation|solve)/.test(p) ? '\u{1F9EE}'
      : /(finance|stock|market|price|revenue|gdp|trade|economy)/.test(p) ? '\u{1F4C8}'
        : /(latest|today|current|news|update|breaking)/.test(p) ? '\u{1F4F0}'
          : /(health|medical|fitness|diet|sleep)/.test(p) ? '\u{2695}\uFE0F'
            : /(study|learn|education|exam|school|college)/.test(p) ? '\u{1F393}'
              : /(travel|trip|flight|hotel|city|country)/.test(p) ? '\u{1F5FA}\uFE0F'
        : /(plan|goal|productivity|life|discipline|focus)/.test(p) ? '\u{1F3AF}'
          : isGreetingPrompt(p) ? '\u{1F44B}'
            : '\u2705';
  return decorateAnswerWithVisuals(value, emoji);
};

const decorateAnswerWithVisuals = (text: string, primaryEmoji: string): string => {
  const value = String(text || '').trim();
  if (!value) return value;
  if (value.includes('```')) {
    // Keep code answers clean: light visual markers only.
    const suffix = /[\u{1F300}-\u{1FAFF}\u2705\u2714\u2713]\s*$/u.test(value) ? value : `${value}\n\n${primaryEmoji}`;
    return /^\s*[\u{1F300}-\u{1FAFF}\u2705\u2714\u2713]/u.test(suffix) ? suffix : `${primaryEmoji} ${suffix}`;
  }

  const lines = value.split('\n').map((line) => line.trim()).filter(Boolean);
  const midEmoji = '\u{1F539}';
  const endEmoji = '\u{1F3C1}';

  if (lines.length >= 3) {
    const midIndex = Math.min(1, lines.length - 1);
    if (!/[\u{1F300}-\u{1FAFF}\u2705\u2714\u2713]/u.test(lines[midIndex])) {
      lines[midIndex] = `${midEmoji} ${lines[midIndex]}`;
    }
    let output = lines.join('\n\n');
    if (!/^\s*[\u{1F300}-\u{1FAFF}\u2705\u2714\u2713]/u.test(output)) {
      output = `${primaryEmoji} ${output}`;
    }
    if (!/[\u{1F300}-\u{1FAFF}\u2705\u2714\u2713]\s*$/u.test(output)) {
      output = `${output}\n\n${endEmoji}`;
    }
    return output;
  }

  let output = value;
  if (!/^\s*[\u{1F300}-\u{1FAFF}\u2705\u2714\u2713]/u.test(output)) {
    output = `${primaryEmoji} ${output}`;
  }
  if (!/[\u{1F300}-\u{1FAFF}\u2705\u2714\u2713]\s*$/u.test(output)) {
    output = `${output}\n\n${endEmoji}`;
  }
  return output;
};

const stripReconnectLoopReply = (text: string): string => {
  const value = String(text || '').trim();
  if (!value) return value;
  if (
    /reconnect(ing)?\s+ai\s+providers/i.test(value)
    || /please\s+retry\s+in\s+\d+\s*-\s*\d+\s*seconds/i.test(value)
    || /please\s+retry\s+in\s+\d+\s*seconds/i.test(value)
  ) {
    return 'Temporary AI provider issue. Please resend your question in 5 seconds.';
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

const isAcceptableShortAnswer = (answer: string, prompt: string): boolean => {
  const out = String(answer || '').trim();
  if (!out) return false;
  const plain = out.replace(/^[\u{1F300}-\u{1FAFF}\u2705\u2714\u2713]\s*/u, '').trim();
  if (!plain) return false;
  if (/^[\d.,+\-*/()%=\s]+$/.test(plain) && /\d/.test(plain)) return true;
  if (/^(yes|no|true|false)\b/i.test(plain)) return true;
  if (plain.length >= 8) return true;
  return /(pi|euler|prime|capital|value|definition|meaning|date|year|population)/i.test(prompt);
};

const isLowValueDeflectionReply = (text: string): boolean => {
  const v = String(text || '').toLowerCase().trim();
  if (!v) return true;
  return /(i can help with this\.?\s*share one clear question|share one clear question or goal|direct professional answer|i am ready to help.*ask your question|ready to help.*(ask|share).*(question|goal)|temporary ai service issue|please retry in a few seconds|could not generate a reliable answer)/s.test(v);
};

const finalizeProfessionalReply = (prompt: string, reply: string, conversationKey?: string): string => {
  const polished = formatProfessionalResponse(reply, prompt);
  let clean = ensureEmojiInReply(polished, prompt, conversationKey);
  clean = enforceProfessionalReplyQuality(prompt, clean, conversationKey);
  clean = applyAssistantIdentityPolicy(clean, conversationKey);
  clean = applyEmojiStylePolicy(clean, conversationKey);
  return clean.trim();
};

const enforceProfessionalReplyQuality = (prompt: string, reply: string, conversationKey?: string): string => {
  const candidate = String(reply || '').trim();
  if (!candidate) return generateEmergencyReply(prompt);
  if (!isLowValueDeflectionReply(candidate)) return candidate;

  const q = String(prompt || '').toLowerCase().replace(/\s+/g, ' ');
  if (/(what('?s| is)\s+your\s+name|your name\??|what (should|can|do) i call you|what i called you|what did i call you)/.test(q)) {
    const official = getOfficialAssistantName(conversationKey);
    const alias = sanitizeAssistantName(userProfiles.get(conversationKey || '')?.assistantName || '');
    if (alias) {
      return `My official name is ${official}. In this chat, you can call me ${alias}.`;
    }
    return `My official name is ${official}.`;
  }
  if (/(can i call you|i will call you|from now i call you|your name is|you are)/.test(q)) {
    const renameTo = extractAssistantRenameCommand(prompt);
    if (renameTo) {
      const applied = setAssistantNamePreference(conversationKey, renameTo);
      return `Done. In this chat, you can call me ${applied}.`;
    }
    return 'Please provide the exact name you want me to use in this chat.';
  }
  const instant = instantProfessionalReply(prompt);
  if (instant && !isLowValueDeflectionReply(instant)) return instant;
  return generateEmergencyReply(prompt);
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
    const chunk = chunks[i];
    const baseOptions: Record<string, unknown> = {};
    if (i === 0 && replyTo) {
      baseOptions.reply_to_message_id = replyTo;
    }
    const fenceCount = (chunk.match(/```/g) || []).length;
    const canRenderMarkdown = chunk.includes('```') && fenceCount % 2 === 0;
    if (canRenderMarkdown) {
      try {
        await targetBot.sendMessage(chatId, chunk, { ...baseOptions, parse_mode: 'Markdown' });
        continue;
      } catch {
        // Fall back to plain text if Telegram markdown parsing fails.
      }
    }
    await targetBot.sendMessage(chatId, chunk, baseOptions);
  }
};

const sendTelegramStreamingReply = async (
  targetBot: TelegramBot,
  chatId: number,
  responsePromise: Promise<string>,
  replyTo?: number
): Promise<string> => {
  const resolved = await responsePromise;
  await sendTelegramReply(targetBot, chatId, resolved, replyTo);
  return resolved;
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
    return 'Commands:\n/start - welcome message\n/help - show commands\n/reset - clear chat memory\n/stickers on|off|status - sticker replies\n/emoji rich|minimal|status - emoji style\n\nAsk any question directly after these commands.';
  }
  if (cmd === 'reset') {
    if (conversationKey) {
      clearConversationState(conversationKey);
    }
    return 'Your chat memory for this bot has been cleared. Start a new question.';
  }
  if (cmd === 'stickers') {
    const mode = (text.split(/\s+/)[1] || '').trim().toLowerCase();
    if (!conversationKey) return 'Sticker settings are unavailable in this context.';
    if (FORCE_STICKERS_ON) {
      return 'Stickers are ON for this bot.';
    }
    if (!mode || mode === 'status') {
      const enabled = userProfiles.get(conversationKey)?.stickersEnabled !== false;
      return enabled ? 'Stickers are ON.' : 'Stickers are OFF.';
    }
    if (!['on', 'off'].includes(mode)) {
      return 'Use: /stickers on, /stickers off, or /stickers status';
    }
    const current = userProfiles.get(conversationKey) || {
      recurringTopics: [],
      topicCounts: {},
      updatedAt: Date.now()
    };
    current.stickersEnabled = mode === 'on';
    current.updatedAt = Date.now();
    userProfiles.set(conversationKey, current);
    persistUserProfiles();
    return current.stickersEnabled ? 'Stickers enabled for this chat.' : 'Stickers disabled for this chat.';
  }
  if (cmd === 'emoji') {
    const mode = (text.split(/\s+/)[1] || '').trim().toLowerCase();
    if (!conversationKey) return 'Emoji settings are unavailable in this context.';
    if (FORCE_RICH_EMOJI_STYLE) {
      return 'Emoji style is RICH for this bot.';
    }
    if (!mode || mode === 'status') {
      const style = userProfiles.get(conversationKey)?.emojiStyle || 'rich';
      return `Emoji style is ${style.toUpperCase()}.`;
    }
    if (!['rich', 'minimal'].includes(mode)) {
      return 'Use: /emoji rich, /emoji minimal, or /emoji status';
    }
    const current = userProfiles.get(conversationKey) || {
      recurringTopics: [],
      topicCounts: {},
      updatedAt: Date.now()
    };
    current.emojiStyle = mode as 'rich' | 'minimal';
    current.updatedAt = Date.now();
    userProfiles.set(conversationKey, current);
    persistUserProfiles();
    return `Emoji style set to ${mode.toUpperCase()} for this chat.`;
  }
  return null;
};

const sanitizeAssistantName = (input: string): string => {
  return String(input || '')
    .replace(/[`"'<>[\]{}()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32);
};

const getOfficialAssistantName = (conversationKey?: string): string => {
  if (!conversationKey) return DEFAULT_ASSISTANT_NAME;
  const tgMatch = conversationKey.match(/^telegram:([^:]+):/i);
  const telegramBotId = String(tgMatch?.[1] || '').trim();
  if (telegramBotId) {
    const botName = sanitizeAssistantName(telegramBotNames.get(telegramBotId) || '');
    if (botName) return botName;
    const botUsername = sanitizeAssistantName(telegramBotUsernames.get(telegramBotId) || '');
    if (botUsername) return botUsername;
  }
  return DEFAULT_ASSISTANT_NAME;
};

const getAssistantName = (conversationKey?: string): string => {
  if (!conversationKey) return DEFAULT_ASSISTANT_NAME;
  const profile = userProfiles.get(conversationKey);
  const preferred = sanitizeAssistantName(profile?.assistantName || '');
  if (preferred) return preferred;
  const tgMatch = conversationKey.match(/^telegram:([^:]+):/i);
  const telegramBotId = String(tgMatch?.[1] || '').trim();
  if (telegramBotId) {
    // Default to registered Telegram bot identity when no per-chat rename exists.
    return getOfficialAssistantName(conversationKey);
  }
  return DEFAULT_ASSISTANT_NAME;
};

const setAssistantNamePreference = (conversationKey: string | undefined, name: string): string => {
  const nextName = sanitizeAssistantName(name);
  if (!conversationKey || !nextName) return DEFAULT_ASSISTANT_NAME;
  const current = userProfiles.get(conversationKey) || {
    recurringTopics: [],
    topicCounts: {},
    updatedAt: Date.now()
  };
  current.assistantName = nextName;
  current.updatedAt = Date.now();
  userProfiles.set(conversationKey, current);
  persistUserProfiles();
  return nextName;
};

const isRenameIntentPrompt = (text: string): boolean => {
  const normalized = String(text || '').trim().toLowerCase();
  if (!normalized) return false;
  return /(your name is|you are|call yourself|i will call you|can i call you|can i call u|i call you|i called you|from now i call you)/.test(normalized);
};

const isInvalidAssistantNameCandidate = (candidate: string): boolean => {
  const value = sanitizeAssistantName(candidate).toLowerCase();
  if (!value || value.length < 2) return true;
  const words = value.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 4) return true;

  const genericOnly = new Set(['with', 'the', 'name', 'that', 'i', 'can', 'provide', 'call', 'you', 'a', 'an', 'any', 'some', 'my']);
  if (words.every((w) => genericOnly.has(w))) return true;
  if (/(with the name|name that i can provide|that i can provide|which i can provide|any name|some name|name i can provide)/.test(value)) {
    return true;
  }
  return false;
};

const extractAssistantRenameCommand = (text: string): string | null => {
  const normalized = String(text || '').trim();
  if (!normalized) return null;
  const match = normalized.match(
    /(?:from now (?:on|onwards)\s*,?\s*)?(?:your name is|you are|call yourself|i will call you|can i call you|can i call u|i call you|i called you|from now i call you)\s+([a-zA-Z][a-zA-Z0-9 _-]{1,31})/i
  );
  if (!match?.[1]) return null;
  const raw = match[1].replace(/\b(ok|okay|please|now)\b.*$/i, '').trim();
  const cleaned = sanitizeAssistantName(raw);
  if (isInvalidAssistantNameCandidate(cleaned)) return null;
  return cleaned || null;
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
        assistantName: sanitizeAssistantName(profile?.assistantName || '') || undefined,
        emojiStyle: FORCE_RICH_EMOJI_STYLE ? 'rich' : (profile?.emojiStyle === 'minimal' ? 'minimal' : 'rich'),
        stickersEnabled: FORCE_STICKERS_ON ? true : (profile?.stickersEnabled !== false),
        recurringTopics: Array.isArray(profile?.recurringTopics) ? profile.recurringTopics.slice(0, 5) : [],
        topicCounts: typeof profile?.topicCounts === 'object' && profile.topicCounts ? profile.topicCounts : {},
        updatedAt: Number(profile?.updatedAt || Date.now())
      });
    }
  } catch (error) {
    console.warn('[USER_PROFILE] Failed to load profiles:', (error as Error).message);
  }
};

const ensurePremiumConversationStyle = (conversationKey: string | undefined): void => {
  if (!conversationKey) return;
  const current = userProfiles.get(conversationKey) || {
    preferredTone: 'professional' as const,
    emojiStyle: 'rich' as const,
    stickersEnabled: true,
    recurringTopics: [],
    topicCounts: {},
    updatedAt: Date.now()
  };
  let changed = false;
  if (!current.preferredTone) {
    current.preferredTone = 'professional';
    changed = true;
  }
  if (FORCE_RICH_EMOJI_STYLE && current.emojiStyle !== 'rich') {
    current.emojiStyle = 'rich';
    changed = true;
  }
  if (FORCE_STICKERS_ON && current.stickersEnabled !== true) {
    current.stickersEnabled = true;
    changed = true;
  }
  if (changed || !userProfiles.has(conversationKey)) {
    current.updatedAt = Date.now();
    userProfiles.set(conversationKey, current);
    persistUserProfiles();
  }
};

const updateUserProfile = (conversationKey: string | undefined, userText: string): UserProfile | undefined => {
  if (!conversationKey) return undefined;
  const current = userProfiles.get(conversationKey) || {
    preferredTone: 'professional' as const,
    emojiStyle: (FORCE_RICH_EMOJI_STYLE ? 'rich' : 'minimal') as 'rich' | 'minimal',
    stickersEnabled: FORCE_STICKERS_ON,
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
  const assistantDisplayName = sanitizeAssistantName(userProfile?.assistantName || '') || DEFAULT_ASSISTANT_NAME;
  const timezone = (process.env.BOT_USER_TIMEZONE || '').trim();
  const role = (process.env.BOT_USER_ROLE || '').trim();
  const priorities = (process.env.BOT_USER_PRIORITIES || '').trim();

  const envProfile = [
    timezone ? `Timezone: ${timezone}` : '',
    role ? `User role: ${role}` : '',
    priorities ? `Top priorities: ${priorities}` : ''
  ].filter(Boolean).join('\n');

  const profileHints = [
    userProfile?.assistantName ? `Assistant display name for this chat: ${sanitizeAssistantName(userProfile.assistantName)}` : '',
    userProfile?.preferredTone ? `Preferred tone: ${userProfile.preferredTone}` : '',
    userProfile?.prefersConcise ? 'User prefers concise answers.' : '',
    userProfile?.recurringTopics?.length ? `Recurring topics: ${userProfile.recurringTopics.join(', ')}` : ''
  ].filter(Boolean).join('\n');

  const modeBlock = intent === 'coding'
    ? `Mode: Coding\n- Act like a senior engineer.\n- Prioritize correct, runnable solutions.\n- Keep explanations tight and practical.`
    : intent === 'math'
      ? `Mode: Math\n- Solve clearly and verify final result.`
      : intent === 'current_event'
        ? `Mode: Current Event\n- Prefer verified live context.\n- Give direct, current answer without stale date boilerplate.\n- If uncertain, say what is uncertain.`
        : `Mode: General\n- Be clear, useful, and concise.`;

  const base = `
You are ${assistantDisplayName}, a high-quality professional assistant.

Rules:
- Prioritize correctness over guessing.
- Use a professional, calm tone and clean formatting.
- Give the direct answer first, then concise explanation.
- Adapt answer length to question complexity: short for simple facts, deeper for analytical prompts.
- Use short sections or bullets only when they improve clarity.
- For compare/difference questions, provide point-wise comparison.
- For coding, provide runnable code and mention key assumptions.
- Never hallucinate facts, links, or references.
- If a question is ambiguous, ask one precise clarifying question.
- For time-sensitive questions, prefer verified current facts and state uncertainty briefly when needed.
- Use relevant professional emoji sparingly to improve readability.
${modeBlock}
${envProfile ? `\nUser profile:\n${envProfile}` : ''}
${profileHints ? `\nPersonalization hints:\n${profileHints}` : ''}
`.trim();
  const custom = (process.env.BOT_SYSTEM_PROMPT || '').trim();
  return custom ? `${base}\n\nAdditional instructions:\n${custom}` : base;
};

const applyAssistantIdentityPolicy = (text: string, conversationKey?: string): string => {
  const out = String(text || '').trim();
  if (!out || !conversationKey) return out;
  const preferredName = getAssistantName(conversationKey);
  if (!preferredName || preferredName.toLowerCase() === DEFAULT_ASSISTANT_NAME.toLowerCase()) return out;
  return out
    .replace(/\bSwiftDeploy AI assistant\b/gi, `${preferredName} assistant`)
    .replace(/\bSwiftDeploy AI\b/gi, preferredName);
};

const applyEmojiStylePolicy = (text: string, conversationKey?: string): string => {
  const out = String(text || '').trim();
  if (!out || !conversationKey) return out;
  if (FORCE_RICH_EMOJI_STYLE) return out;
  const style = userProfiles.get(conversationKey)?.emojiStyle || 'rich';
  if (style !== 'minimal') return out;
  return out
    .replace(/^[\u{1F300}-\u{1FAFF}\u2705\u2714\u2713\u{1F539}\u{1F3C1}]\s*/gu, '')
    .replace(/\n{2}[\u{1F300}-\u{1FAFF}\u2705\u2714\u2713\u{1F539}\u{1F3C1}]\s*$/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

const pickStickerForContext = (prompt: string, answer: string): string => {
  const p = `${String(prompt || '').toLowerCase()} ${String(answer || '').toLowerCase()}`;
  if (isGreetingPrompt(p)) return pickFromPool(TG_STICKER_GREETING_IDS);
  if (/(code|coding|python|javascript|typescript|java|c\+\+|sql|bug|algorithm)/.test(p)) return pickFromPool(TG_STICKER_CODING_IDS);
  if (/(math|calculate|equation|solve|number|prime|pi)/.test(p)) return pickFromPool(TG_STICKER_MATH_IDS);
  if (/(motivate|discipline|focus|goal|plan|success)/.test(p)) return pickFromPool(TG_STICKER_MOTIVATION_IDS);
  return pickFromPool(TG_STICKER_SUCCESS_IDS);
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
  systemPrompt: string,
  aiRuntimeConfig?: { provider?: string; model?: string }
): Promise<string> => {
  const verifyPrompt = `Verify the following answer for factual consistency and correctness. If incorrect, return a corrected answer in the same professional structure.\n\nQuestion:\n${question}\n\nDraft Answer:\n${draftAnswer}\n\nReturn only the final corrected answer.`;
  const verified = await withTimeout(
    generateBotResponse(verifyPrompt, undefined, history, systemPrompt, aiRuntimeConfig),
    AI_RESPONSE_TIMEOUT_MS,
    'AI verification timeout'
  );
  return String(verified || draftAnswer).trim();
};

const generateProfessionalReply = async (
  messageText: string,
  chatIdentity?: string | number,
  scope: string = 'telegram:primary',
  aiRuntimeConfig?: { provider?: string; model?: string }
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
  ensurePremiumConversationStyle(conversationKey);
  const renameTo = extractAssistantRenameCommand(trimmedInput);
  if (renameTo) {
    const appliedName = setAssistantNamePreference(conversationKey, renameTo);
    const confirm = finalizeProfessionalReply(
      trimmedInput,
      `Done. In this chat, you can call me ${appliedName}.`,
      conversationKey
    );
    appendChatHistory(conversationKey, trimmedInput, confirm);
    return confirm;
  }
  if (isRenameIntentPrompt(trimmedInput)) {
    const askName = finalizeProfessionalReply(
      trimmedInput,
      'Please tell me the exact name you want to use, for example: "Can I call you Savio?"',
      conversationKey
    );
    appendChatHistory(conversationKey, trimmedInput, askName);
    return askName;
  }

  const normalizedPrompt = trimmedInput.toLowerCase().replace(/\s+/g, ' ');
  if (/(who are you|what are you|what('?s| is)\s+your\s+name|your name\??|your real name|real name|official name|what (should|can|do) i call you|what is call you|what i call you|what i called you|what did i call you)/.test(normalizedPrompt)) {
    const officialName = getOfficialAssistantName(conversationKey);
    const alias = sanitizeAssistantName(userProfiles.get(conversationKey || '')?.assistantName || '');
    const aliasLine = alias ? ` In this chat, you can also call me ${alias}.` : '';
    const answer = finalizeProfessionalReply(
      trimmedInput,
      `My official name is ${officialName}.${aliasLine} I can help with coding, debugging, setup, deployment, and general questions.`,
      conversationKey
    );
    appendChatHistory(conversationKey, trimmedInput, answer);
    return answer;
  }
  const instant = instantProfessionalReply(trimmedInput);
  if (instant) {
    const answer = finalizeProfessionalReply(trimmedInput, instant, conversationKey);
    appendChatHistory(conversationKey, trimmedInput, answer);
    return answer;
  }
  if (isGreetingPrompt(normalizedPrompt)) {
    const fastGreeting = finalizeProfessionalReply(trimmedInput, 'Hello! How can I help you today?', conversationKey);
    appendChatHistory(conversationKey, trimmedInput, fastGreeting);
    return fastGreeting;
  }
  if (/(what can you do|capabilities|how can you help|what do you do)/.test(normalizedPrompt)) {
    const answer = finalizeProfessionalReply(
      trimmedInput,
      'I can answer questions, help fix code, troubleshoot deployment issues, and guide Telegram/Discord bot setup step by step.',
      conversationKey
    );
    appendChatHistory(conversationKey, trimmedInput, answer);
    return answer;
  }
  const timeSensitive = isTimeSensitivePrompt(normalizedPrompt);
  const intent = detectIntent(trimmedInput);
  const realtimeSearchRequested = needsRealtimeSearch(trimmedInput);
  const cacheScope = conversationKey || `${scope}:anonymous`;
  const cacheKey = `${cacheScope}:${RESPONSE_STYLE_VERSION}:${normalizedPrompt}`;
  const cached = timeSensitive ? undefined : aiResponseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    const vettedCached = enforceProfessionalReplyQuality(trimmedInput, cached.text, conversationKey);
    if (!isLowValueDeflectionReply(vettedCached)) {
      return vettedCached;
    }
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
        generateBotResponse(trimmedInput, undefined, history, systemPrompt, aiRuntimeConfig),
        AI_RESPONSE_TIMEOUT_MS,
        'AI response timeout'
      );
      const polished = formatProfessionalResponse(response || 'No response generated.', trimmedInput);
      let clean = finalizeProfessionalReply(trimmedInput, polished, conversationKey);
      if (!clean || (clean.length < 24 && !isAcceptableShortAnswer(clean, trimmedInput))) {
        clean = finalizeProfessionalReply(
          trimmedInput,
          instantProfessionalReply(trimmedInput) || generateEmergencyReply(trimmedInput),
          conversationKey
        );
      }
      if (AI_ENABLE_STRICT_RETRY && (intent === 'current_event' || timeSensitive) && hasLowConfidenceMarkers(clean)) {
        const strictRetryPrompt = `${trimmedInput}\n\nRealtime expected. Use verified live data strictly. Do not fall back to 2023 memory.`;
        const strictRetry = await withTimeout(
          generateBotResponse(strictRetryPrompt, undefined, history, systemPrompt, aiRuntimeConfig),
          AI_RESPONSE_TIMEOUT_MS,
          'AI strict retry timeout'
        );
        clean = finalizeProfessionalReply(
          trimmedInput,
          formatProfessionalResponse(strictRetry || clean, trimmedInput),
          conversationKey
        );
      }
      const shouldRetry = AI_MAX_RETRY_PASSES > 0
        && !isSimplePrompt(trimmedInput)
        && (looksLowQualityAnswer(clean, trimmedInput) || looksSuspiciousResponse(trimmedInput, clean));
      if (shouldRetry) {
        const retryPrompt = `${trimmedInput}\n\nAnswer directly with accurate, complete details. Avoid generic limitations text. For time-sensitive questions, include current-year context and assumptions.`;
        const retry = await withTimeout(
          generateBotResponse(retryPrompt, undefined, history, systemPrompt, aiRuntimeConfig),
          AI_RESPONSE_TIMEOUT_MS,
          'AI response timeout'
        );
        const retryPolished = formatProfessionalResponse(retry || clean, trimmedInput);
        let retryClean = finalizeProfessionalReply(trimmedInput, retryPolished, conversationKey);
        if (AI_ENABLE_SELF_VERIFY && intent === 'current_event' && !isSimplePrompt(trimmedInput)) {
          retryClean = finalizeProfessionalReply(
            trimmedInput,
            formatProfessionalResponse(await selfVerifyAnswer(trimmedInput, retryClean, history, systemPrompt, aiRuntimeConfig), trimmedInput),
            conversationKey
          );
        }
        appendChatHistory(conversationKey, trimmedInput, retryClean);
        if (!timeSensitive && !isLowValueDeflectionReply(retryClean)) {
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
        clean = finalizeProfessionalReply(
          trimmedInput,
          formatProfessionalResponse(await selfVerifyAnswer(trimmedInput, clean, history, systemPrompt, aiRuntimeConfig), trimmedInput),
          conversationKey
        );
      }
      appendChatHistory(conversationKey, trimmedInput, clean);
      if (!timeSensitive && !isLowValueDeflectionReply(clean)) {
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
        console.warn('[AI] Live context unavailable, continuing with resilient fallback answer flow.');
      }
      if (timeSensitive) {
        console.warn('[AI] Time-sensitive query fallback triggered.');
      }
      console.error('[AI] Primary model failed, switching to fallback:', error);
      try {
        const fallback = await withTimeout(
          getAIResponse(trimmedInput),
          AI_RESPONSE_TIMEOUT_MS,
          'Fallback AI response timeout'
        );
        const fallbackPolished = formatProfessionalResponse(fallback || 'No fallback response generated.', trimmedInput);
        const clean = finalizeProfessionalReply(trimmedInput, fallbackPolished, conversationKey);
        appendChatHistory(conversationKey, trimmedInput, clean);
        if (!timeSensitive && !isLowValueDeflectionReply(clean)) {
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
        const emergency = finalizeProfessionalReply(trimmedInput, generateEmergencyReply(trimmedInput), conversationKey);
        appendChatHistory(conversationKey, trimmedInput, emergency);
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
    const conversationKey = buildConversationKey('telegram:primary', chatId) || undefined;
    const response = await sendTelegramStreamingReply(
      bot,
      chatId,
      generateProfessionalReply(messageText, chatId, 'telegram:primary'),
      msg.message_id
    );
    const stickersEnabled = FORCE_STICKERS_ON || (conversationKey ? (userProfiles.get(conversationKey)?.stickersEnabled !== false) : true);
    const stickerId = stickersEnabled ? pickStickerForContext(messageText, response) : '';
    if (stickerId) {
      try {
        await bot.sendSticker(chatId, stickerId, { reply_to_message_id: msg.message_id });
      } catch {}
    }
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
  if (botId && CREDIT_ENFORCEMENT_ACTIVE) {
    const credit = applyCreditDecay(botId);
    if (credit.depleted || credit.remainingUsd <= 0) {
      const botInstance = managedBots.get(botToken) || new TelegramBot(botToken, { polling: false });
      if (!managedBots.has(botToken)) managedBots.set(botToken, botInstance);
      await sendTelegramReply(
        botInstance,
        chatId,
        '\u26A0\uFE0F You are out of credit limit. Recharge fast to continue with the AI bot.',
        msg.message_id
      );
      persistBotState();
      return;
    }
  }
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
  const conversationKey = buildConversationKey(botScope, chatId) || undefined;
  let selectedProvider = String(botId ? (telegramBotAiProviders.get(botId) || '') : '').trim().toLowerCase();
  let selectedModel = String(botId ? (telegramBotAiModels.get(botId) || '') : '').trim();
  if (botId && (!selectedProvider || !selectedModel)) {
    const strictDefault = resolveTelegramAiConfig('');
    selectedProvider = strictDefault.provider;
    selectedModel = strictDefault.model;
    telegramBotAiProviders.set(botId, selectedProvider);
    telegramBotAiModels.set(botId, selectedModel);
    persistBotState();
  }
  if (!selectedProvider || !selectedModel) {
    const strictDefault = resolveTelegramAiConfig('');
    selectedProvider = strictDefault.provider;
    selectedModel = strictDefault.model;
  }

  if (/^\/start(?:@\w+)?$/i.test(text)) {
    const welcome = `AI Provider: ${selectedProvider}\nAI Model: ${selectedModel}\n\nSend a message to start chatting with AI.`;
    await botInstance.sendMessage(chatId, welcome);
    if (botId) recordBotResponse(botId, welcome, 0);
    return;
  }
  const commandReply = getCommandReply(text, conversationKey);
  if (commandReply) {
    await sendTelegramReply(botInstance, chatId, commandReply, msg.message_id);
    if (botId) recordBotResponse(botId, commandReply, 0);
    return;
  }

  try {
    const startedAt = Date.now();
    await botInstance.sendChatAction(chatId, 'typing');
    const conversationKey = buildConversationKey(botScope, chatId) || undefined;
    const aiReply = await sendTelegramStreamingReply(
      botInstance,
      chatId,
      generateProfessionalReply(text, chatId, botScope, {
        provider: selectedProvider,
        model: selectedModel
      }),
      msg.message_id
    );
    const stickersEnabled = FORCE_STICKERS_ON || (conversationKey ? (userProfiles.get(conversationKey)?.stickersEnabled !== false) : true);
    const stickerId = stickersEnabled ? pickStickerForContext(text, aiReply) : '';
    if (stickerId) {
      try {
        await botInstance.sendSticker(chatId, stickerId, { reply_to_message_id: msg.message_id });
      } catch {}
    }
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
      if (match.botUsername) telegramBotUsernames.set(match.botId, String(match.botUsername).trim());
      if (match.botName) telegramBotNames.set(match.botId, String(match.botName).trim());
      if (match.aiProvider) telegramBotAiProviders.set(match.botId, String(match.aiProvider).trim().toLowerCase());
      if (match.aiModel) telegramBotAiModels.set(match.botId, String(match.aiModel).trim());
      botCredits.set(match.botId, {
        remainingUsd: Math.max(0, Number(match.creditRemainingUsd ?? INITIAL_BOT_CREDIT_USD)),
        lastChargedAt: Math.max(0, Number(match.creditLastChargedAt ?? Date.now())),
        depleted: Boolean(match.creditDepleted) || Number(match.creditRemainingUsd ?? INITIAL_BOT_CREDIT_USD) <= 0,
        updatedAt: Date.now(),
        policyVersion: Math.max(1, Number(match.creditPolicyVersion || 1))
      });
      applyCreditDecay(match.botId);
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
type DeployTelegramBotArgs = {
  botToken: string;
  requestedBotId: string;
  selectedModel: string;
  userEmail: string;
};

type DeployTelegramBotResponse = {
  success: true;
  message: string;
  botId: string;
  botUsername: string | null;
  botName: string | null;
  telegramLink: string | null;
  creditRemainingUsd: number;
  creditDepleted: boolean;
  aiProvider: string;
  aiModel: string;
  aiModelLocked: boolean;
  webhookUrl: string;
  telegramResponse: any;
};

const deployTelegramBotForUser = async (args: DeployTelegramBotArgs): Promise<DeployTelegramBotResponse> => {
  const botToken = String(args.botToken || '').trim();
  const requestedBotId = String(args.requestedBotId || '').trim();
  const selectedModel = String(args.selectedModel || '').trim();
  const userEmail = String(args.userEmail || '').trim().toLowerCase();

  if (!botToken) {
    const err = new Error('Bot token is required');
    (err as any).status = 400;
    (err as any).body = { error: 'Bot token is required' };
    throw err;
  }
  if (!userEmail) {
    const err = new Error('Authentication required');
    (err as any).status = 401;
    (err as any).body = { error: 'Authentication required' };
    throw err;
  }
  if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(botToken)) {
    const err = new Error('Invalid Telegram bot token format');
    (err as any).status = 400;
    (err as any).body = { error: 'Invalid Telegram bot token format' };
    throw err;
  }

  const fallbackBotId = botToken.split(':')[0] || '';
  const candidateBotId = requestedBotId || fallbackBotId;
  if (!candidateBotId) {
    const err = new Error('Unable to derive bot ID from token. Please provide botId.');
    (err as any).status = 400;
    (err as any).body = { error: 'Unable to derive bot ID from token. Please provide botId.' };
    throw err;
  }

  const verifyResponse = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
  const verifyData: any = await verifyResponse.json().catch(() => ({}));
  if (!verifyData?.ok) {
    const err = new Error('Invalid Telegram token');
    (err as any).status = 400;
    (err as any).body = {
      success: false,
      error: 'Invalid Telegram token',
      details: verifyData?.description || 'Telegram token validation failed'
    };
    throw err;
  }

  const telegramNumericId = String(verifyData?.result?.id || '').trim();
  const botId = telegramNumericId || candidateBotId;
  const currentOwner = (telegramBotOwners.get(botId) || getPersistedTelegramOwner(botId) || '').trim().toLowerCase();
  if (currentOwner && currentOwner !== userEmail) {
    const err = new Error('Bot ID already belongs to another account');
    (err as any).status = 403;
    (err as any).body = { success: false, error: 'Bot ID already belongs to another account' };
    throw err;
  }

  const botUsername = String(verifyData?.result?.username || '').trim();
  const botName = String(verifyData?.result?.first_name || '').trim();
  if (!botUsername) {
    const err = new Error('Telegram bot username missing');
    (err as any).status = 400;
    (err as any).body = {
      success: false,
      error: 'Telegram bot username missing',
      details: 'Create bot via @BotFather first, then use its token here.'
    };
    throw err;
  }

  const aiConfig = resolveTelegramAiConfig(selectedModel);

  // Store the bot token and config.
  botTokens.set(botId, botToken);
  telegramBotOwners.set(botId, userEmail);
  if (botUsername) telegramBotUsernames.set(botId, botUsername);
  if (botName) telegramBotNames.set(botId, botName);
  telegramBotAiProviders.set(botId, aiConfig.provider);
  telegramBotAiModels.set(botId, aiConfig.model);
  botCredits.set(botId, {
    remainingUsd: INITIAL_BOT_CREDIT_USD,
    lastChargedAt: Date.now(),
    depleted: false,
    updatedAt: Date.now(),
    policyVersion: BOT_CREDIT_POLICY_VERSION
  });
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

  // Set webhook for the bot.
  const webhookResult = await (global as any).setWebhookForBot(botToken, botId);
  if (!webhookResult.success) {
    botTokens.delete(botId);
    telegramBotOwners.delete(botId);
    telegramBotUsernames.delete(botId);
    telegramBotNames.delete(botId);
    telegramBotAiProviders.delete(botId);
    telegramBotAiModels.delete(botId);
    botCredits.delete(botId);
    persistBotState();
    const err = new Error('Failed to set webhook');
    (err as any).status = 500;
    (err as any).body = {
      success: false,
      error: 'Failed to set webhook',
      details: webhookResult.error
    };
    throw err;
  }

  persistBotState();
  return {
    success: true,
    message: 'Bot deployed successfully',
    botId,
    botUsername: botUsername || null,
    botName: botName || null,
    telegramLink: botUsername ? `https://t.me/${botUsername}` : null,
    creditRemainingUsd: botCredits.get(botId)?.remainingUsd ?? INITIAL_BOT_CREDIT_USD,
    creditDepleted: botCredits.get(botId)?.depleted ?? false,
    aiProvider: aiConfig.provider,
    aiModel: aiConfig.model,
    aiModelLocked: true,
    webhookUrl: `${BASE_URL}/webhook/${botId}`,
    telegramResponse: webhookResult.data
  };
};

app.post('/deploy-bot', requireAuth, deployRateLimit, async (req, res) => {
  const botToken = typeof req.body?.botToken === 'string' ? req.body.botToken.trim() : '';
  const requestedBotId = typeof req.body?.botId === 'string' ? req.body.botId.trim() : '';
  const selectedModel = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
  const reqUser = req.user as Express.User | undefined;
  const userEmail = (reqUser?.email || '').trim().toLowerCase();
  
  if (!botToken) return res.status(400).json({ error: 'Bot token is required' });
  if (!userEmail) return res.status(401).json({ error: 'Authentication required' });
  if (requiresTelegramSubscription(userEmail)) {
    return res.status(402).json({
      success: false,
      subscriptionRequired: true,
      error: 'Subscription required before first deployment.'
    });
  }

  try {
    const payload = await deployTelegramBotForUser({
      botToken,
      requestedBotId,
      selectedModel,
      userEmail
    });
    console.log(`[DEPLOY] Successfully deployed bot ${payload.botId}`);
    return res.json(payload);
  } catch (error: any) {
    const status = typeof error?.status === 'number' ? error.status : 500;
    const body = error?.body;
    if (body) {
      return res.status(status).json(body);
    }
    console.error(`[DEPLOY] Error deploying bot ${requestedBotId || botToken.split(':')[0]}:`, error);
    return res.status(500).json({
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
    .map(([id, token]) => {
      const credit = applyCreditDecay(id);
      const botUsername = String(telegramBotUsernames.get(id) || '').trim();
      const botName = String(telegramBotNames.get(id) || '').trim();
      return {
        id,
        platform: 'TELEGRAM',
        token: token.substring(0, 10) + '...', // Mask the token
        botUsername: botUsername || null,
        botName: botName || null,
        telegramLink: botUsername ? `https://t.me/${botUsername}` : null,
        aiProvider: telegramBotAiProviders.get(id) || null,
        aiModel: telegramBotAiModels.get(id) || null,
        creditRemainingUsd: credit.remainingUsd,
        creditDepleted: credit.depleted
      };
    });
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

app.get('/bot-credit/:botId', requireAuth, (req, res) => {
  const botId = String(req.params.botId || '').trim();
  const reqUser = req.user as Express.User | undefined;
  const userEmail = (reqUser?.email || '').trim().toLowerCase();
  const owner = (telegramBotOwners.get(botId) || getPersistedTelegramOwner(botId) || '').trim().toLowerCase();
  if (!botId) {
    return res.status(400).json({ success: false, message: 'botId is required' });
  }
  if (!owner || !userEmail || owner !== userEmail) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }
  const credit = applyCreditDecay(botId);
  persistBotState();
  return res.json({
    success: true,
    botId,
    remainingUsd: credit.remainingUsd,
    depleted: credit.depleted,
    warning: credit.depleted ? '\u26A0\uFE0F You are out of credit limit. Recharge fast to continue with the AI bot.' : ''
  });
});

app.get('/bot-profile/:botId', requireAuth, async (req, res) => {
  const botId = String(req.params.botId || '').trim();
  const reqUser = req.user as Express.User | undefined;
  const userEmail = (reqUser?.email || '').trim().toLowerCase();
  const owner = (telegramBotOwners.get(botId) || getPersistedTelegramOwner(botId) || '').trim().toLowerCase();
  if (!botId) {
    return res.status(400).json({ success: false, message: 'botId is required' });
  }
  if (!owner || !userEmail || owner !== userEmail) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  let botUsername = String(telegramBotUsernames.get(botId) || '').trim();
  let botName = String(telegramBotNames.get(botId) || '').trim();
  const token = String(botTokens.get(botId) || '').trim();

  // Refresh profile from Telegram when possible to avoid generic fallback names.
  if (token) {
    try {
      const verifyResponse = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const verifyData: any = await verifyResponse.json().catch(() => ({}));
      if (verifyData?.ok) {
        botUsername = String(verifyData?.result?.username || botUsername || '').trim();
        botName = String(verifyData?.result?.first_name || botName || '').trim();
        if (botUsername) telegramBotUsernames.set(botId, botUsername);
        if (botName) telegramBotNames.set(botId, botName);
        persistBotState();
      }
    } catch {
      // Fallback to persisted/in-memory values.
    }
  }

  return res.json({
    success: true,
    botId,
    botUsername: botUsername || null,
    botName: botName || null
  });
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
    freeDeployLimit: null,
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

app.post('/billing/create-telegram-subscription-session', requireAuth, billingRateLimit, async (req, res) => {
  const reqUser = req.user as Express.User | undefined;
  const userEmail = (reqUser?.email || '').trim().toLowerCase();
  if (!userEmail) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  // Existing Telegram bot owners skip the subscription gate.
  if (!requiresTelegramSubscription(userEmail)) {
    return res.json({ success: true, subscriptionRequired: false });
  }

  const botToken = typeof req.body?.botToken === 'string' ? req.body.botToken.trim() : '';
  const selectedModel = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
  if (!botToken) {
    return res.status(400).json({ success: false, message: 'Bot token is required' });
  }
  if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(botToken)) {
    return res.status(400).json({ success: false, message: 'Invalid Telegram bot token format' });
  }

  purgeExpiredTelegramDeployIntents();

  // Validate token before charging.
  const verifyResponse = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
  const verifyData: any = await verifyResponse.json().catch(() => ({}));
  if (!verifyData?.ok) {
    return res.status(400).json({
      success: false,
      message: 'Invalid Telegram token',
      details: verifyData?.description || 'Telegram token validation failed'
    });
  }
  const botUsername = String(verifyData?.result?.username || '').trim();
  const botName = String(verifyData?.result?.first_name || '').trim();
  const telegramBotId = String(verifyData?.result?.id || '').trim();
  const existingOwnerEmail = (telegramBotOwners.get(telegramBotId) || getPersistedTelegramOwner(telegramBotId) || '').trim().toLowerCase();
  if (existingOwnerEmail && existingOwnerEmail !== userEmail) {
    return res.status(403).json({
      success: false,
      message: 'This Telegram bot token already belongs to another email account.',
      details: 'Sign in with the original email owner or create a new bot token in @BotFather.'
    });
  }
  if (!botUsername) {
    return res.status(400).json({
      success: false,
      message: 'Telegram bot username missing',
      details: 'Create bot via @BotFather first, then use its token here.'
    });
  }

  const stripeSecretKey = getStripeSecretKey();
  if (!stripeSecretKey || !stripeSecretKey.startsWith('sk_')) {
    return res.status(500).json({ success: false, message: 'Stripe is not configured on the server.' });
  }

  const intentId = randomUUID();
  pendingTelegramDeployIntents.set(intentId, {
    intentId,
    userEmail,
    botToken,
    selectedModel,
    createdAt: Date.now()
  });

  const frontUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const successUrl = `${frontUrl}/#/connect/telegram?stage=subscribe&subscribe=success&intentId=${encodeURIComponent(intentId)}&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${frontUrl}/#/connect/telegram?stage=subscribe&subscribe=cancel&intentId=${encodeURIComponent(intentId)}`;

  try {
    const params = new URLSearchParams();
    params.set('mode', 'subscription');
    params.set('success_url', successUrl);
    params.set('cancel_url', cancelUrl);
    params.set('customer_email', userEmail);
    params.set('payment_method_types[0]', 'card');
    params.set('client_reference_id', reqUser?.id || randomUUID());
    params.set('metadata[purchase_type]', 'telegram_subscription');
    params.set('metadata[user_email]', userEmail);
    params.set('metadata[intent_id]', intentId);
    if (telegramBotId) {
      params.set('metadata[telegram_bot_id]', telegramBotId);
    }
    params.set('line_items[0][price_data][currency]', 'usd');
    params.set('line_items[0][price_data][unit_amount]', String(TELEGRAM_SUBSCRIPTION_PRICE_USD_CENTS));
    params.set('line_items[0][price_data][recurring][interval]', TELEGRAM_SUBSCRIPTION_INTERVAL);
    params.set('line_items[0][price_data][product_data][name]', TELEGRAM_SUBSCRIPTION_LABEL);
    if (TELEGRAM_SUBSCRIPTION_DESCRIPTION) {
      params.set('line_items[0][price_data][product_data][description]', TELEGRAM_SUBSCRIPTION_DESCRIPTION);
    }
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
      pendingTelegramDeployIntents.delete(intentId);
      return res.status(502).json({ success: false, message: stripeData?.error?.message || 'Unable to create Stripe checkout session.' });
    }

    return res.json({
      success: true,
      subscriptionRequired: true,
      amountUsd: Math.round(TELEGRAM_SUBSCRIPTION_PRICE_USD_CENTS / 100),
      checkoutUrl: stripeData.url,
      intentId,
      botUsername,
      botName: botName || null
    });
  } catch (error) {
    pendingTelegramDeployIntents.delete(intentId);
    return res.status(500).json({
      success: false,
      message: 'Failed to initialize secure checkout.',
      details: error instanceof Error ? error.message : String(error || 'Unknown error')
    });
  }
});

app.post('/billing/confirm-telegram-subscription-session', requireAuth, billingRateLimit, async (req, res) => {
  const reqUser = req.user as Express.User | undefined;
  const userEmail = (reqUser?.email || '').trim().toLowerCase();
  if (!userEmail) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  const sessionId = String(req.body?.sessionId || '').trim();
  const intentId = String(req.body?.intentId || '').trim();
  if (!sessionId || !intentId) {
    return res.status(400).json({ success: false, message: 'sessionId and intentId are required.' });
  }

  const previous = processedTelegramSubscriptionSessions.get(sessionId);
  if (previous) {
    if (previous.userEmail !== userEmail) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    return res.json({
      ...(previous.deployPayload || {}),
      success: true,
      alreadyProcessed: true,
      subscribed: true,
      deployed: Boolean(previous.deployed)
    });
  }

  purgeExpiredTelegramDeployIntents();
  const intent = pendingTelegramDeployIntents.get(intentId);
  if (!intent) {
    return res.status(404).json({ success: false, message: 'Deployment intent expired. Please retry from the connect page.' });
  }
  if (intent.userEmail !== userEmail) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  const stripeSecretKey = getStripeSecretKey();
  if (!stripeSecretKey || !stripeSecretKey.startsWith('sk_')) {
    return res.status(500).json({ success: false, message: 'Stripe is not configured on the server.' });
  }

  try {
    const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`
      }
    });
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(502).json({ success: false, message: data?.error?.message || 'Unable to verify checkout session.' });
    }

    const metadata = data?.metadata || {};
    const purchaseType = String(metadata?.purchase_type || '').trim();
    const metaEmail = String(metadata?.user_email || '').trim().toLowerCase();
    const metaIntentId = String(metadata?.intent_id || '').trim();
    const paid = String(data?.payment_status || '').toLowerCase() === 'paid';
    const status = String(data?.status || '').toLowerCase();

    if (!paid || status !== 'complete' || purchaseType !== 'telegram_subscription' || metaIntentId !== intentId) {
      return res.status(400).json({ success: false, message: 'Checkout session is not eligible for Telegram subscription.' });
    }
    if (metaEmail && metaEmail !== userEmail) {
      return res.status(403).json({ success: false, message: 'Session email mismatch.' });
    }

    processedTelegramSubscriptionSessions.set(sessionId, {
      intentId,
      userEmail,
      deployed: false,
      processedAt: Date.now()
    });

    // Mark subscription active before deployment so the user can retry deploy without paying again.
    setUserPlan(userEmail, 'PRO_MONTHLY');

    const deployPayload = await deployTelegramBotForUser({
      botToken: intent.botToken,
      requestedBotId: '',
      selectedModel: intent.selectedModel,
      userEmail
    });

    processedTelegramSubscriptionSessions.set(sessionId, {
      intentId,
      userEmail,
      deployed: true,
      processedAt: Date.now(),
      deployPayload
    });
    pendingTelegramDeployIntents.delete(intentId);

    return res.json({
      ...deployPayload,
      subscribed: true
    });
  } catch (error: any) {
    // Keep subscription active even if deployment fails.
    setUserPlan(userEmail, 'PRO_MONTHLY');
    pendingTelegramDeployIntents.delete(intentId);
    const status = typeof error?.status === 'number' ? error.status : 500;
    const body = error?.body;
    if (body) {
      return res.status(status).json({ ...body, subscribed: true });
    }
    return res.status(500).json({
      success: false,
      subscribed: true,
      message: 'Failed to confirm subscription or deploy bot.',
      details: error instanceof Error ? error.message : String(error || 'Unknown error')
    });
  }
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

app.post('/billing/create-credit-session', billingRateLimit, async (req, res) => {
  const reqUser = req.user as Express.User | undefined;
  const bodyEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const email = (reqUser?.email || bodyEmail || '').trim().toLowerCase();
  if (!email && !reqUser) {
    // Guest checkout is allowed; Stripe will collect email during checkout if omitted.
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
  const botId = String(req.body?.botId || '').trim();
  if (!botId) {
    return res.status(400).json({ success: false, message: 'botId is required for credit top-up.' });
  }
  const hasBot = botTokens.has(botId) || Boolean(getPersistedTelegramOwner(botId));
  if (!hasBot) {
    return res.status(404).json({ success: false, message: 'Bot not found for credit top-up.' });
  }

  const stripeSecretKey = getStripeSecretKey();
  if (!stripeSecretKey || !stripeSecretKey.startsWith('sk_')) {
    return res.status(500).json({ success: false, message: 'Stripe is not configured on the server.' });
  }

  const frontUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const successUrl = `${frontUrl}/#/connect/telegram?stage=success&credit=success&botId=${encodeURIComponent(botId)}&amount=${amountUsd}&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${frontUrl}/#/connect/telegram?stage=success&credit=cancel&botId=${encodeURIComponent(botId)}`;

  try {
    const params = new URLSearchParams();
    params.set('mode', 'payment');
    params.set('success_url', successUrl);
    params.set('cancel_url', cancelUrl);
    if (email) {
      params.set('customer_email', email);
    }
    params.set('payment_method_types[0]', 'card');
    params.set('client_reference_id', reqUser?.id || randomUUID());
    params.set('metadata[purchase_type]', 'credit_topup');
    if (email) {
      params.set('metadata[user_email]', email);
    }
    params.set('metadata[amount_usd]', String(amountUsd));
    params.set('metadata[bot_id]', botId);
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

app.post('/billing/confirm-credit-session', async (req, res) => {
  const reqUser = req.user as Express.User | undefined;
  const bodyEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const email = (reqUser?.email || bodyEmail || '').trim().toLowerCase();

  const sessionId = String(req.body?.sessionId || '').trim();
  const botId = String(req.body?.botId || '').trim();
  if (!sessionId || !botId) {
    return res.status(400).json({ success: false, message: 'sessionId and botId are required.' });
  }
  if (processedCreditSessions.has(sessionId)) {
    const credit = applyCreditDecay(botId);
    return res.json({
      success: true,
      botId,
      remainingUsd: credit.remainingUsd,
      depleted: credit.depleted,
      creditLastChargedAt: credit.lastChargedAt,
      warning: credit.depleted ? '\u26A0\uFE0F You are out of credit limit. Recharge fast to continue with the AI bot.' : '',
      alreadyProcessed: true
    });
  }

  const hasBot = botTokens.has(botId) || Boolean(getPersistedTelegramOwner(botId));
  if (!hasBot) {
    return res.status(404).json({ success: false, message: 'Bot not found.' });
  }

  const stripeSecretKey = getStripeSecretKey();
  if (!stripeSecretKey || !stripeSecretKey.startsWith('sk_')) {
    return res.status(500).json({ success: false, message: 'Stripe is not configured on the server.' });
  }

  try {
    const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`
      }
    });
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(502).json({ success: false, message: data?.error?.message || 'Unable to verify checkout session.' });
    }
    const metadata = data?.metadata || {};
    const purchaseType = String(metadata?.purchase_type || '').trim();
    const metaEmail = String(metadata?.user_email || '').trim().toLowerCase();
    const metaBotId = String(metadata?.bot_id || '').trim();
    const amountUsd = Math.max(0, Math.floor(Number(metadata?.amount_usd || 0)));
    const paid = String(data?.payment_status || '').toLowerCase() === 'paid';
    if (!paid || purchaseType !== 'credit_topup' || metaBotId !== botId || amountUsd < 10) {
      return res.status(400).json({ success: false, message: 'Checkout session is not eligible for credit top-up.' });
    }
    if (email && metaEmail && metaEmail !== email) {
      return res.status(403).json({ success: false, message: 'Session email mismatch.' });
    }

    processedCreditSessions.add(sessionId);
    const updated = addCreditToBot(botId, amountUsd);
    persistBotState();
    return res.json({
      success: true,
      botId,
      creditedUsd: amountUsd,
      remainingUsd: updated.remainingUsd,
      depleted: updated.depleted,
      creditLastChargedAt: updated.lastChargedAt,
      warning: updated.depleted ? '\u26A0\uFE0F You are out of credit limit. Recharge fast to continue with the AI bot.' : ''
    });
  } catch {
    return res.status(500).json({ success: false, message: 'Failed to confirm credit purchase.' });
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
  loadSubscriptionState();
  restorePersistedBots().catch((error) => {
    console.warn('[BOT_STATE] Restore routine failed:', (error as Error).message);
  });
  ensurePrimaryTelegramWebhook().catch((error) => {
    console.warn('[WEBHOOK] Primary webhook setup failed:', (error as Error).message);
  });
});

const creditDecayTimer = CREDIT_ENFORCEMENT_ACTIVE
  ? setInterval(() => {
    let changed = false;
    for (const botId of botTokens.keys()) {
      const before = botCredits.get(botId)?.remainingUsd ?? INITIAL_BOT_CREDIT_USD;
      const after = applyCreditDecay(botId).remainingUsd;
      if (after !== before) changed = true;
    }
    if (changed) {
      persistBotState();
    }
  }, 30_000)
  : null;
creditDecayTimer?.unref();

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  if (creditDecayTimer) clearInterval(creditDecayTimer);
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
  if (creditDecayTimer) clearInterval(creditDecayTimer);
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


