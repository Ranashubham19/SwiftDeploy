type ChatHistory = { role: 'user' | 'model'; parts: { text: string }[] }[];
type RetrievalDoc = { title: string; snippet: string; url?: string; source: string };
type IntentType = 'math' | 'current_event' | 'coding' | 'general';

export type AIRuntimeConfig = { provider?: string; model?: string; forceProvider?: boolean };

const FAST_REPLY_MODE = (process.env.FAST_REPLY_MODE || 'false').trim().toLowerCase() !== 'false';
const WEB_TIMEOUT_MS = parseInt(process.env.WEB_TIMEOUT_MS || (FAST_REPLY_MODE ? '1800' : '3500'), 10);
const WEB_MAX_SNIPPETS = parseInt(process.env.WEB_MAX_SNIPPETS || (FAST_REPLY_MODE ? '3' : '5'), 10);
const WEB_MAX_CHARS = 2500;
const STRICT_TEMPORAL_GROUNDING = (process.env.STRICT_TEMPORAL_GROUNDING || 'false').toLowerCase() !== 'false';
const ALWAYS_WEB_RETRIEVAL = (process.env.ALWAYS_WEB_RETRIEVAL || 'false').toLowerCase() !== 'false';
const RETRIEVAL_CACHE_TTL_MS = 5 * 60 * 1000;
const RETRIEVAL_MAX_QUERIES = parseInt(process.env.RETRIEVAL_MAX_QUERIES || (FAST_REPLY_MODE ? '1' : '2'), 10);
const retrievalCache = new Map<string, { docs: RetrievalDoc[]; expiresAt: number }>();
const MODEL_TEMPERATURE = parseFloat(process.env.AI_TEMPERATURE || '0.25');
const MODEL_TOP_P = 0.8;
const MODEL_MAX_TOKENS = Math.max(1200, parseInt(process.env.AI_MAX_TOKENS || (FAST_REPLY_MODE ? '1200' : '1800'), 10));
const HISTORY_TOKEN_BUDGET = parseInt(process.env.HISTORY_TOKEN_BUDGET || '6000', 10);
const OPENROUTER_MAX_MODEL_ATTEMPTS = Math.max(1, parseInt(process.env.OPENROUTER_MAX_MODEL_ATTEMPTS || (FAST_REPLY_MODE ? '2' : '4'), 10) || 2);

const REALTIME_KEYWORDS = ["2024", "2025", "2026", "today", "now", "current", "latest", "right now"];
const REALTIME_INTENT_PATTERNS = /(richest|top\s+\d+|top company|best phone|prime minister|president|ceo|stock price|net worth|market cap|breaking news|rank(ing)?|leader|who is|what is the current)/;

export const needsRealtimeSearch = (userMessage: string): boolean => {
  const msg = String(userMessage || '').toLowerCase();
  return REALTIME_KEYWORDS.some((k) => msg.includes(k)) || REALTIME_INTENT_PATTERNS.test(msg);
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

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs))
  ]);
};

const fetchDuckDuckGoContext = async (query: string): Promise<RetrievalDoc[]> => {
  const encoded = encodeURIComponent(query);
  const response = await withTimeout(fetch(`https://duckduckgo.com/html/?q=${encoded}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SwiftDeployBot/1.0)' }
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
  const response = await withTimeout(fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encoded}&utf8=1&format=json&srlimit=${WEB_MAX_SNIPPETS}`), WEB_TIMEOUT_MS);
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
  return Array.from(new Set([base, `${base} latest ${year}`].map((x) => x.trim()).filter(Boolean))).slice(0, RETRIEVAL_MAX_QUERIES);
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
  return scored.filter((x) => x.score >= 2).sort((a, b) => b.score - a.score).map((x) => x.d);
};

const isTemporalQuery = (text: string): boolean => {
  const q = text.toLowerCase();
  return /(latest|today|current|recent|now|this year|202[4-9]|forecast|estimate|prediction|market|price|revenue|gdp|election|news)/.test(q);
};

const needsLiveFacts = (text: string): boolean => {
  const q = text.toLowerCase();
  return /(latest|today|current|recent|now|as of|202[4-9]|price|market cap|gdp|revenue|stock|rank|top\s+\d+|news|update|election|breaking)/.test(q);
};

