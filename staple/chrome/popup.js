const api = typeof browser !== 'undefined' ? browser : chrome;
const safeSession = api.storage.session || api.storage.local;

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

async function saveHistory(history) {
  return new Promise(resolve => {
    api.storage.local.set({ conversationHistory: history }, resolve);
  });
}

async function loadHistory() {
  return new Promise(resolve => {
    api.storage.local.get(['conversationHistory'], data => {
      resolve(data.conversationHistory || []);
    });
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
  api.runtime.sendMessage({
    type: 'LANGFUSE_LOG',
    traceId,
    input,
    output,
    langfusePublicKey: keys.langfusePublicKey,
    langfuseSecretKey: keys.langfuseSecretKey
  });
}

function buildMessages(question, elementMap, url, title) {
  const mapString = elementMap
    .map(e => `[${e.id}] ${e.label} (${e.tag}) at (${e.x}, ${e.y})`)
    .join('\n');

  const siteContext = url || title
    ? `Site context:\n  URL: ${url || 'unknown'}\n  Title: ${title || 'unknown'}\n`
    : '';

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
    { role: 'system', content: systemPrompt + '\n' + siteContext },
    ...history,
    { role: 'user', content: `Page elements:\n${mapString}\n\nUser question: ${question}` }
  ];
}

async function queryDeepSeek(question, elementMap, keys, url, title) {
  if (!keys.deepseekKey) {
    throw new Error('No DeepSeek API key. Click the gear icon to add it.');
  }

  const messages = buildMessages(question, elementMap, url, title);

  return new Promise((resolve, reject) => {
    api.runtime.sendMessage({
      type: 'DEEPSEEK_QUERY',
      messages,
      deepseekKey: keys.deepseekKey
    }, response => {
      if (!response) {
        reject(new Error('Background script not responding. Reload the extension.'));
        return;
      }
      if (!response.success) {
        reject(new Error(response.error));
        return;
      }
      resolve(response.result);
    });
  });
}

async function getActiveTab() {
  return new Promise(resolve => {
    api.tabs.query({ active: true, currentWindow: true }, tabs => resolve(tabs[0]));
  });
}

let currentPageUrl = '';
let currentPageTitle = '';

async function getElementsFromPage() {
  return new Promise(async resolve => {
    const tab = await getActiveTab();
    api.tabs.sendMessage(tab.id, { type: 'GET_ELEMENTS' }, response => {
      if (response && response.elementMap) {
        currentPageUrl = response.url || '';
        currentPageTitle = response.title || '';
        resolve(response.elementMap);
      } else {
        resolve(response);
      }
    });
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

async function resetCharacterOnPage() {
  const tab = await getActiveTab();
  api.tabs.sendMessage(tab.id, { type: 'RESET_CHARACTER' });
}

async function walkHomeOnPage() {
  return new Promise(async resolve => {
    const tab = await getActiveTab();
    api.tabs.sendMessage(tab.id, { type: 'WALK_HOME' }, resolve);
  });
}

let history = [];
let walkResolve = null;
let walkActive = false;
let walkTimeoutId = null;
let walkClickListener = null;
let lastMidFlowMsg = 0;

function showWalkControls() {
  const row = document.getElementById('walk-row');
  if (row) row.style.display = 'flex';
  walkActive = true;
  document.getElementById('user-input').disabled = true;
  document.getElementById('send-btn').disabled = true;
}

function hideWalkControls() {
  const row = document.getElementById('walk-row');
  if (row) row.style.display = 'none';
  walkActive = false;
  document.getElementById('user-input').disabled = false;
  document.getElementById('send-btn').disabled = false;
  focusInput();
}

function advanceStep() {
  console.log('[Staple Step] advanceStep - manual advance triggered');
  if (walkResolve) {
    walkResolve('manual_advance');
  } else {
    console.log('[Staple Step] advanceStep - walkResolve is null, nothing to advance');
  }
}

function addMessage(text, role) {
  const container = document.getElementById('chat-container');
  const msg = document.createElement('div');
  msg.className = role === 'user' ? 'msg-user' : 'msg-buddy';
  msg.innerText = text;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
  return msg;
}

async function walkSteps(steps, elementMap) {
  console.log('[Staple Step] walkSteps starting with', steps.length, 'steps');
  api.storage.local.set({ activeSteps: steps, activeStepIndex: 0, elementMap });
  showWalkControls();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    console.log('[Staple Step] walkSteps - step', i + 1, 'of', steps.length, ':', step.instruction, 'elementId:', step.elementId);
    api.storage.local.set({ activeStepIndex: i });

    const stepLabel = steps.length > 1
      ? `Step ${i + 1} of ${steps.length}: ${step.instruction}`
      : step.instruction;
    addMessage(stepLabel, 'buddy');

    if (step.elementId !== null && step.elementId !== undefined) {
      console.log('[Staple Step] walkSteps - calling moveCharacterOnPage for elementId:', step.elementId);
      await moveCharacterOnPage(step.elementId);
      console.log('[Staple Step] walkSteps - calling showBubbleOnPage');
      await showBubbleOnPage(`(${i + 1}/${steps.length}) ${step.instruction}`);

      if (i < steps.length - 1) {
        console.log('[Staple Step] walkSteps - waiting for user interaction before step', i + 2);
        await waitForUserInteraction();
        console.log('[Staple Step] walkSteps - user interaction resolved, advancing to step', i + 2);
      }
    }
  }

  console.log('[Staple Step] walkSteps - all steps complete');
  await new Promise(r => setTimeout(r, 3000));
  addMessage('✅ All done!', 'buddy');
  api.storage.local.remove(['activeSteps', 'activeStepIndex', 'elementMap']);
  hideWalkControls();
  await walkHomeOnPage();
  await new Promise(r => setTimeout(r, 3000));
  await resetCharacterOnPage();
}

function waitForUserInteraction() {
  return new Promise(async (resolve) => {
    let resolved = false;
    let seconds = 8;

    const countdownMsg = addMessage(`Next step in ${seconds}s — or click Staple to advance now`, 'buddy');
    const countdownInterval = setInterval(() => {
      seconds--;
      if (seconds > 0 && countdownMsg.parentNode) {
        countdownMsg.innerText = `Next step in ${seconds}s — or click Staple to advance now`;
      }
    }, 1000);

    function finish(reason) {
      if (resolved) return;
      resolved = true;
      clearInterval(countdownInterval);
      if (countdownMsg && countdownMsg.parentNode) countdownMsg.remove();
      if (walkTimeoutId) { clearTimeout(walkTimeoutId); walkTimeoutId = null; }
      if (walkClickListener) {
        safeSession.onChanged.removeListener(walkClickListener);
        walkClickListener = null;
      }
      safeSession.remove(['staple_advance_click']);
      safeSession.remove(['staple_walk_active']);
      walkResolve = null;
      console.log('[Staple Step] waitForUserInteraction resolving - reason:', reason);
      resolve();
    }

    walkResolve = finish;

    walkTimeoutId = setTimeout(() => finish('auto'), 8000);

    walkClickListener = (changes) => {
      if (changes.staple_advance_click) {
        finish('click');
      }
    };
    safeSession.onChanged.addListener(walkClickListener);

    safeSession.set({ staple_walk_active: true });
  });
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
    console.log('[Staple Step] handleSend - got elementMap with', elementMap?.length, 'elements');
    if (!elementMap || elementMap.length === 0) {
      thinkingMsg.remove();
      addMessage("I couldn't read this page. Try refreshing.", 'buddy');
      return;
    }

    const result = await queryDeepSeek(question, elementMap, keys, currentPageUrl, currentPageTitle);
    console.log('[Staple Step] handleSend - DeepSeek result:', JSON.stringify(result).slice(0, 200));
    const traceId = crypto.randomUUID();
    const messages = buildMessages(question, elementMap, currentPageUrl, currentPageTitle);
    logToLangfuse(traceId, messages, result, keys);

    if (!result.steps && result.elementId !== undefined) {
      result.steps = [{ elementId: result.elementId, instruction: result.instruction || 'Here it is.' }];
    }

    thinkingMsg.remove();
    if (result.summary) addMessage(result.summary, 'buddy');

    history.push({ role: 'user', content: question });
    const assistantText = result.summary || (result.steps && result.steps.map(s => s.instruction).join('. ')) || 'Done.';
    history.push({ role: 'assistant', content: assistantText });
    await saveHistory(history);

    if (result.steps && result.steps.length > 0) {
      console.log('[Staple Step] handleSend -', result.steps.length, 'steps returned by DeepSeek, starting walkSteps');
      await walkSteps(result.steps, elementMap);
    } else {
      const catMessages = [
        'Meow... I looked everywhere but could not find that. Mrrp.',
        'Mrrrow, this page is a mystery to me. Purr...',
        'Nyaa~ I searched high and low, but nothing matched. Meow.',
        'Mew... your request is too elusive for this kitty. Mrrow.'
      ];
      addMessage(catMessages[Math.floor(Math.random() * catMessages.length)], 'buddy');
    }

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
  document.getElementById('user-input').onkeydown = e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (walkActive) { advanceStep(); }
      else { handleSend(); }
    }
  };
  document.getElementById('gear-btn').onclick = showSettings;
  document.getElementById('back-btn').onclick = showChat;
  document.getElementById('save-btn').onclick = handleSaveKeys;
  document.getElementById('walk-next-btn').onclick = advanceStep;
  focusInput();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindEvents);
} else {
  bindEvents();
}

(async () => {
  history = await loadHistory();
  if (history.length > 0) {
    addMessage('Welcome back! I remember our last conversation.', 'buddy');
  }
})();

api.runtime.onMessage.addListener(msg => {
  if (msg.type === 'PAGE_CHANGED_MID_FLOW') {
    const now = Date.now();
    if (now - lastMidFlowMsg < 5000) {
      console.log('[Staple Step] popup - suppressing duplicate PAGE_CHANGED_MID_FLOW');
      return;
    }
    lastMidFlowMsg = now;
    console.log('[Staple Step] popup received PAGE_CHANGED_MID_FLOW', msg);
    addMessage('Page changed — continuing where we left off.', 'buddy');
    if (msg.summary) addMessage(msg.summary, 'buddy');
  }
});

window.addEventListener('beforeunload', () => {
  if (walkTimeoutId) { clearTimeout(walkTimeoutId); walkTimeoutId = null; }
  if (walkClickListener) {
    safeSession.onChanged.removeListener(walkClickListener);
    walkClickListener = null;
  }
  if (walkResolve) { walkResolve('popup_closed'); walkResolve = null; }
  safeSession.remove(['staple_advance_click']);
  safeSession.remove(['staple_walk_active']);
});
