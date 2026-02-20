import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

enum AIModel {
  GEMINI_3_FLASH = 'gemini-3-flash-preview',
  GEMINI_3_PRO = 'gemini-3-pro-preview'
}

type ChatHistory = { role: 'user' | 'model', parts: { text: string }[] }[];
type RetrievalDoc = { title: string; snippet: string; url?: string; source: string };
type IntentType = 'math' | 'current_event' | 'coding' | 'general';

const MAX_HISTORY_TURNS = 8;
const WEB_TIMEOUT_MS = 3500;
const WEB_MAX_SNIPPETS = 5;
const WEB_MAX_CHARS = 2500;
const STRICT_TEMPORAL_GROUNDING = (process.env.STRICT_TEMPORAL_GROUNDING || 'true').toLowerCase() !== 'false';
const ALWAYS_WEB_RETRIEVAL = (process.env.ALWAYS_WEB_RETRIEVAL || 'false').toLowerCase() !== 'false';
const RETRIEVAL_CACHE_TTL_MS = 5 * 60 * 1000;
const RETRIEVAL_MAX_QUERIES = 2;
const retrievalCache = new Map<string, { docs: RetrievalDoc[]; expiresAt: number }>();
const MODEL_TEMPERATURE = 0.2;
const MODEL_TOP_P = 0.8;
const MODEL_MAX_TOKENS = 1000;

const REALTIME_KEYWORDS = ["2024", "2025", "2026", "today", "now", "current", "latest", "right now"];

export const needsRealtimeSearch = (userMessage: string): boolean => {
  const msg = String(userMessage || '').toLowerCase();
  return REALTIME_KEYWORDS.some((k) => msg.includes(k));
};

const detectIntent = (text: string): IntentType => {
  const q = String(text || '').toLowerCase();
  if (/(^|\s)(solve|calculate|what is|evaluate)\s+[-+*/().\d\s]{3,}$/.test(q) || /[-+*/()]/.test(q) && /\d/.test(q) && q.length < 100) {
    return 'math';
  }
  if (/(code|bug|typescript|javascript|python|sql|regex|api|function|class|compile|error|stack trace)/.test(q)) {
    return 'coding';
  }
  if (needsRealtimeSearch(q) || /(news|election|gdp|stock|price|market|who is|as of)/.test(q)) {
    return 'current_event';
  }
  return 'general';
};

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

const needsLiveFacts = (text: string): boolean => {
  const q = text.toLowerCase();
  return /(latest|today|current|recent|now|as of|202[4-9]|price|market cap|gdp|revenue|stock|rank|top|news|update|who is|what is)/.test(q);
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
      - For temporal/market/economic answers, include:
        1) "As of" date,
        2) core figures,
        3) short assumptions,
        4) a brief "Sources used" section from provided context.
    `
    : '';

  const intent = detectIntent(prompt);
  const structureBlock = `
For factual questions, use this format:
### Direct Answer
[Short answer]

### Explanation
[Brief explanation]

### Source Context
[Only if real-time data was used]
`;

  return `
You are a professional AI assistant.

Rules:
- Always give clear, structured answers.
- If question involves current events, latest data, or specific year beyond training knowledge, indicate that live verification may be required.
- Do not fabricate facts.
- If unsure, say: "I do not have enough verified information."
- Keep responses accurate and concise.
- Use step-by-step reasoning when needed.
- Avoid unnecessary fluff.
- If user asks about year like 2024, 2025, 2026, treat it as time-sensitive.
- Route behavior by intent:
  - math: be exact, show steps briefly.
  - coding: provide practical, executable guidance.
  - current_event: prioritize verified fresh context.
  - general: concise and factual.
