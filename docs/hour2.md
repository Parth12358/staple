# Staple — Hour 2
**Goal: DeepSeek answers questions, Langfuse logs everything, character moves to element, API keys stored in extension settings**

---

## What We're Building This Hour
1. `popup.js` — sends user question to DeepSeek, gets element back, moves character
2. Settings screen in popup — user pastes API keys, saved to chrome.storage.sync
3. Langfuse logging on every query
4. Message passing between popup and content script

---

## TODO

- [ ] Create src/popup.js
- [ ] Update popup.html with settings screen + gear icon
- [ ] Update build.sh to include popup.js
- [ ] Run build.sh
- [ ] Reload extension in Chrome and Firefox
- [ ] Open popup, click gear, paste API keys, save
- [ ] Test: type "where is X" → character moves to element
- [ ] Check Langfuse dashboard — query should appear

---

## src/popup.js
```javascript
// ─── Storage ─────────────────────────────────────────────────
async function getKeys() {
  return new Promise(resolve => {
    chrome.storage.sync.get(
      ['deepseekKey', 'langfusePublicKey', 'langfuseSecretKey'],
      resolve
    );
  });
}

async function saveKeys(deepseekKey, langfusePublicKey, langfuseSecretKey) {
  return new Promise(resolve => {
    chrome.storage.sync.set({ deepseekKey, langfusePublicKey, langfuseSecretKey }, resolve);
  });
}

// ─── Settings UI ─────────────────────────────────────────────
function showSettings() {
  document.getElementById('chat-view').style.display = 'none';
  document.getElementById('settings-view').style.display = 'flex';

  // Pre-fill saved keys
  chrome.storage.sync.get(['deepseekKey', 'langfusePublicKey', 'langfuseSecretKey'], data => {
    if (data.deepseekKey) document.getElementById('input-deepseek').value = data.deepseekKey;
    if (data.langfusePublicKey) document.getElementById('input-lf-public').value = data.langfusePublicKey;
    if (data.langfuseSecretKey) document.getElementById('input-lf-secret').value = data.langfuseSecretKey;
  });
}

function showChat() {
  document.getElementById('settings-view').style.display = 'none';
  document.getElementById('chat-view').style.display = 'flex';
}

async function handleSaveKeys() {
  const deepseekKey = document.getElementById('input-deepseek').value.trim();
  const langfusePublicKey = document.getElementById('input-lf-public').value.trim();
  const langfuseSecretKey = document.getElementById('input-lf-secret').value.trim();

  await saveKeys(deepseekKey, langfusePublicKey, langfuseSecretKey);

  document.getElementById('save-status').innerText = '✅ Saved';
  setTimeout(() => {
    document.getElementById('save-status').innerText = '';
    showChat();
  }, 1000);
}

// ─── Langfuse ────────────────────────────────────────────────
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

// ─── DeepSeek ────────────────────────────────────────────────
async function queryDeepSeek(question, elementMap, keys) {
  if (!keys.deepseekKey) {
    throw new Error('No DeepSeek API key. Click ⚙️ to add it.');
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

  // Log to Langfuse
  const traceId = crypto.randomUUID();
  await logToLangfuse(traceId, messages, result, keys);

  return result;
}

// ─── Tab messaging ───────────────────────────────────────────
async function getActiveTab() {
  return new Promise(resolve => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => resolve(tabs[0]));
  });
}

async function getElementsFromPage() {
  return new Promise(async resolve => {
    const tab = await getActiveTab();
    chrome.tabs.sendMessage(tab.id, { type: 'GET_ELEMENTS' }, resolve);
  });
}

async function moveCharacterOnPage(elementId) {
  const tab = await getActiveTab();
  chrome.tabs.sendMessage(tab.id, { type: 'MOVE_CHARACTER', elementId });
}

async function showBubbleOnPage(text) {
  const tab = await getActiveTab();
  chrome.tabs.sendMessage(tab.id, { type: 'SHOW_BUBBLE', text });
}

async function setStateOnPage(state) {
  const tab = await getActiveTab();
  chrome.tabs.sendMessage(tab.id, { type: 'SET_STATE', state });
}

// ─── Chat UI ─────────────────────────────────────────────────
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
      addMessage('No API key found. Click ⚙️ to add your DeepSeek key.', 'buddy');
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
  input.focus();
}

// ─── Init ────────────────────────────────────────────────────
document.getElementById('send-btn').onclick = handleSend;
document.getElementById('user-input').onkeydown = e => e.key === 'Enter' && handleSend();
document.getElementById('gear-btn').onclick = showSettings;
document.getElementById('back-btn').onclick = showChat;
document.getElementById('save-btn').onclick = handleSaveKeys;
```

---

