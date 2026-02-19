import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  Events,
  SlashCommandStringOption,
  Interaction
} from 'discord.js';
import { GoogleGenAI } from '@google/genai';

const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '..', '.env')
];

for (const candidate of envCandidates) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
  }
}

const DISCORD_TOKEN = (process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || '').trim();
const DISCORD_CLIENT_ID = (process.env.DISCORD_CLIENT_ID || process.env.DISCORD_APPLICATION_ID || '').trim();
const DISCORD_GUILD_ID = (process.env.DISCORD_GUILD_ID || '').trim();
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || process.env.API_KEY || '').trim();
const GEMINI_MODEL = (process.env.GEMINI_MODEL || 'gemini-3-flash-preview').trim();

const log = (...args: unknown[]) => console.log('[DISCORD_BOT]', ...args);
const logErr = (...args: unknown[]) => console.error('[DISCORD_BOT][ERROR]', ...args);

if (!DISCORD_TOKEN) {
  logErr('DISCORD_TOKEN is missing. Set DISCORD_TOKEN in your env file.');
  process.exit(1);
}
if (!DISCORD_CLIENT_ID) {
  logErr('DISCORD_CLIENT_ID is missing. Set DISCORD_CLIENT_ID in your env file.');
  process.exit(1);
}
if (!GEMINI_API_KEY) {
  logErr('GEMINI_API_KEY (or API_KEY) is missing. Set your Gemini key in env.');
  process.exit(1);
}

const gemini = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const commands = [
  new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask SwiftDeploy AI a question')
    .addStringOption((option: SlashCommandStringOption) =>
      option
        .setName('question')
        .setDescription('Your question for SwiftDeploy AI')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check if bot is online')
].map((command) => command.toJSON());

const registerSlashCommands = async () => {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  if (DISCORD_GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID),
      { body: commands }
    );
    log(`Slash commands registered for guild ${DISCORD_GUILD_ID}`);
    return;
  }

  await rest.put(
    Routes.applicationCommands(DISCORD_CLIENT_ID),
    { body: commands }
  );
  log('Slash commands registered globally (can take a few minutes to appear).');
};

const generateGeminiReply = async (prompt: string): Promise<string> => {
  const systemInstruction =
    'You are SwiftDeploy AI assistant. Reply professionally, accurately, and clearly. Keep answers concise unless detail is requested.';
  const response = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      systemInstruction,
      temperature: 0.2,
      maxOutputTokens: 500,
      thinkingConfig: { thinkingBudget: 0 }
    }
  });
  return (response.text || 'No response generated.').trim();
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once(Events.ClientReady, async (readyClient: Client<true>) => {
  log(`Bot is online as ${readyClient.user.tag}`);
  try {
    await registerSlashCommands();
  } catch (error) {
    logErr('Slash command registration failed:', error);
  }
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'ping') {
    await interaction.reply({ content: 'Pong. SwiftDeploy Discord node is online.' });
    return;
  }

  if (interaction.commandName === 'ask') {
    await handleAsk(interaction);
  }
});

const handleAsk = async (interaction: ChatInputCommandInteraction) => {
  const question = interaction.options.getString('question', true).trim();
  if (!question) {
    await interaction.reply({ content: 'Please enter a valid question.' });
    return;
  }

  try {
    await interaction.deferReply();
    const answer = await generateGeminiReply(question);
    if (answer.length <= 1990) {
      await interaction.editReply(answer);
      return;
    }

    const chunks = answer.match(/[\s\S]{1,1900}/g) || [];
    await interaction.editReply(chunks[0] || 'No response generated.');
    for (let i = 1; i < chunks.length; i += 1) {
      await interaction.followUp(chunks[i]);
    }
  } catch (error) {
    logErr('Failed to handle /ask:', error);
    const message = 'AI request failed. Check GEMINI_API_KEY, model access, and bot logs.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message);
    } else {
      await interaction.reply({ content: message, ephemeral: true });
    }
  }
};

client.on(Events.Warn, (warning: string) => log('WARN:', warning));
client.on(Events.Error, (error: Error) => logErr('Client error:', error));
client.on(Events.ShardError, (error: Error) => logErr('Shard error:', error));
client.on(Events.Invalidated, () => logErr('Session invalidated.'));

process.on('unhandledRejection', (reason) => {
  logErr('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (error) => {
  logErr('Uncaught exception:', error);
});

log('Starting Discord bot...');
log('Env check:', {
  hasDiscordToken: Boolean(DISCORD_TOKEN),
  hasDiscordClientId: Boolean(DISCORD_CLIENT_ID),
  hasGeminiKey: Boolean(GEMINI_API_KEY),
  geminiModel: GEMINI_MODEL,
  guildScopedCommands: Boolean(DISCORD_GUILD_ID)
});

client.login(DISCORD_TOKEN)
  .then(() => log('Discord login successful.'))
  .catch((error: unknown) => {
    logErr('Discord login failed. Check DISCORD_TOKEN and bot permissions.', error);
    process.exit(1);
  });
