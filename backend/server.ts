
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import TelegramBot from 'node-telegram-bot-api';
import { GoogleGenAI } from "@google/genai";
import passport from 'passport';
import session from 'express-session';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { sendVerificationEmail, sendTestEmail, validateVerificationCode, getPendingVerifications } from './emailService.js';

// In-memory storage for bot tokens (in production, use a proper database)
const botTokens = new Map<string, string>();

// Validate required environment variables
const requiredEnvVars = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'TELEGRAM_BOT_TOKEN',
  'API_KEY',
  'SESSION_SECRET'
] as const;

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error("❌ ERROR: Missing required environment variables");
  console.error(`Please ensure the following are set in your .env file: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

// Type-safe environment variable access
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const API_KEY = process.env.API_KEY!;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const SESSION_SECRET = process.env.SESSION_SECRET!;

console.log("Google Client ID:", process.env.GOOGLE_CLIENT_ID);

const app = express();

/**
 * PRODUCTION NODE CONFIGURATION
 * Using values from provided environment
 */

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BASE_URL = process.env.BASE_URL || `http://${process.env.HOST || 'localhost'}:${parseInt(process.env.PORT || '8080', 10)}`;

// Middleware configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}) as any);

// Authentication middleware
const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: 'Authentication required' });
};

app.use(session({
  secret: process.env.SESSION_SECRET || 'super_secret_session_key_32_chars',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // Set to true in production with HTTPS
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

app.use(express.json() as any);
app.use(passport.initialize());
app.use(passport.session());

// Passport.js Google OAuth Configuration
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  callbackURL: process.env.GOOGLE_CALLBACK_URL || `${process.env.BASE_URL || `https://${process.env.HOST || 'localhost'}:${parseInt(process.env.PORT || '8080', 10)}`}/auth/google/callback`
},
async (accessToken, refreshToken, profile, done) => {
  try {
    // Create or update user in your database
    // For now, we'll just return the profile info
    const user = {
      id: profile.id,
      name: profile.displayName,
      email: profile.emails?.[0].value,
      photo: profile.photos?.[0].value
    };
    return done(null, user);
  } catch (error) {
    return done(error as any, undefined);
  }
}
));

// Serialize user into the sessions
passport.serializeUser((user: any, done) => {
  done(null, user);
});

// Deserialize user from the sessions
passport.deserializeUser((user: any, done) => {
  done(null, user);
});

// Initialize Telegram Bot with default token
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

// Declare global function type
declare global {
  var setWebhookForBot: (botToken: string, botId: string) => Promise<{ success: boolean; data?: any; error?: string }>;
}

