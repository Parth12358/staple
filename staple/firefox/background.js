const api = typeof browser !== 'undefined' ? browser : chrome;
const LOG_PREFIX = '[Staple BG]';

function getStorage() { return api.storage.local; }
function getSyncStorage() { return api.storage.sync; }

function loadHistory() {
  return new Promise(resolve => {
    getStorage().get(['conversationHistory'], data => {
      resolve(data.conversationHistory || []);
    });
  });
}

function saveHistory(history) {
  return new Promise(resolve => {
    getStorage().set({ conversationHistory: history }, resolve);
  });
}

function loadKeys() {
  return new Promise(resolve => {
    getSyncStorage().get(['deepseekKey', 'langfusePublicKey', 'langfuseSecretKey'], resolve);
  });
}

function buildInlineMessages(question, elementMap, history) {
  const mapString = elementMap
    .map(e => `[${e.id}] ${e.label} (${e.tag}) at (${e.x}, ${e.y})`)
    .join('\n');

  const systemPrompt = `You are Staple, an AI navigation assistant embedded in a browser extension.
You help users navigate UI on any webpage by reading a map of interactive elements.
When a task requires multiple actions, return all steps in sequence.
Always respond in valid JSON only, no markdown:
{
  "steps": [
    { "elementId": <number or null>, "instruction": "<clear friendly instruction>" },
    { "elementId": <number or null>, "instruction": "<next step>" }
  ],
  "summary": "<one line summary of what you are helping with>"
}
If only one step is needed, still return a steps array with one item.`;

  return [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: `Page elements:\n${mapString}\n\nUser question: ${question}` }
  ];
}

async function handleInlineQuery(question, elementMap) {
  try {
    const keys = await loadKeys();
    if (!keys.deepseekKey) {
      return { success: false, error: 'No DeepSeek API key configured.' };
    }

    const history = await loadHistory();
    const messages = buildInlineMessages(question, elementMap, history);
    const result = await handleDeepSeekQuery(messages, keys.deepseekKey);

    if (!result.success) return result;

    const updatedHistory = [
      ...history,
      { role: 'user', content: question },
      { role: 'assistant', content: JSON.stringify(result.result) }
    ];
    await saveHistory(updatedHistory);

    const traceId = crypto.randomUUID();
    handleLangfuseLog(traceId, messages, result.result, keys.langfusePublicKey, keys.langfuseSecretKey);

    return result;
  } catch (err) {
    console.error(`${LOG_PREFIX} Inline query failed:`, err);
    return { success: false, error: err.message || 'Something went wrong.' };
  }
}

