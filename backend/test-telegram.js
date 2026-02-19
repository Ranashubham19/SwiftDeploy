import TelegramBot from 'node-telegram-bot-api';
import 'dotenv/config';

// Test your Telegram bot token
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is required in environment variables.');
}
const bot = new TelegramBot(token, { polling: false });

console.log('Testing Telegram bot token...');

bot.getMe()
  .then((botInfo) => {
    console.log('✅ Bot token is valid!');
    console.log('Bot Info:', botInfo);
  })
  .catch((error) => {
    console.log('❌ Bot token is invalid or there was an error:');
    console.log('Error:', error.message);
  });
