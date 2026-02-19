import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

enum AIModel {
  GEMINI_3_FLASH = 'gemini-3-flash-preview',
  GEMINI_3_PRO = 'gemini-3-pro-preview'
}

type ChatHistory = { role: 'user' | 'model', parts: { text: string }[] }[];

const getSarvamKeys = (): string[] => {
  const fromList = (process.env.SARVAM_API_KEYS || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  const single = (process.env.SARVAM_API_KEY || '').trim();
  return Array.from(new Set([...fromList, ...(single ? [single] : [])]));
};

const extractHistoryText = (history: ChatHistory): string => {
  if (!history?.length) return '';
  return history
    .map((entry) => {
      const text = entry.parts?.map((p) => p.text).join(' ').trim();
      if (!text) return '';
      return `${entry.role === 'model' ? 'Assistant' : 'User'}: ${text}`;
    })
    .filter(Boolean)
    .join('\n');
};

const callOpenAI = async (prompt: string, history: ChatHistory, systemInstruction?: string): Promise<string> => {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY_MISSING');
  }

  const model = (process.env.OPENAI_MODEL || 'gpt-5.2').trim();
  const historyText = extractHistoryText(history);
  const body = {
    model,
    messages: [
      ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
      ...(historyText ? [{ role: 'system', content: `Conversation context:\n${historyText}` }] : []),
      { role: 'user', content: prompt }
    ],
    temperature: 0.2,
    max_tokens: 480
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data: any = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || 'OpenAI request failed';
    throw new Error(`OPENAI_ERROR: ${message}`);
  }

  const text = data?.choices?.[0]?.message?.content;
  if (!text || typeof text !== 'string') {
    throw new Error('OPENAI_EMPTY_RESPONSE');
  }
  return text.trim();
};

const callAnthropic = async (prompt: string, history: ChatHistory, systemInstruction?: string): Promise<string> => {
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY_MISSING');
  }

  const model = (process.env.ANTHROPIC_MODEL || 'claude-opus-4-5').trim();
  const historyText = extractHistoryText(history);
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: 480,
      temperature: 0.2,
      system: [systemInstruction, historyText ? `Conversation context:\n${historyText}` : ''].filter(Boolean).join('\n\n'),
      messages: [
        { role: 'user', content: prompt }
      ]
    })
  });

  const data: any = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || 'Anthropic request failed';
    throw new Error(`ANTHROPIC_ERROR: ${message}`);
  }

  const text = data?.content?.find((c: any) => c?.type === 'text')?.text;
  if (!text || typeof text !== 'string') {
    throw new Error('ANTHROPIC_EMPTY_RESPONSE');
  }
  return text.trim();
};

const callOpenRouter = async (prompt: string, history: ChatHistory, systemInstruction?: string): Promise<string> => {
  const apiKey = (process.env.OPENROUTER_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY_MISSING');
  }

  const model = (process.env.OPENROUTER_MODEL || 'moonshotai/kimi-k2').trim();
  const historyText = extractHistoryText(history);
  const baseUrl = (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1/chat/completions').trim();
  const referer = (process.env.FRONTEND_URL || process.env.BASE_URL || '').trim();

  const body = {
    model,
    messages: [
      ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
      ...(historyText ? [{ role: 'system', content: `Conversation context:\n${historyText}` }] : []),
      { role: 'user', content: prompt }
    ],
    temperature: 0.2,
    max_tokens: 600
  };

  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(referer ? { 'HTTP-Referer': referer } : {}),
      'X-Title': 'SwiftDeploy AI'
    },
    body: JSON.stringify(body)
  });

  const data: any = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || data?.message || 'OpenRouter request failed';
    throw new Error(`OPENROUTER_ERROR: ${message}`);
  }

  const text = data?.choices?.[0]?.message?.content;
  if (!text || typeof text !== 'string') {
    throw new Error('OPENROUTER_EMPTY_RESPONSE');
  }
  return text.trim();
};