async function handlePageChangedMidFlow(elementMap, url, activeSteps, activeStepIndex) {
  try {
    const keys = await loadKeys();
    if (!keys.deepseekKey) {
      return { success: false, error: 'No DeepSeek API key configured.' };
    }

    const history = await loadHistory();

    const mapString = elementMap
      .map(e => `[${e.id}] ${e.label} (${e.tag}) at (${e.x}, ${e.y})`)
      .join('\n');

    const remainingSteps = activeSteps.slice(activeStepIndex);
    const stepsSummary = remainingSteps
      .map((s, i) => `  Step ${activeStepIndex + i + 1}: ${s.instruction}`)
      .join('\n');

    const systemPrompt = `You are Staple, an AI navigation assistant embedded in a browser extension.
You help users navigate UI on any webpage by reading a map of interactive elements.
When a task requires multiple actions, return all steps in sequence.
Always respond in valid JSON only, no markdown:
{
  "steps": [
    { "elementId": <number or null>, "instruction": "<clear friendly instruction>" },
    { "elementId": <number or null>, "instruction": "<next step>" }
  ],
  "summary": "<one line summary of what you are helping with>"
}

The user was mid-flow on a multi-step task and the page has changed or refreshed.
Here is the original task steps and where we were.
Here is the fresh element map of the current page.
Re-evaluate the remaining steps and return an updated steps array starting from the current position that maps correctly to the elements now visible on this page.
If the task is already complete based on the current page state, return an empty steps array and set summary to the completion message.`;

    const userContent = `Current page URL: ${url}\n\nFresh element map:\n${mapString}\n\nOriginal task remaining (at step ${activeStepIndex + 1} of ${activeSteps.length}):\n${stepsSummary}\n\nRe-evaluate and return updated steps for this page.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: userContent }
    ];

    const result = await handleDeepSeekQuery(messages, keys.deepseekKey);

    if (!result.success) return result;

    const updatedSteps = result.result.steps || [];

    await getStorage().set({
      activeSteps: updatedSteps,
      activeStepIndex: 0,
      elementMap
    });

    const updatedHistory = [
      ...history,
      { role: 'assistant', content: JSON.stringify(result.result) }
    ];
    await saveHistory(updatedHistory);

    const traceId = crypto.randomUUID();
    handleLangfuseLog(traceId, messages, result.result, keys.langfusePublicKey, keys.langfuseSecretKey);

    api.runtime.sendMessage({
      type: 'PAGE_CHANGED_MID_FLOW',
      elementMap,
      url,
      activeSteps: updatedSteps,
      activeStepIndex: 0,
      summary: result.result.summary
    });

    return result;
  } catch (err) {
    console.error(`${LOG_PREFIX} Page changed re-evaluation failed:`, err);
    return { success: false, error: err.message || 'Re-evaluation failed.' };
  }
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'DEEPSEEK_QUERY') {
    handleDeepSeekQuery(msg.messages, msg.deepseekKey).then(sendResponse);
    return true;
  }
  if (msg.type === 'INLINE_QUERY') {
    handleInlineQuery(msg.question, msg.elementMap).then(sendResponse);
    return true;
  }
  if (msg.type === 'PAGE_CHANGED_MID_FLOW') {
    handlePageChangedMidFlow(msg.elementMap, msg.url, msg.activeSteps, msg.activeStepIndex).then(sendResponse);
    return true;
  }
  if (msg.type === 'LANGFUSE_LOG') {
    handleLangfuseLog(msg.traceId, msg.input, msg.output, msg.langfusePublicKey, msg.langfuseSecretKey);
    return false;
  }
});

async function handleDeepSeekQuery(messages, deepseekKey) {
  try {
    if (!deepseekKey) {
      return { success: false, error: 'No DeepSeek API key configured.' };
    }

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${deepseekKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        response_format: { type: 'json_object' },
        max_tokens: 300
      })
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error');
      console.error(`${LOG_PREFIX} DeepSeek ${response.status}: ${errText}`);
      return { success: false, error: `DeepSeek error (${response.status}). Check your API key.` };
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content;

    if (!raw) {
      return { success: false, error: 'Empty response from DeepSeek.' };
    }

    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      console.error(`${LOG_PREFIX} Invalid JSON from DeepSeek:`, raw);
      return { success: false, error: 'DeepSeek returned an unparseable response. Try again.' };
    }

    return { success: true, result };
  } catch (err) {
    console.error(`${LOG_PREFIX} DeepSeek fetch failed:`, err);
    return { success: false, error: `DeepSeek unavailable (${err.message || 'network error'}).` };
  }
}

async function handleLangfuseLog(traceId, input, output, langfusePublicKey, langfuseSecretKey) {
  if (!langfusePublicKey || !langfuseSecretKey) return;
  try {
    await fetch('https://cloud.langfuse.com/api/public/ingestion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + btoa(`${langfusePublicKey}:${langfuseSecretKey}`)
      },
      body: JSON.stringify({
        batch: [{
          type: 'generation',
          body: {
            traceId,
            name: 'staple-query',
            model: 'deepseek-chat',
            input,
            output,
            startTime: new Date().toISOString()
          }
        }]
      })
    });
  } catch (e) {
    console.warn(`${LOG_PREFIX} Langfuse log failed silently`, e);
  }
}