// Function to set webhook for a bot
(global as any).setWebhookForBot = async (botToken: string, botId: string) => {
  const webhookUrl = `${BASE_URL}/webhook/${botId}`;
  const setWebhookUrl = `https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
  
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
 * Professional AI Reasoning Engine
 * Compliant with Gemini 3 Pro requirements
 */
async function getAIResponse(userText: string): Promise<string> {
  // FIX: strictly use process.env.API_KEY as required by the library guidelines.
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    console.error("[CRITICAL] API_KEY missing from server configuration.");
    return "Neural Handshake Failed: System Offline.";
  }

  try {
    const ai = new GoogleGenAI({ apiKey: apiKey });
    
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      config: {
        systemInstruction: "You are the SimpleClaw AI assistant. You are a highly professional, accurate, and strategic AI agent. Your goal is to provide world-class technical and general assistance.",
        temperature: 0.6,
        maxOutputTokens: 8000,
        thinkingConfig: { thinkingBudget: 4000 }
      }
    });

    return response.text || "No signal detected from Neural Backbone.";
  } catch (error) {
    console.error("[Neural Link Error]:", error);
    return "Signal Interrupted. The AI engine is undergoing maintenance.";
  }
}

/**
 * Telegram Event Signal Handlers
 */
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  console.log(`[SIGNAL] Incoming message from ChatID: ${chatId}`);

  if (text === '/start') {
    await bot.sendMessage(chatId, "🚀 *SimpleClaw Node Established.*\n\nIntelligence Stream: Gemini 3 Pro (Active)\nLatency: 124ms\n\nReady for operations. Send a query to begin.", { parse_mode: 'Markdown' });
    return;
  }

  try {
    await bot.sendChatAction(chatId, 'typing');
    const aiReply = await getAIResponse(text);
    await bot.sendMessage(chatId, aiReply, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error("[TELEGRAM_FAIL] Failed to route signal:", err);
  }
});

// Function to handle messages for specific bots
const handleBotMessage = async (botToken: string, msg: any) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  console.log(`[BOT_${botToken.substring(0, 8)}] Incoming message from ChatID: ${chatId}`);

  if (text === '/start') {
    const botInstance = new TelegramBot(botToken, { polling: false });
    await botInstance.sendMessage(chatId, "🚀 *SwiftDeploy Bot Active.*\n\nAI Model: Gemini 3 Pro\nStatus: Operational\n\nSend a message to start chatting with AI.", { parse_mode: 'Markdown' });
    return;
  }

  try {
    const botInstance = new TelegramBot(botToken, { polling: false });
    await botInstance.sendChatAction(chatId, 'typing');
    const aiReply = await getAIResponse(text);
    await botInstance.sendMessage(chatId, aiReply, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error(`[BOT_${botToken.substring(0, 8)}_FAIL] Failed to route signal:`, err);
  }
};

/**
 * Webhook Ingestion Routes
 */
// Default webhook route (for backward compatibility)
app.post('/webhook', (req, res) => {
  console.log("[WEBHOOK] Received signal update from Telegram (default).");
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Bot-specific webhook routes
app.post('/webhook/:botId', (req, res) => {
  const { botId } = req.params;
  const botToken = botTokens.get(botId);
  
  if (!botToken) {
    console.error(`[WEBHOOK] No token found for bot ${botId}`);
    return res.status(404).json({ error: 'Bot not found' });
  }
  
  console.log(`[WEBHOOK] Received signal update for bot ${botId}`);
  
  // Process the update with the specific bot
  const botInstance = new TelegramBot(botToken, { polling: false });
  botInstance.processUpdate(req.body);
  
  // Handle the message
  if (req.body.message) {
    handleBotMessage(botToken, req.body.message);
  }
  
  res.sendStatus(200);
});

/**
 * Production Gateway Provisioning
 */
app.get('/set-webhook', async (req, res) => {
  const webhookUrl = `${BASE_URL}/webhook`;
  const registerUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook?url=${webhookUrl}`;
  
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
app.get('/get-webhook-info', async (req, res) => {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN;
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
app.post('/deploy-bot', requireAuth, async (req, res) => {
  const { botToken, botId } = req.body;
  
  if (!botToken || !botId) {
    return res.status(400).json({ error: 'Bot token and ID are required' });
  }
  
  console.log(`[DEPLOY] Deploying bot ${botId} with token ${botToken.substring(0, 10)}...`);
  
  try {
    // Store the bot token
    botTokens.set(botId, botToken);
    
    // Set webhook for the bot
    const webhookResult = await (global as any).setWebhookForBot(botToken, botId);
    
    if (webhookResult.success) {
      console.log(`[DEPLOY] Successfully deployed bot ${botId}`);
      res.json({
        success: true,
        message: 'Bot deployed successfully',
        botId,
        webhookUrl: `${BASE_URL}/webhook/${botId}`,
        telegramResponse: webhookResult.data
      });
    } else {
      // Remove the bot token if webhook setup failed
      botTokens.delete(botId);
      console.error(`[DEPLOY] Failed to deploy bot ${botId}:`, webhookResult.error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to set webhook', 
        details: webhookResult.error 
      });
    }
  } catch (error) {
    console.error(`[DEPLOY] Error deploying bot ${botId}:`, error);
    res.status(500).json({ 
      success: false, 
      error: 'Deployment failed', 
      details: (error as Error).message || 'Unknown error'
    });
  }
});

/**
 * Get deployed bots
 */
app.get('/bots', requireAuth, (req, res) => {
  const bots = Array.from(botTokens.entries()).map(([id, token]) => ({
    id,
    token: token.substring(0, 10) + '...' // Mask the token
  }));
  
  res.json({ bots });
});

/**
 * Email Verification Routes
 */

// Send verification email
app.post('/send-verification', async (req, res) => {
  const { email, name } = req.body;
  
  if (!email || !name) {
    return res.status(400).json({ error: 'Email and name are required' });
  }
  
  console.log(`[EMAIL] Request to send verification to ${email}`);
  
  try {
    const success = await sendVerificationEmail(email, name);
    
    if (success) {
      res.json({ 
        success: true, 
        message: 'Verification email sent successfully' 
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: 'Failed to send verification email' 
      });
    }
  } catch (error) {
    console.error(`[EMAIL] Error sending verification email:`, error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

// Verify email code
app.post('/verify-email', (req, res) => {
  const { email, code } = req.body;
  
  if (!email || !code) {
    return res.status(400).json({ error: 'Email and code are required' });
  }
  
  console.log(`[EMAIL] Verifying code for ${email}: ${code}`);
  
  const isValid = validateVerificationCode(email, code);
  
  if (isValid) {
    res.json({ 
      success: true, 
      message: 'Email verified successfully' 
    });
  } else {
    res.status(400).json({ 
      success: false, 
      error: 'Invalid or expired verification code' 
    });
  }
});

// Test email route
app.post('/test-email', async (req, res) => {
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
app.get('/pending-verifications', (req, res) => {
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
    // Successful authentication
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard`);
  }
);

// Get current user info
app.get('/me', (req, res) => {
  if (req.user) {
    res.json({ user: req.user });
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

// Example protected route - requires authentication
app.get('/dashboard/data', requireAuth, (req, res) => {
  res.json({ 
    message: 'Protected dashboard data', 
    user: req.user,
    timestamp: new Date().toISOString()
  });
});

// Log required environment variables at startup
console.log('=== Environment Variables Loaded ===');
console.log('PORT:', process.env.PORT || 8080);
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('BASE_URL:', BASE_URL);
console.log('FRONTEND_URL:', process.env.FRONTEND_URL);
console.log('TELEGRAM_BOT_TOKEN exists:', !!process.env.TELEGRAM_BOT_TOKEN);
console.log('API_KEY exists:', !!process.env.API_KEY);
console.log('GOOGLE_CLIENT_ID exists:', !!process.env.GOOGLE_CLIENT_ID);
console.log('GOOGLE_CLIENT_SECRET exists:', !!process.env.GOOGLE_CLIENT_SECRET);
console.log('===============================');

app.get('/', (req, res) => {
  res.status(200).send("SwiftDeploy backend is live");
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

app.listen(process.env.PORT || 8080, () => {
  console.log(`Server running on port ${process.env.PORT || 8080}`);
});
