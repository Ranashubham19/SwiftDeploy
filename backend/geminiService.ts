import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

enum AIModel {
  GEMINI_3_FLASH = 'gemini-3-flash-preview',
  GEMINI_3_PRO = 'gemini-3-pro-preview'
}

type ChatHistory = { role: 'user' | 'model', parts: { text: string }[] }[];

const MAX_HISTORY_TURNS = 8;

const getSarvamKeys = (): string[] => {
  const fromList = (process.env.SARVAM_API_KEYS || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  const single = (process.env.SARVAM_API_KEY || '').trim();
  const aliases = [
    (process.env.SARVAM_API_KEY_1 || '').trim(),
    (process.env.SARVAM_API_KEY_2 || '').trim(),
    (process.env.SARVAM_API_KEY_3 || '').trim()
  ].filter(Boolean);
  return Array.from(new Set([...fromList, ...(single ? [single] : []), ...aliases]));
};

const getGeminiApiKey = (): string => {
  const raw = (process.env.GEMINI_API_KEY || '').trim();
  if (!raw) return '';
  // Guard against non-Gemini keys accidentally placed in GEMINI_API_KEY (e.g. sk_...).
  if (!raw.startsWith('AIza')) return '';
  return raw;
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

const trimHistory = (history: ChatHistory): ChatHistory => {
  if (!Array.isArray(history) || history.length <= MAX_HISTORY_TURNS) return history;
  return history.slice(-MAX_HISTORY_TURNS);
};

const isTemporalQuery = (text: string): boolean => {
  const q = text.toLowerCase();
  return /(latest|today|current|recent|now|this year|202[4-9]|forecast|estimate|prediction|market|price|revenue|gdp|election|news)/.test(q);
};

const isReasoningHeavyQuery = (text: string): boolean => {
  const q = text.toLowerCase();
  return /(why|how|compare|tradeoff|strategy|architecture|math|calculate|proof|optimi[sz]e|plan|roadmap|estimate)/.test(q);
};

const buildAdaptiveInstruction = (prompt: string, customInstruction?: string): string => {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const temporalHint = isTemporalQuery(prompt)
    ? `
      Temporal accuracy rules:
      - Treat today's date as ${today}.
      - If the user asks about 2026 (or another year), do NOT substitute 2023/2024.
      - If real-time verification is required and unavailable, explicitly say so and provide a best-effort estimate with assumptions.
      - Never present uncertain facts as certain.
    `
    : '';

  return `
    You are SwiftDeploy AI, a high-accuracy assistant for production bot users.
    Core response rules:
    - Give direct, correct, and practical answers.
    - Show key assumptions before conclusions for estimates.
    - Prefer structured answers with short bullets and clear numbers.
    - If confidence is low, say what is unknown and what data is needed.
    - Keep output concise but complete.
    ${temporalHint}
    ${customInstruction || ''}
  `;
};

const getProviderOrder = (preferredProvider: string, prompt: string): string[] => {
  const temporal = isTemporalQuery(prompt);
  const reasoningHeavy = isReasoningHeavyQuery(prompt);

  if (temporal || reasoningHeavy) {
    if (preferredProvider === 'moonshot') return ['moonshot', 'openai', 'anthropic', 'openrouter', 'sarvam', 'gemini'];
    if (preferredProvider === 'openai') return ['openai', 'anthropic', 'openrouter', 'sarvam', 'gemini'];
    if (preferredProvider === 'anthropic') return ['anthropic', 'openai', 'openrouter', 'sarvam', 'gemini'];
    if (preferredProvider === 'gemini') return ['gemini', 'openai', 'anthropic', 'openrouter', 'sarvam'];
    if (preferredProvider === 'sarvam') return ['openai', 'anthropic', 'openrouter', 'sarvam', 'gemini'];
    return ['moonshot', 'openrouter', 'openai', 'anthropic', 'sarvam', 'gemini'];
  }

  if (preferredProvider === 'moonshot') return ['moonshot', 'openrouter', 'openai', 'anthropic', 'sarvam', 'gemini'];
  if (preferredProvider === 'sarvam') return ['sarvam', 'openrouter', 'openai', 'anthropic', 'gemini'];
  if (preferredProvider === 'anthropic') return ['anthropic', 'openrouter', 'openai', 'sarvam', 'gemini'];
  if (preferredProvider === 'gemini') return ['gemini', 'openrouter', 'openai', 'anthropic', 'sarvam'];
  if (preferredProvider === 'openai') return ['openai', 'openrouter', 'anthropic', 'sarvam', 'gemini'];
  return ['moonshot', 'openrouter', 'openai', 'anthropic', 'sarvam', 'gemini'];
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

const callMoonshot = async (prompt: string, history: ChatHistory, systemInstruction?: string): Promise<string> => {
  const apiKey = (process.env.MOONSHOT_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('MOONSHOT_KEY_MISSING');
  }

  const model = (process.env.MOONSHOT_MODEL || 'kimi-k2-0905-preview').trim();
  const historyText = extractHistoryText(history);
  const baseUrl = (process.env.MOONSHOT_BASE_URL || 'https://api.moonshot.ai/v1/chat/completions').trim();
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
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data: any = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || data?.message || 'Moonshot request failed';
    throw new Error(`MOONSHOT_ERROR: ${message}`);
  }

  const text = data?.choices?.[0]?.message?.content;
  if (!text || typeof text !== 'string') {
    throw new Error('MOONSHOT_EMPTY_RESPONSE');
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
    const compactHistory = trimHistory(history);
    const adaptiveInstruction = buildAdaptiveInstruction(sanitizedPrompt, systemInstruction);

    const hasSarvam = getSarvamKeys().length > 0;
    const hasMoonshot = Boolean((process.env.MOONSHOT_API_KEY || '').trim());
    const hasOpenAI = Boolean((process.env.OPENAI_API_KEY || '').trim());
    const hasOpenRouter = Boolean((process.env.OPENROUTER_API_KEY || '').trim());
    const explicitProvider = (process.env.AI_PROVIDER || '').trim().toLowerCase();
    const preferredProvider =
      explicitProvider
      || (hasMoonshot ? 'moonshot' : hasOpenAI ? 'openai' : hasSarvam ? 'sarvam' : hasOpenRouter ? 'openrouter' : 'gemini');
    const providers = getProviderOrder(preferredProvider, sanitizedPrompt);

    let lastError: Error | null = null;
    for (const provider of providers) {
      try {
        if (provider === 'sarvam') {
          return await callSarvam(sanitizedPrompt, compactHistory, adaptiveInstruction);
        }
        if (provider === 'openrouter') {
          return await callOpenRouter(sanitizedPrompt, compactHistory, adaptiveInstruction);
        }
        if (provider === 'moonshot') {
          return await callMoonshot(sanitizedPrompt, compactHistory, adaptiveInstruction);
        }
        if (provider === 'openai') {
          return await callOpenAI(sanitizedPrompt, compactHistory, adaptiveInstruction);
        }
        if (provider === 'anthropic') {
          return await callAnthropic(sanitizedPrompt, compactHistory, adaptiveInstruction);
        }

        const geminiKey = getGeminiApiKey();
        if (!geminiKey) {
          throw new Error("NEURAL_LINK_FAILED: GEMINI_KEY_MISSING");
        }
        const ai = new GoogleGenAI({ apiKey: geminiKey });
        const modelName = model === AIModel.GEMINI_3_FLASH ? 'gemini-3-flash-preview' : 'gemini-3-pro-preview';
        const response: GenerateContentResponse = await ai.models.generateContent({
          model: modelName,
          contents: [
            ...compactHistory,
            { role: 'user', parts: [{ text: sanitizedPrompt }] }
          ],
          config: {
            systemInstruction: adaptiveInstruction,
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
      if (error.message.includes('GEMINI_KEY') || error.message.includes('OPENROUTER') || error.message.includes('MOONSHOT')) {
        throw new Error("INVALID_PROVIDER_KEY: Please check your AI provider API configuration");
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