## Update popup.html
```html
<!DOCTYPE html>
<html>
<head>
  <style>
    * { box-sizing: border-box; }
    body {
      width: 320px;
      height: 480px;
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      background: #0f0f0f;
      color: white;
      display: flex;
      flex-direction: column;
    }

    /* ── Header ── */
    #sb-header {
      padding: 12px 16px;
      border-bottom: 1px solid #222;
      font-weight: 600;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    #gear-btn, #back-btn {
      background: none;
      border: none;
      color: #888;
      cursor: pointer;
      font-size: 16px;
      padding: 0;
    }
    #gear-btn:hover, #back-btn:hover { color: white; }

    /* ── Chat view ── */
    #chat-view {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    #chat-container {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    #input-row {
      display: flex;
      gap: 8px;
      padding: 12px;
      border-top: 1px solid #222;
      flex-shrink: 0;
    }
    #user-input {
      flex: 1;
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 20px;
      padding: 8px 14px;
      color: white;
      font-size: 13px;
      outline: none;
    }
    #user-input::placeholder { color: #555; }
    #user-input:disabled { opacity: 0.5; }
    #send-btn {
      background: #6366f1;
      border: none;
      border-radius: 50%;
      width: 36px;
      height: 36px;
      color: white;
      cursor: pointer;
      font-size: 16px;
      flex-shrink: 0;
    }
    #send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .msg-user {
      background: #6366f1;
      border-radius: 12px 12px 2px 12px;
      padding: 8px 12px;
      font-size: 13px;
      align-self: flex-end;
      max-width: 80%;
      word-wrap: break-word;
    }
    .msg-buddy {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 12px 12px 12px 2px;
      padding: 8px 12px;
      font-size: 13px;
      align-self: flex-start;
      max-width: 80%;
      color: #eee;
      word-wrap: break-word;
    }

    /* ── Settings view ── */
    #settings-view {
      flex: 1;
      flex-direction: column;
      padding: 16px;
      gap: 12px;
      display: none;
      overflow-y: auto;
    }
    .settings-label {
      font-size: 11px;
      color: #888;
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .settings-input {
      width: 100%;
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 8px 12px;
      color: white;
      font-size: 12px;
      outline: none;
      font-family: monospace;
    }
    .settings-input:focus { border-color: #6366f1; }
    #save-btn {
      background: #6366f1;
      border: none;
      border-radius: 8px;
      padding: 10px;
      color: white;
      font-size: 13px;
      cursor: pointer;
      font-weight: 600;
      width: 100%;
      margin-top: 4px;
    }
    #save-btn:hover { background: #4f46e5; }
    #save-status {
      font-size: 12px;
      color: #6ee7b7;
      text-align: center;
      min-height: 18px;
    }
    .settings-section { display: flex; flex-direction: column; gap: 4px; }
    .settings-divider {
      border: none;
      border-top: 1px solid #222;
      margin: 4px 0;
    }
  </style>
</head>
<body>
  <div id="sb-header">
    <span>📎 Staple</span>
    <button id="gear-btn" title="Settings">⚙️</button>
  </div>

  <!-- Chat View -->
  <div id="chat-view">
    <div id="chat-container">
      <div class="msg-buddy">Hey! Ask me where anything is on this page.</div>
    </div>
    <div id="input-row">
      <input id="user-input" placeholder="Ask Staple..." />
      <button id="send-btn">→</button>
    </div>
  </div>

  <!-- Settings View -->
  <div id="settings-view">
    <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
      <button id="back-btn">← Back</button>
      <span style="font-weight:600; font-size:14px;">API Keys</span>
    </div>
    <hr class="settings-divider" />

    <div class="settings-section">
      <div class="settings-label">DeepSeek API Key</div>
      <input class="settings-input" id="input-deepseek" type="password" placeholder="sk-..." />
    </div>

    <div class="settings-section">
      <div class="settings-label">Langfuse Public Key</div>
      <input class="settings-input" id="input-lf-public" type="password" placeholder="pk-lf-..." />
    </div>

    <div class="settings-section">
      <div class="settings-label">Langfuse Secret Key</div>
      <input class="settings-input" id="input-lf-secret" type="password" placeholder="sk-lf-..." />
    </div>

    <button id="save-btn">Save Keys</button>
    <div id="save-status"></div>
  </div>

  <script src="popup.js"></script>
</body>
</html>
```

---

## Update build.sh
```bash
#!/bin/bash
FILES="content.js content.css background.js popup.html popup.js"
for f in $FILES; do
  cp src/$f chrome/$f
  cp src/$f firefox/$f
done
echo "✅ Built for Chrome and Firefox"
```

---

## How to Reload Extension

### Chrome
1. Go to `chrome://extensions`
2. Click the refresh icon on Staple

### Firefox
1. Go to `about:debugging`
2. Click **Reload** on Staple

---

## Checkpoint — Hour 2 Done When:
- [ ] Click ⚙️ → settings screen opens
- [ ] Paste keys → click Save → returns to chat
- [ ] Type "where is the search bar" → character moves to it
- [ ] Instruction appears in speech bubble on page
- [ ] Instruction appears in popup chat
- [ ] Langfuse dashboard shows query logged
- [ ] Follow up questions work with conversation context
- [ ] No hardcoded keys anywhere in code

## Hour 3 starts here → Polish + Demo + Submit
