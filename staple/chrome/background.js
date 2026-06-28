const api = typeof browser !== 'undefined' ? browser : chrome;

const PROVIDERS = {
  deepseek: {
    name: 'DeepSeek',
    url: 'https://api.deepseek.com/chat/completions',
    auth: 'bearer',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    format: 'openai'
  },
  openai: {
    name: 'OpenAI',
    url: 'https://api.openai.com/v1/chat/completions',
    auth: 'bearer',
    models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'],
    format: 'openai'
  },
  anthropic: {
    name: 'Anthropic',
    url: 'https://api.anthropic.com/v1/messages',
    auth: 'x-api-key',
    models: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
    format: 'anthropic'
  },
  groq: {
    name: 'Groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    auth: 'bearer',
    models: ['openai/gpt-oss-120b', 'qwen/qwen3.6-27b'],
    format: 'openai'
  },
  gemini: {
    name: 'Google Gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    auth: 'bearer',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    format: 'openai'
  },
  ollama: {
    name: 'Ollama (local)',
    url: 'http://localhost:11434/api/chat',
    auth: 'none',
    models: [],
    format: 'ollama'
  }
};

function getSyncStorage() { return api.storage.sync; }

async function loadSettings() {
  return new Promise(resolve => {
    getSyncStorage().get(['provider', 'model', 'apiKey', 'deepseekKey'], async data => {
      if (!data.apiKey && data.deepseekKey) {
        data.apiKey = data.deepseekKey;
        data.provider = 'deepseek';
        if (!data.model) data.model = 'deepseek-v4-flash';
        getSyncStorage().set({ apiKey: data.apiKey, provider: data.provider, model: data.model });
      }
      if (!data.provider) data.provider = 'deepseek';
      if (!data.model) data.model = 'deepseek-v4-flash';
      console.log('[Staple][background:loadSettings] Loaded', { provider: data.provider, model: data.model, hasKey: (data.apiKey || '').length > 0 });
      resolve({ provider: data.provider, model: data.model, apiKey: data.apiKey || '' });
    });
  });
}

function buildMessages(question, elementMap, url, title) {
  const mapString = elementMap
    .map(e => `[${e.id}] ${e.label} (${e.tag}) at (${e.x}, ${e.y})`)
    .join('\n');

  const siteContext = url || title
    ? `Site context:\n  URL: ${url || 'unknown'}\n  Title: ${title || 'unknown'}\n`
    : '';

  const systemPrompt = `You are Staple, a navigation assistant embedded in a browser extension. The user will ask where something is or how to do something on the current page. You will be given a map of all interactive elements on the page.

Identify the single most relevant element and write a clear, specific instruction that tells the user exactly what to do and where to find it. Mention the element label and its location on the page where helpful. Write in imperative voice: Click, Type, Select, Toggle. Do not use emojis. Do not use bullet points. Write in plain sentences. Do not say you should or you can.

If the element is not found, set elementId to null and explain what is not available and suggest the most likely alternative in plain text.

Respond in valid JSON only, no markdown, no explanation outside the JSON:
{
  "elementId": <number or null>,
  "instruction": "<imperative sentence describing exactly what to do and where>",
  "context": "<optional: what happens next, a warning, or an alternative — empty string if not needed>"
}`;

  return { systemPrompt, userMessage: `Page elements:\n${mapString}\n\nUser question: ${question}`, siteContext };
}

function buildRequest(provider, model, providerConfig, apiKey, messages) {
  const { systemPrompt, userMessage } = messages;
  const format = providerConfig.format;

  if (format === 'anthropic') {
    return {
      url: providerConfig.url,
      options: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          max_tokens: 800,
          system: systemPrompt + '\n' + messages.siteContext,
          messages: [{ role: 'user', content: userMessage }]
        })
      },
      format: 'anthropic'
    };
  }

  if (format === 'ollama') {
    return {
      url: providerConfig.url,
      options: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt + '\n' + messages.siteContext },
            { role: 'user', content: userMessage }
          ],
          stream: false
        })
      },
      format: 'ollama'
    };
  }

  return {
    url: providerConfig.url,
    options: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt + '\n' + messages.siteContext },
          { role: 'user', content: userMessage }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 800
      })
    },
    format: 'openai'
  };
}

function parseResponse(format, data) {
  if (format === 'anthropic') return data.content[0].text;
  if (format === 'ollama') return data.message.content;
  return data.choices[0].message.content;
}

async function handleQuery(question, elementMap, url, title) {
  try {
    const settings = await loadSettings();
    if (!settings.apiKey && settings.provider !== 'ollama') {
      console.error('[Staple][background:queryLLM] No API key set for provider', { provider: settings.provider });
      return { success: false, error: 'No API key configured. Open the extension settings.' };
    }

    const providerConfig = PROVIDERS[settings.provider];
    if (!providerConfig) {
      console.error('[Staple][background:queryLLM] Unknown provider', { provider: settings.provider });
      return { success: false, error: 'Unknown provider. Check settings.' };
    }

    const model = settings.provider === 'ollama' ? settings.model.trim() : settings.model;

    if (!elementMap || !elementMap.length) {
      console.warn('[Staple][background:queryLLM] Empty elementMap sent to LLM', { url });
    }

    const messages = buildMessages(question, elementMap, url, title);
    const request = buildRequest(settings.provider, model, providerConfig, settings.apiKey, messages);

    console.log('[Staple][background:queryLLM] Calling API', { provider: settings.provider, model, url: request.url, elementMapSize: elementMap.length });

    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out')), 30000));
    const response = await Promise.race([fetch(request.url, request.options), timeout]);

    console.log('[Staple][background:queryLLM] API response status', { status: response.status });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error');
      console.error('[Staple][background:queryLLM] API request failed', { provider: settings.provider, model: settings.model, status: response.status, statusText: errText });
      return { success: false, error: `${providerConfig.name} error (${response.status}). Check your API key and model.` };
    }

    const data = await response.json();
    const raw = parseResponse(request.format, data);

    if (!raw) {
      console.error('[Staple][background:queryLLM] LLM response missing expected content field', { format: request.format, provider: settings.provider, model: settings.model });
      return { success: false, error: 'Empty response.' };
    }

    let result;
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
      result = JSON.parse(cleaned);
    } catch {
      console.error('[Staple][background:queryLLM] Failed to parse LLM response as JSON', { raw: raw.slice(0, 200), provider: settings.provider, model: settings.model });
      return { success: false, error: 'Model returned an unparseable response. Try again.' };
    }

    console.log('[Staple][background:queryLLM] Calling sendResponse', { elementId: result.elementId, instruction: result.instruction?.slice(0, 50) });

    return { success: true, result };
  } catch (err) {
    console.error('[Staple][background:queryLLM] Fetch exception', { error: err.message || err });
    return { success: false, error: `Unavailable (${err.message || 'network error'}).` };
  }
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('[Staple][background:onMessage] Message received', { type: msg.type });
  if (msg.type === 'QUERY') {
    handleQuery(msg.question, msg.elementMap, msg.url, msg.title)
      .then(result => sendResponse(result))
      .catch(err => {
        console.error('[Staple][background:onMessage] handleQuery rejected', { error: err.message || err });
        sendResponse({ success: false, error: err.message || 'Internal error' });
      });
    return true;
  }
});
