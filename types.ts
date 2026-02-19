
export enum AIModel {
  CLAUDE_OPUS_4_5 = 'claude-opus-4-5',
  GPT_5_2 = 'gpt-5-2',
  GEMINI_3_FLASH = 'gemini-3-flash-preview',
  GEMINI_3_PRO = 'gemini-3-pro-preview'
}

export enum Platform {
  TELEGRAM = 'TELEGRAM',
  DISCORD = 'DISCORD',
  WHATSAPP = 'WHATSAPP',
  INSTAGRAM = 'INSTAGRAM'
}

export enum BotStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  ERROR = 'ERROR'
}

export interface User {
  id: string;
  email: string;
  name: string;
  plan: 'FREE' | 'PRO_MONTHLY' | 'PRO_YEARLY' | 'CUSTOM';
  isSubscribed: boolean;
}

export interface Bot {
  id: string;
  name: string;
  platform: Platform;
  token: string;
  model: AIModel;
  status: BotStatus;
  messageCount: number;
  tokenUsage: number;
  lastActive: string;
  memoryEnabled: boolean;
  webhookUrl?: string;
}
