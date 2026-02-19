import TelegramBot from 'node-telegram-bot-api';
import 'dotenv/config';

// Simple test bot with basic responses
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is required in environment variables.');
}
const bot = new TelegramBot(token, { polling: true });

console.log('Bot started...');

// Simple response patterns
const responses = {
  hello: "Hello there! How can I help you today?",
  hi: "Hi! I'm your AI assistant. What would you like to chat about?",
  how: "I'm doing well, thank you for asking! How can I assist you?",
  what: "I'm an AI assistant here to help answer your questions!",
  who: "I'm your friendly AI assistant, here to chat with you!",
  when: "I'm available anytime you need help!",
  where: "I'm here in this chat, ready to assist you!",
  why: "I exist to help make your life easier through conversation!",
  default: "Hello! I'm your AI assistant. I'm still learning, but I'm here to help! Ask me anything."
};

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || '').toLowerCase();
  
  console.log(`Received: ${text} from ${msg.from?.username || 'Unknown'}`);
  
  try {
    let reply = responses.default;
    
    // Simple keyword matching
    if (text.includes('hello') || text.includes('hi')) {
      reply = responses.hello;
    } else if (text.includes('how')) {
      reply = responses.how;
    } else if (text.includes('what')) {
      reply = responses.what;
    } else if (text.includes('who')) {
      reply = responses.who;
    } else if (text.includes('when')) {
      reply = responses.when;
    } else if (text.includes('where')) {
      reply = responses.where;
    } else if (text.includes('why')) {
      reply = responses.why;
    }
    
    console.log(`Replying: ${reply}`);
    await bot.sendMessage(chatId, reply);
  } catch (error) {
    console.error('Error:', error);
    await bot.sendMessage(chatId, "Hello! I'm your AI assistant. I'm here to help!");
  }
});
