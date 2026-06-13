const api = typeof browser !== 'undefined' ? browser : chrome;

async function getKeys() {
  return new Promise(resolve => {
    api.storage.sync.get(
      ['deepseekKey', 'langfusePublicKey', 'langfuseSecretKey'],
      resolve
    );
  });
}

async function saveKeys(deepseekKey, langfusePublicKey, langfuseSecretKey) {
  return new Promise(resolve => {
    api.storage.sync.set({ deepseekKey, langfusePublicKey, langfuseSecretKey }, resolve);
  });
}

function showSettings() {
  document.getElementById('chat-view').style.display = 'none';
  document.getElementById('settings-view').style.display = 'flex';

  api.storage.sync.get(['deepseekKey', 'langfusePublicKey', 'langfuseSecretKey'], data => {
    if (data.deepseekKey) document.getElementById('input-deepseek').value = data.deepseekKey;
    if (data.langfusePublicKey) document.getElementById('input-lf-public').value = data.langfusePublicKey;
    if (data.langfuseSecretKey) document.getElementById('input-lf-secret').value = data.langfuseSecretKey;
  });
}

function showChat() {
  document.getElementById('settings-view').style.display = 'none';
  document.getElementById('chat-view').style.display = 'flex';
  focusInput();
}

async function handleSaveKeys() {
  const deepseekKey = document.getElementById('input-deepseek').value.trim();
  const langfusePublicKey = document.getElementById('input-lf-public').value.trim();
  const langfuseSecretKey = document.getElementById('input-lf-secret').value.trim();

  await saveKeys(deepseekKey, langfusePublicKey, langfuseSecretKey);

  document.getElementById('save-status').innerText = 'Saved';
  setTimeout(() => {
    document.getElementById('save-status').innerText = '';
    showChat();
  }, 1000);
}

async function logToLangfuse(traceId, input, output, keys) {
  if (!keys.langfusePublicKey || !keys.langfuseSecretKey) return;
  try {
    await fetch('https://cloud.langfuse.com/api/public/ingestion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + btoa(`${keys.langfusePublicKey}:${keys.langfuseSecretKey}`)
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
    console.warn('[Staple] Langfuse log failed silently', e);
  }
}

async function queryDeepSeek(question, elementMap, keys) {
  if (!keys.deepseekKey) {
    throw new Error('No DeepSeek API key. Click the gear icon to add it.');
  }

  const mapString = elementMap
    .map(e => `[${e.id}] ${e.label} (${e.tag}) at (${e.x}, ${e.y})`)
    .join('\n');

  const systemPrompt = `You are Staple, an AI navigation assistant embedded in a browser extension.
You help users find UI elements on any webpage by reading a map of all interactive elements.
Always respond in valid JSON only, no markdown, no explanation outside the JSON:
{
  "elementId": <number or null if not found>,
  "instruction": "<clear friendly instruction telling the user what to do>",
  "followUp": "<optional next step, or empty string>"
}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: `Page elements:\n${mapString}\n\nUser question: ${question}` }
  ];

  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${keys.deepseekKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages,
      response_format: { type: 'json_object' },
      max_tokens: 300
    })
  });

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error('No response from DeepSeek');
  const result = JSON.parse(raw);

  const traceId = crypto.randomUUID();
  await logToLangfuse(traceId, messages, result, keys);

  return result;
}

async function getActiveTab() {
  return new Promise(resolve => {
    api.tabs.query({ active: true, currentWindow: true }, tabs => resolve(tabs[0]));
  });
}

async function getElementsFromPage() {
  return new Promise(async resolve => {
    const tab = await getActiveTab();
    api.tabs.sendMessage(tab.id, { type: 'GET_ELEMENTS' }, resolve);
  });
}

async function moveCharacterOnPage(elementId) {
  const tab = await getActiveTab();
  api.tabs.sendMessage(tab.id, { type: 'MOVE_CHARACTER', elementId });
}

async function showBubbleOnPage(text) {
  const tab = await getActiveTab();
  api.tabs.sendMessage(tab.id, { type: 'SHOW_BUBBLE', text });
}

async function setStateOnPage(state) {
  const tab = await getActiveTab();
  api.tabs.sendMessage(tab.id, { type: 'SET_STATE', state });
}

let history = [];

function addMessage(text, role) {
  const container = document.getElementById('chat-container');
  const msg = document.createElement('div');
  msg.className = role === 'user' ? 'msg-user' : 'msg-buddy';
  msg.innerText = text;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
  return msg;
}

async function handleSend() {
  const input = document.getElementById('user-input');
  const sendBtn = document.getElementById('send-btn');
  const question = input.value.trim();
  if (!question) return;

  input.value = '';
  input.disabled = true;
  sendBtn.disabled = true;

  addMessage(question, 'user');
  const thinkingMsg = addMessage('Thinking...', 'buddy');

  await setStateOnPage('thinking');

  try {
    const keys = await getKeys();

    if (!keys.deepseekKey) {
      thinkingMsg.remove();
      addMessage('No API key found. Click the gear icon to add your DeepSeek key.', 'buddy');
      return;
    }

    const elementMap = await getElementsFromPage();
    if (!elementMap || elementMap.length === 0) {
      thinkingMsg.remove();
      addMessage("I couldn't read this page. Try refreshing.", 'buddy');
      return;
    }

    const result = await queryDeepSeek(question, elementMap, keys);

    thinkingMsg.remove();
    addMessage(result.instruction, 'buddy');
    if (result.followUp) addMessage(result.followUp, 'buddy');

    history.push({ role: 'user', content: question });
    history.push({ role: 'assistant', content: JSON.stringify(result) });

    if (result.elementId !== null && result.elementId !== undefined) {
      await moveCharacterOnPage(result.elementId);
      await showBubbleOnPage(result.instruction);
    }

    await setStateOnPage('idle');

  } catch (err) {
    thinkingMsg.remove();
    addMessage(err.message || 'Something went wrong.', 'buddy');
    console.error('[Staple]', err);
    await setStateOnPage('idle');
  }

  input.disabled = false;
  sendBtn.disabled = false;
  focusInput();
}

function focusInput() {
  const input = document.getElementById('user-input');
  if (input && !input.disabled) {
    setTimeout(() => input.focus(), 50);
  }
}

function bindEvents() {
  document.getElementById('send-btn').onclick = handleSend;
  document.getElementById('user-input').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); handleSend(); } };
  document.getElementById('gear-btn').onclick = showSettings;
  document.getElementById('back-btn').onclick = showChat;
  document.getElementById('save-btn').onclick = handleSaveKeys;
  focusInput();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindEvents);
} else {
  bindEvents();
}