- Active intent: ${intent}
${structureBlock}
${temporalHint}
${customInstruction || ''}
  `.trim();
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs))
  ]);
};

const stripHtml = (input: string): string => {
  return input
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
};

const fetchDuckDuckGoContext = async (query: string): Promise<RetrievalDoc[]> => {
  const encoded = encodeURIComponent(query);
  const url = `https://duckduckgo.com/html/?q=${encoded}`;
  const response = await withTimeout(fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; SwiftDeployBot/1.0)'
    }
  }), WEB_TIMEOUT_MS);
  if (!response.ok) return [];
  const html = await response.text();
  const resultBlocks = html.match(/<div[^>]*class="[^"]*result[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>/g) || [];
  const snippets: RetrievalDoc[] = [];
  for (const block of resultBlocks.slice(0, WEB_MAX_SNIPPETS * 2)) {
    const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/);
    const hrefMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"/);
    const snippetMatch = block.match(/<[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/);
    const title = stripHtml(titleMatch?.[1] || '');
    const href = stripHtml(hrefMatch?.[1] || '');
    const snippet = stripHtml(snippetMatch?.[1] || '');
    if (title || snippet) snippets.push({ title, snippet, url: href, source: 'duckduckgo' });
    if (snippets.length >= WEB_MAX_SNIPPETS) break;
  }
  return snippets;
};

const fetchWikipediaContext = async (query: string): Promise<RetrievalDoc[]> => {
  const encoded = encodeURIComponent(query);
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encoded}&utf8=1&format=json&srlimit=${WEB_MAX_SNIPPETS}`;
  const response = await withTimeout(fetch(url), WEB_TIMEOUT_MS);
  if (!response.ok) return [];
  const data: any = await response.json().catch(() => ({}));
  const results = Array.isArray(data?.query?.search) ? data.query.search : [];
  return results
    .slice(0, WEB_MAX_SNIPPETS)
    .map((r: any) => ({
      title: stripHtml(r?.title || ''),
      snippet: stripHtml(r?.snippet || ''),
      url: r?.pageid ? `https://en.wikipedia.org/?curid=${r.pageid}` : '',
      source: 'wikipedia'
    }))
    .filter((x: RetrievalDoc) => Boolean(x.title || x.snippet));
};

const fetchSerperContext = async (query: string): Promise<RetrievalDoc[]> => {
  const key = (process.env.SERPER_API_KEY || '').trim();
  if (!key) return [];
  const response = await withTimeout(fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ q: query, num: WEB_MAX_SNIPPETS })
  }), WEB_TIMEOUT_MS);
  if (!response.ok) return [];
  const data: any = await response.json().catch(() => ({}));
  const organic = Array.isArray(data?.organic) ? data.organic : [];
  return organic.slice(0, WEB_MAX_SNIPPETS).map((r: any) => ({
    title: stripHtml(r?.title || ''),
    snippet: stripHtml(r?.snippet || ''),
    url: stripHtml(r?.link || ''),
    source: 'serper'
  })).filter((x: RetrievalDoc) => Boolean(x.title || x.snippet));
};

const buildSearchQueries = (prompt: string): string[] => {
  const base = prompt.trim();
  const year = new Date().getUTCFullYear();
  const variants = [
    base,
    `${base} latest ${year}`
  ].map((x) => x.trim()).filter(Boolean);
  return Array.from(new Set(variants)).slice(0, RETRIEVAL_MAX_QUERIES);
};

const rankDocs = (docs: RetrievalDoc[], prompt: string): RetrievalDoc[] => {
  const tokens = prompt.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 3);
  const scored = docs.map((d) => {
    const text = `${d.title} ${d.snippet}`.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (text.includes(t)) score += 1;
    }
    if (/\b20(2[4-9]|3[0-9])\b/.test(text)) score += 2;
    return { d, score };
  });
  return scored
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.d);
};