const callSarvam = async (prompt: string, history: ChatHistory, systemInstruction?: string): Promise<string> => {
  const keys = getSarvamKeys();
  if (!keys.length) {
    throw new Error('SARVAM_API_KEY_MISSING');
  }

  const model = (process.env.SARVAM_MODEL || 'sarvam-m').trim();
  const historyText = extractHistoryText(history);
  const baseUrl = (process.env.SARVAM_BASE_URL || 'https://api.sarvam.ai/v1/chat/completions').trim();

  let lastError: Error | null = null;

  for (const key of keys) {
    try {
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          // Sarvam docs use `api-subscription-key` for auth.
          // Keep Authorization as secondary compatibility header.
          'api-subscription-key': key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages: [
            ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
            ...(historyText ? [{ role: 'system', content: `Conversation context:\n${historyText}` }] : []),
            { role: 'user', content: prompt }
          ],
          temperature: 0.2,
          max_tokens: 600
        })
      });

      const data: any = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = data?.error?.message || data?.message || `Sarvam request failed (${response.status})`;
        throw new Error(`SARVAM_ERROR: ${message}`);
      }

      const text =
        data?.choices?.[0]?.message?.content
        || data?.choices?.[0]?.text
        || data?.output_text
        || data?.response;
      if (!text || typeof text !== 'string') {
        throw new Error('SARVAM_EMPTY_RESPONSE');
      }
      return text.trim();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError || new Error('SARVAM_ROUTING_FAILED');
};

/**
 * Backend Gemini Service for Telegram Bot
 * Compliant with @google/genai version 1.41.0
 */
export const generateBotResponse = async (
  prompt: string, 
  model: AIModel = AIModel.GEMINI_3_FLASH, 
  history: ChatHistory = [],
  systemInstruction?: string
): Promise<string> => {
  try {
    const sanitizedPrompt = prompt.trim();

    // Professional AI writing style instructions
    const professionalStyle = `
      You are SwiftDeploy AI, a helpful assistant. 
      Provide clear, concise, and accurate responses.
      - Keep responses professional and helpful
      - Use clear formatting
      - Be direct and informative
    `;

    const hasSarvam = getSarvamKeys().length > 0;
    const preferredProvider = (process.env.AI_PROVIDER || (hasSarvam ? 'sarvam' : 'openrouter')).trim().toLowerCase();
    const providers = preferredProvider === 'sarvam'
      ? ['sarvam', 'openrouter', 'openai', 'anthropic', 'gemini']
      : preferredProvider === 'anthropic'
      ? ['anthropic', 'openrouter', 'openai', 'sarvam', 'gemini']
      : preferredProvider === 'gemini'
        ? ['gemini', 'openrouter', 'openai', 'anthropic', 'sarvam']
        : preferredProvider === 'openai'
          ? ['openai', 'openrouter', 'anthropic', 'sarvam', 'gemini']
          : ['openrouter', 'openai', 'anthropic', 'sarvam', 'gemini'];

    let lastError: Error | null = null;
    for (const provider of providers) {
      try {
        if (provider === 'sarvam') {
          return await callSarvam(sanitizedPrompt, history, systemInstruction || professionalStyle);
        }
        if (provider === 'openrouter') {
          return await callOpenRouter(sanitizedPrompt, history, systemInstruction || professionalStyle);
        }
        if (provider === 'openai') {
          return await callOpenAI(sanitizedPrompt, history, systemInstruction || professionalStyle);
        }
        if (provider === 'anthropic') {
          return await callAnthropic(sanitizedPrompt, history, systemInstruction || professionalStyle);
        }

        const geminiKey = (process.env.API_KEY || '').trim();
        if (!geminiKey) {
          throw new Error("NEURAL_LINK_FAILED: API_KEY_MISSING");
        }
        const ai = new GoogleGenAI({ apiKey: geminiKey });
        const modelName = model === AIModel.GEMINI_3_FLASH ? 'gemini-3-flash-preview' : 'gemini-3-pro-preview';
        const response: GenerateContentResponse = await ai.models.generateContent({
          model: modelName,
          contents: [
            ...history,
            { role: 'user', parts: [{ text: sanitizedPrompt }] }
          ],
          config: {
            systemInstruction: systemInstruction || professionalStyle,
            temperature: 0.2,
            maxOutputTokens: 480,
            thinkingConfig: { thinkingBudget: 0 }
          }
        });

        return response.text || "No response generated.";
      } catch (providerError) {
        lastError = providerError instanceof Error ? providerError : new Error(String(providerError));
      }
    }

    throw lastError || new Error('AI provider routing failed');
  } catch (error) {
    console.error("Backend AI Core Error:", error);
    
    // Enhanced error handling with specific error types
    if (error instanceof Error) {
      if (error.message.includes('API_KEY') || error.message.includes('OPENROUTER')) {
        throw new Error("INVALID_API_KEY: Please check your AI provider API configuration");
      } else if (error.message.includes('quota') || error.message.includes('rate')) {
        throw new Error("RATE_LIMIT_EXCEEDED: Please try again in a few moments");
      } else if (error.message.includes('network') || error.message.includes('fetch')) {
        throw new Error("NETWORK_ERROR: Unable to connect to AI service");
      }
    }
    
    throw new Error(`AI_GENERATION_FAILED: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

export const estimateTokens = (text: string): number => {
  return Math.ceil(text.length / 4);
};
