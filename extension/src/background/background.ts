import type { ChatMessage, ChatResponse, Config, LookupPayload, LookupResponse, Message, Provider } from '../types';

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  if (msg.type === 'lookup') {
    handleLookup(msg.payload)
      .then(sendResponse)
      .catch((e: Error) => sendResponse({ error: e.message }));
    return true; // keep the message channel open for async response
  }

  if (msg.type === 'clear_cache') {
    clearCache()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (msg.type === 'chat') {
    handleChat(msg.payload.messages)
      .then(sendResponse)
      .catch((e: Error) => sendResponse({ error: e.message }));
    return true;
  }
});

// ── Config ───────────────────────────────────────────────────────

async function getConfig(): Promise<Config> {
  const s = await chrome.storage.local.get([
    'provider', 'apiKey', 'model', 'autoLookup', 'contextMaxLength',
  ]);
  return {
    provider: (s.provider as Provider) || 'claude',
    apiKey: s.apiKey || '',
    model: s.model || 'claude-haiku-4-5-20251001',
    autoLookup: s.autoLookup !== false,
    contextMaxLength: typeof s.contextMaxLength === 'number' ? s.contextMaxLength : 600,
  };
}

// ── Lookup handler ───────────────────────────────────────────────

async function handleLookup(payload: LookupPayload): Promise<LookupResponse> {
  const config = await getConfig();

  if (!config.apiKey.trim()) {
    return {
      error: 'No API key set. Open the Clarify popup to add your key.',
    };
  }

  const { text, context } = payload;
  const truncatedContext = context.substring(0, config.contextMaxLength);

  // Deterministic cache key (capped to avoid huge storage keys)
  const raw = `${text}|||${truncatedContext}`;
  const cacheKey = `cache_${btoa(encodeURIComponent(raw)).substring(0, 120)}`;

  const cached = await chrome.storage.local.get(cacheKey);
  if (cached[cacheKey]) return cached[cacheKey] as LookupResponse;

  const prompt = buildPrompt(text, truncatedContext);

  const stopKeepalive = startKeepalive();
  let result: LookupResponse;
  try {
    result = await callLLM(config, prompt);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return { error: e instanceof Error && e.name === 'AbortError' ? 'Request timed out (20 s). Check your connection.' : `API error: ${msg}` };
  } finally {
    stopKeepalive();
  }

  await chrome.storage.local.set({ [cacheKey]: result });
  return result;
}

// ── Chat handler ─────────────────────────────────────────────────

async function handleChat(messages: ChatMessage[]): Promise<ChatResponse> {
  const config = await getConfig();
  if (!config.apiKey.trim()) {
    return { error: 'No API key set. Open Clarify to add your key.' };
  }
  const stopKeepalive = startKeepalive();
  try {
    const reply = config.provider === 'claude'
      ? await callChatClaude(config.apiKey, config.model, messages)
      : config.provider === 'openai'
      ? await callChatOpenAI(config.apiKey, config.model, messages)
      : await callChatGemini(config.apiKey, config.model, messages);
    return { reply };
  } catch (e: unknown) {
    return { error: e instanceof Error && e.name === 'AbortError' ? 'Request timed out (20 s). Check your connection.' : e instanceof Error ? e.message : 'Unknown error' };
  } finally {
    stopKeepalive();
  }
}

// ── Prompt ───────────────────────────────────────────────────────

function buildPrompt(text: string, context: string): string {
  return (
    `Word or phrase: "${text}"\n` +
    `Context: "${context}"\n\n` +
    `Respond ONLY in valid JSON:\n` +
    `{"short_def":"...","contextual_explain":"...","example_use":"..."}`
  );
}

// ── LLM dispatch ─────────────────────────────────────────────────

async function callLLM(config: Config, prompt: string): Promise<LookupResponse> {
  if (config.provider === 'claude') return callClaude(config.apiKey, config.model, prompt);
  if (config.provider === 'openai') return callOpenAI(config.apiKey, config.model, prompt);
  return callGemini(config.apiKey, config.model, prompt);
}

const SYSTEM_PROMPT =
  'You are a concise assistant. Return ONLY valid JSON with exactly these keys: ' +
  'short_def (≤30 words), contextual_explain (1–3 sentences), example_use (one sentence). ' +
  'No markdown fences, no extra text.';

async function callClaude(
  apiKey: string,
  model: string,
  prompt: string,
): Promise<LookupResponse> {
  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
  }

  const data = (await res.json()) as { content?: Array<{ text?: string }> };
  return parseJSON(data?.content?.[0]?.text ?? '');
}

async function callOpenAI(
  apiKey: string,
  model: string,
  prompt: string,
): Promise<LookupResponse> {
  const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 300,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return parseJSON(data?.choices?.[0]?.message?.content ?? '');
}

// ── Chat LLM calls ────────────────────────────────────────────────

async function callChatClaude(apiKey: string, model: string, messages: ChatMessage[]): Promise<string> {
  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { content?: Array<{ text?: string }> };
  return data?.content?.[0]?.text ?? '';
}

async function callChatOpenAI(apiKey: string, model: string, messages: ChatMessage[]): Promise<string> {
  const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: 'You are a helpful, concise assistant.' },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data?.choices?.[0]?.message?.content ?? '';
}

async function callGemini(apiKey: string, model: string, prompt: string): Promise<LookupResponse> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 300 },
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return parseJSON(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
}

async function callChatGemini(apiKey: string, model: string, messages: ChatMessage[]): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: messages.map((m) => ({
        // Gemini uses "model" role instead of "assistant"
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: { maxOutputTokens: 1024 },
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

// ── Helpers ───────────────────────────────────────────────────────

// Wraps fetch with an AbortController timeout so a hung request never
// leaves the tooltip spinning forever.
function fetchWithTimeout(url: string, options: RequestInit, ms = 20_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

// MV3 service workers can be killed mid-request if no Chrome API is called.
// Pinging storage every 10 s keeps the worker alive for the duration of a fetch.
function startKeepalive(): () => void {
  const id = setInterval(() => chrome.storage.local.get('__ka__'), 10_000);
  return () => clearInterval(id);
}

function parseJSON(raw: string): LookupResponse {
  // Strip optional markdown code fences the model might add
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(text) as LookupResponse;
  } catch {
    // If the model returned plain text instead of JSON, surface it as short_def
    return { short_def: text, contextual_explain: '', example_use: '' };
  }
}

async function clearCache(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith('cache_'));
  if (keys.length > 0) await chrome.storage.local.remove(keys);
}