const buildWebGrounding = async (prompt: string): Promise<string> => {
  const enabled = (process.env.LIVE_GROUNDING_ENABLED || 'true').toLowerCase() !== 'false';
  const shouldRetrieve = needsRealtimeSearch(prompt) || ALWAYS_WEB_RETRIEVAL || needsLiveFacts(prompt);
  if (!enabled || !shouldRetrieve) return '';

  const cacheKey = prompt.trim().toLowerCase();
  const cached = retrievalCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    const nowIso = new Date().toISOString();
    const cachedBody = cached.docs.map((d) => `${d.title}: ${d.snippet}${d.url ? ` (${d.url})` : ''} [${d.source}]`).join('\n- ');
    return `\nLive context retrieved at ${nowIso}:\n- ${cachedBody}`.slice(0, WEB_MAX_CHARS);
  }

  try {
    const queries = buildSearchQueries(prompt);
    const allDocs: RetrievalDoc[] = [];
    for (const q of queries) {
      const [duck, wiki, serper] = await Promise.all([
        fetchDuckDuckGoContext(q).catch(() => []),
        fetchWikipediaContext(q).catch(() => []),
        fetchSerperContext(q).catch(() => [])
      ]);
      allDocs.push(...duck, ...wiki, ...serper);
    }
    const dedupMap = new Map<string, RetrievalDoc>();
    for (const doc of allDocs) {
      const key = `${doc.title}|${doc.snippet}`.toLowerCase();
      if (!dedupMap.has(key)) dedupMap.set(key, doc);
    }
    const ranked = rankDocs(Array.from(dedupMap.values()), prompt).slice(0, WEB_MAX_SNIPPETS);
    if (!ranked.length) return '';
    retrievalCache.set(cacheKey, { docs: ranked, expiresAt: Date.now() + RETRIEVAL_CACHE_TTL_MS });
    const nowIso = new Date().toISOString();
    const body = ranked.map((d) => `${d.title}: ${d.snippet}${d.url ? ` (${d.url})` : ''} [${d.source}]`).join('\n- ');
    return `\nLive context retrieved at ${nowIso}:\n- ${body}`.slice(0, WEB_MAX_CHARS);
  } catch {
    return '';
  }
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
    temperature: MODEL_TEMPERATURE,
    top_p: MODEL_TOP_P,
    max_tokens: MODEL_MAX_TOKENS
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
    temperature: MODEL_TEMPERATURE,
    top_p: MODEL_TOP_P,
    max_tokens: MODEL_MAX_TOKENS
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
      max_tokens: MODEL_MAX_TOKENS,
      temperature: MODEL_TEMPERATURE,
      top_p: MODEL_TOP_P,
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
    temperature: MODEL_TEMPERATURE,
    top_p: MODEL_TOP_P,
    max_tokens: MODEL_MAX_TOKENS
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
          temperature: MODEL_TEMPERATURE,
          top_p: MODEL_TOP_P,
          max_tokens: MODEL_MAX_TOKENS
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
    const liveGrounding = await buildWebGrounding(sanitizedPrompt);
    if (STRICT_TEMPORAL_GROUNDING && isTemporalQuery(sanitizedPrompt) && !liveGrounding) {
      throw new Error('LIVE_CONTEXT_UNAVAILABLE');
    }
    const groundedPrompt = liveGrounding
      ? `${sanitizedPrompt}\n\nUse this fresh web context when relevant and mention uncertainty when sources conflict.${liveGrounding}`
      : sanitizedPrompt;

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
          return await callSarvam(groundedPrompt, compactHistory, adaptiveInstruction);
        }
        if (provider === 'openrouter') {
          return await callOpenRouter(groundedPrompt, compactHistory, adaptiveInstruction);
        }
        if (provider === 'moonshot') {
          return await callMoonshot(groundedPrompt, compactHistory, adaptiveInstruction);
        }
        if (provider === 'openai') {
          return await callOpenAI(groundedPrompt, compactHistory, adaptiveInstruction);
        }
        if (provider === 'anthropic') {
          return await callAnthropic(groundedPrompt, compactHistory, adaptiveInstruction);
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
            { role: 'user', parts: [{ text: groundedPrompt }] }
          ],
          config: {
            systemInstruction: adaptiveInstruction,
            temperature: MODEL_TEMPERATURE,
            topP: MODEL_TOP_P,
            maxOutputTokens: MODEL_MAX_TOKENS,
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
      if (error.message.includes('LIVE_CONTEXT_UNAVAILABLE')) {
        throw new Error('LIVE_CONTEXT_UNAVAILABLE');
      }
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