const buildWebGrounding = async (prompt: string): Promise<string> => {
  const enabled = (process.env.LIVE_GROUNDING_ENABLED || 'true').toLowerCase() !== 'false';
  const shouldRetrieve = needsRealtimeSearch(prompt) || ALWAYS_WEB_RETRIEVAL || needsLiveFacts(prompt);
  if (!enabled || !shouldRetrieve) return '';

  const cacheKey = prompt.trim().toLowerCase();
  const cached = retrievalCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    const nowIso = new Date().toISOString();
    const body = cached.docs.map((d) => `${d.title}: ${d.snippet}${d.url ? ` (${d.url})` : ''} [${d.source}]`).join('\n- ');
    return `\nVerified Data (retrieved at ${nowIso})\nYou MUST use the following verified data as ground truth.\n- ${body}`.slice(0, WEB_MAX_CHARS);
  }

  try {
    const queries = buildSearchQueries(prompt);
    const fetchDuck = !FAST_REPLY_MODE || (process.env.ENABLE_DUCK_RETRIEVAL || 'false').trim().toLowerCase() === 'true';
    const fetchSerper = Boolean((process.env.SERPER_API_KEY || '').trim());
    const queryResults = await Promise.all(
      queries.map(async (q) => {
        const [duck, wiki, serper] = await Promise.all([
          fetchDuck ? fetchDuckDuckGoContext(q).catch(() => []) : Promise.resolve([] as RetrievalDoc[]),
          fetchWikipediaContext(q).catch(() => []),
          fetchSerper ? fetchSerperContext(q).catch(() => []) : Promise.resolve([] as RetrievalDoc[])
        ]);
        return [...duck, ...wiki, ...serper];
      })
    );
    const dedupMap = new Map<string, RetrievalDoc>();
    for (const doc of queryResults.flat()) {
      const key = `${doc.title}|${doc.snippet}`.toLowerCase();
      if (!dedupMap.has(key)) dedupMap.set(key, doc);
    }
    const ranked = rankDocs(Array.from(dedupMap.values()), prompt).slice(0, WEB_MAX_SNIPPETS);
    if (!ranked.length) return '';
    retrievalCache.set(cacheKey, { docs: ranked, expiresAt: Date.now() + RETRIEVAL_CACHE_TTL_MS });
    const nowIso = new Date().toISOString();
    const body = ranked.map((d) => `${d.title}: ${d.snippet}${d.url ? ` (${d.url})` : ''} [${d.source}]`).join('\n- ');
    return `\nVerified Data (retrieved at ${nowIso})\nYou MUST use the following verified data as ground truth.\n- ${body}`.slice(0, WEB_MAX_CHARS);
  } catch {
    return '';
  }
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

const historyTokens = (history: ChatHistory): number => {
  return history.reduce((sum, entry) => {
    const text = (entry.parts || []).map((p) => p.text || '').join(' ');
    return sum + Math.ceil(text.length / 4);
  }, 0);
};

const manageHistoryByTokens = (history: ChatHistory): ChatHistory => {
  if (!history.length || historyTokens(history) <= HISTORY_TOKEN_BUDGET) return history;
  const kept: ChatHistory = [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    kept.unshift(history[i]);
    if (historyTokens(kept) > HISTORY_TOKEN_BUDGET) {
      kept.shift();
      break;
    }
  }
  return kept;
};

const buildSystemInstruction = (customInstruction?: string): string => {
  const base = `
You are a professional assistant.
- Be accurate, clear, and concise.
- Never fabricate facts, links, or sources.
- If uncertain, state uncertainty.
- Use conversation context when relevant.
  `.trim();
  return customInstruction ? `${base}\n\n${customInstruction.trim()}` : base;
};

const getOpenRouterPoolFromEnv = (): string[] => {
  const csv = (process.env.OPENROUTER_MODELS || '').trim();
  if (!csv) return [];
  return csv.split(',').map((m) => m.trim()).filter(Boolean);
};

const getOpenRouterIntentModels = (intent: IntentType): string[] => {
  if (intent === 'coding') {
    const csv = (process.env.OPENROUTER_MODELS_CODING || '').trim();
    if (csv) return csv.split(',').map((m) => m.trim()).filter(Boolean);
  }
  if (intent === 'math') {
    const csv = (process.env.OPENROUTER_MODELS_MATH || '').trim();
    if (csv) return csv.split(',').map((m) => m.trim()).filter(Boolean);
  }
  if (intent === 'current_event') {
    const csv = (process.env.OPENROUTER_MODELS_REALTIME || '').trim();
    if (csv) return csv.split(',').map((m) => m.trim()).filter(Boolean);
  }
  const csv = (process.env.OPENROUTER_MODELS_GENERAL || '').trim();
  if (csv) return csv.split(',').map((m) => m.trim()).filter(Boolean);
  return [];
};

