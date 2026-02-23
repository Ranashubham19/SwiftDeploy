
export enum AIModel {
  OPENROUTER_FREE = 'openrouter/free'
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
  telegramUsername?: string;
  telegramLink?: string;
}