const getOpenRouterCandidateModels = (prompt: string, modelOverride?: string): string[] => {
  const intent = detectIntent(prompt);
  const baseModel = (process.env.OPENROUTER_MODEL || process.env.DEFAULT_MODEL || 'openrouter/free').trim();
  const override = String(modelOverride || '').trim();
  return Array.from(new Set([override, baseModel, ...getOpenRouterIntentModels(intent), ...getOpenRouterPoolFromEnv()].filter(Boolean)));
};

const callOpenRouter = async (
  prompt: string,
  history: ChatHistory,
  systemInstruction?: string,
  modelOverride?: string
): Promise<string> => {
  const apiKey = (process.env.OPENROUTER_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY_MISSING');
  }

  const attempts = getOpenRouterCandidateModels(prompt, modelOverride).slice(0, OPENROUTER_MAX_MODEL_ATTEMPTS);
  if (!attempts.length) {
    throw new Error('OPENROUTER_MODEL_MISSING');
  }
  const historyText = extractHistoryText(history);
  const baseUrl = (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1/chat/completions').trim();
  const referer = (process.env.FRONTEND_URL || process.env.BASE_URL || '').trim();
  let lastError: Error | null = null;

  for (const model of attempts) {
    try {
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(referer ? { 'HTTP-Referer': referer } : {}),
          'X-Title': 'SwiftDeploy AI'
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
        const message = data?.error?.message || data?.message || `OpenRouter request failed (${response.status})`;
        if (response.status === 401 || response.status === 403) {
          throw new Error(`OPENROUTER_ERROR: ${message}`);
        }
        lastError = new Error(`OPENROUTER_ERROR: ${message}`);
        continue;
      }

      const text = data?.choices?.[0]?.message?.content;
      if (!text || typeof text !== 'string') {
        lastError = new Error('OPENROUTER_EMPTY_RESPONSE');
        continue;
      }
      return text.trim();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError || new Error('OPENROUTER_ROUTING_FAILED');
};

export const generateBotResponse = async (
  prompt: string,
  _model: string = 'openrouter/free',
  history: ChatHistory = [],
  systemInstruction?: string,
  runtimeConfig?: AIRuntimeConfig
): Promise<string> => {
  try {
    const sanitizedPrompt = prompt.trim();
    const compactHistory = manageHistoryByTokens(history);
    const adaptiveInstruction = buildSystemInstruction(systemInstruction);
    const liveGrounding = isTemporalQuery(sanitizedPrompt) ? await buildWebGrounding(sanitizedPrompt) : '';
    if (STRICT_TEMPORAL_GROUNDING && isTemporalQuery(sanitizedPrompt) && !liveGrounding) {
      throw new Error('LIVE_CONTEXT_UNAVAILABLE');
    }
    const groundedPrompt = liveGrounding
      ? `${liveGrounding}\n\nCurrent User Question:\n${sanitizedPrompt}\n\nUse the retrieved data carefully and state uncertainty if sources conflict.`
      : `Current User Question:\n${sanitizedPrompt}`;

    const provider = String(runtimeConfig?.provider || process.env.AI_PROVIDER || 'openrouter').trim().toLowerCase();
    if (provider && provider !== 'openrouter') {
      console.warn(`[AI_CONFIG] Non-OpenRouter provider requested (${provider}). Forcing OpenRouter.`);
    }
    const runtimeModel = String(runtimeConfig?.model || '').trim();
    return await callOpenRouter(groundedPrompt, compactHistory, adaptiveInstruction, runtimeModel || undefined);
  } catch (error) {
    console.error("Backend AI Core Error:", error);
    if (error instanceof Error) {
      if (error.message.includes('LIVE_CONTEXT_UNAVAILABLE')) {
        throw new Error('LIVE_CONTEXT_UNAVAILABLE');
      }
      if (error.message.includes('OPENROUTER')) {
        throw new Error("INVALID_PROVIDER_KEY: Please check your OpenRouter API configuration");
      }
      if (error.message.includes('quota') || error.message.includes('rate')) {
        throw new Error("RATE_LIMIT_EXCEEDED: Please try again in a few moments");
      }
      if (error.message.includes('network') || error.message.includes('fetch')) {
        throw new Error("NETWORK_ERROR: Unable to connect to AI service");
      }
    }
    throw new Error(`AI_GENERATION_FAILED: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

export const estimateTokens = (text: string): number => {
  return Math.ceil(text.length / 4);
};
