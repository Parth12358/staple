# ScreenBuddy — 3 Hour Build Plan
**Hackathon: Harness Engineering Hack | June 12, 2026**
**Submission Deadline: 4:30 PM**

---

## The Idea
A browser extension where an animated character lives on any webpage, reads the DOM, and guides you to any UI element when you ask in natural language. Built for developers navigating complex dashboards and dev tools.

## Differentiators vs Clicky.foo
- Browser extension — no OS install, works on Mac, Windows, Linux
- DOM-based — no screenshot inference, instant element location, zero latency
- DeepSeek — fast and dirt cheap inference
- Developer-first — understands GitHub, Vercel, AWS, Linear out of the box
- Works on both Chrome and Firefox
- OpenUI powers the chat interface — dynamic generative UI not a plain input box
- Langfuse tracks every prompt and response in real time

## Sponsor Targets
| Sponsor | Prize | How |
|---|---|---|
| **Guild.ai** | $2,800 | Autonomous agent navigating real UI in real time |
| **OpenUI** | $2,000 | Chat interface is fully generative UI powered by OpenUI |
| **Langfuse** | $350 | Every DeepSeek prompt and response logged and observed |
| **Total** | **$5,150** | |

---

## Cross-Browser Strategy
One codebase, two manifests. WebExtensions API works on both.
- Chrome: Manifest V3
- Firefox: Manifest V2
- Shared `src/` folder, `build.sh` copies into each

---

## File Structure
```
screenbuddy/
├── src/
│   ├── content.js         # DOM scraper + character + DeepSeek + Langfuse
│   ├── content.css        # Character and UI styles
│   ├── background.js      # API proxy (keeps keys safe)
│   └── popup.html         # OpenUI powered chat interface
├── chrome/
│   └── manifest.json      # Chrome MV3
├── firefox/
│   └── manifest.json      # Firefox MV2
├── icons/
│   └── icon.png
└── build.sh
```

---

## Hour 1 — Extension Shell + DOM Parser
**Clock: Start → 1:00 PM**
**Goal: Extension loads on Chrome and Firefox, scrapes DOM, character injected**

### chrome/manifest.json (MV3)
```json
{
  "manifest_version": 3,
  "name": "ScreenBuddy",
  "version": "1.0",
  "description": "AI that walks you through any UI",
  "permissions": ["activeTab", "scripting", "storage"],
  "host_permissions": ["<all_urls>"],
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content.js"],
    "css": ["content.css"],
    "run_at": "document_idle"
  }],
  "background": { "service_worker": "background.js" },
  "action": { "default_popup": "popup.html" }
}
```

### firefox/manifest.json (MV2)
```json
{
  "manifest_version": 2,
  "name": "ScreenBuddy",
  "version": "1.0",
  "description": "AI that walks you through any UI",
  "permissions": ["activeTab", "storage", "<all_urls>"],
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content.js"],
    "css": ["content.css"],
    "run_at": "document_idle"
  }],
  "background": { "scripts": ["background.js"], "persistent": false },
  "browser_action": { "default_popup": "popup.html" },
  "browser_specific_settings": {
    "gecko": { "id": "screenbuddy@hack", "strict_min_version": "109.0" }
  }
}
```

### build.sh
```bash
#!/bin/bash
for f in content.js content.css background.js popup.html; do
  cp src/$f chrome/$f
  cp src/$f firefox/$f
done
echo "Built for Chrome and Firefox"
```

### DOM Scraper (src/content.js)
```javascript
const api = typeof browser !== 'undefined' ? browser : chrome;

let elementMap = [];

function scrapeElements() {
  const selectors = 'button, a, input, select, [role="button"], [role="link"], [role="menuitem"], [role="tab"], nav *, header *';
  const elements = document.querySelectorAll(selectors);
  const map = [];

  elements.forEach((el, i) => {
    const rect = el.getBoundingClientRect();
    const label = el.innerText?.trim()
      || el.getAttribute('aria-label')
      || el.getAttribute('placeholder')
      || el.getAttribute('title')
      || el.tagName;
    if (rect.width > 0 && rect.height > 0 && label) {
      map.push({
        id: i,
        label: label.slice(0, 80),
        tag: el.tagName,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      });
    }
  });

  return map.slice(0, 150);
}

// Re-scrape on SPA navigation
const observer = new MutationObserver(() => { elementMap = scrapeElements(); });
observer.observe(document.body, { childList: true, subtree: true });

// Inject character into page
function injectCharacter() {
  if (document.getElementById('sb-buddy')) return;
  const el = document.createElement('div');
  el.id = 'sb-buddy';
  el.innerText = '👾';
  document.body.appendChild(el);

  const bubble = document.createElement('div');
  bubble.id = 'sb-bubble';
  document.body.appendChild(bubble);
}

injectCharacter();
elementMap = scrapeElements();
```

### Checkpoint ✓
- Loads on Chrome and Firefox
- Character 👾 visible on page
- Element map logged to console

---

## Hour 2 — DeepSeek + Langfuse + OpenUI Chat
**Clock: 1:00 PM → 2:30 PM**
**Goal: OpenUI chat sends queries, DeepSeek responds, Langfuse logs everything, character moves**

### OpenUI Chat Interface (src/popup.html)
```html
<!DOCTYPE html>
<html>
<head>
  <script type="module" src="https://cdn.jsdelivr.net/npm/@openui/runtime@latest/dist/openui.min.js"></script>
  <style>
    body { width: 320px; height: 480px; margin: 0; font-family: sans-serif; background: #0f0f0f; color: white; }
    #chat-container { height: 400px; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
    #input-row { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #222; }
    #user-input { flex: 1; background: #1a1a1a; border: 1px solid #333; border-radius: 20px; padding: 8px 14px; color: white; font-size: 13px; outline: none; }
    #send-btn { background: #6366f1; border: none; border-radius: 50%; width: 36px; height: 36px; color: white; cursor: pointer; font-size: 16px; }
    .msg-user { background: #6366f1; border-radius: 12px 12px 2px 12px; padding: 8px 12px; font-size: 13px; align-self: flex-end; max-width: 80%; }
    .msg-buddy { background: #1a1a1a; border: 1px solid #333; border-radius: 12px 12px 12px 2px; padding: 8px 12px; font-size: 13px; align-self: flex-start; max-width: 80%; }
  </style>
</head>
<body>
  <div id="chat-container"></div>
  <div id="input-row">
    <input id="user-input" placeholder="Ask ScreenBuddy..." />
    <button id="send-btn">→</button>
  </div>
  <script src="popup.js"></script>
</body>
</html>
```

### OpenUI + DeepSeek + Langfuse (src/popup.js)
```javascript
const DEEPSEEK_KEY = 'your_deepseek_key';
const LANGFUSE_PUBLIC_KEY = 'your_langfuse_public_key';
const LANGFUSE_SECRET_KEY = 'your_langfuse_secret_key';
const LANGFUSE_HOST = 'https://cloud.langfuse.com';

let history = [];

// Langfuse logging
async function logToLangfuse(traceId, input, output, model) {
  await fetch(`${LANGFUSE_HOST}/api/public/ingestion`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Basic ' + btoa(`${LANGFUSE_PUBLIC_KEY}:${LANGFUSE_SECRET_KEY}`)
    },
    body: JSON.stringify({
      batch: [{
        type: 'generation',
        body: {
          traceId,
          name: 'screenbuddy-query',
          model,
          input,
          output,
          startTime: new Date().toISOString()
        }
      }]
    })
  });
}

// Query DeepSeek
async function queryDeepSeek(question, elementMap) {
  const mapString = elementMap
    .map(e => `[${e.id}] ${e.label} (${e.tag}) at (${Math.round(e.x)}, ${Math.round(e.y)})`)
    .join('\n');

  const systemPrompt = `You are ScreenBuddy, an AI navigation assistant in a browser extension.
Given a map of UI elements on the current page, identify which element the user wants and give clear instructions.
Respond in JSON only:
{
  "elementId": <number or null>,
  "instruction": "<clear instruction>",
  "followUp": "<next step if needed>"
}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: `Page elements:\n${mapString}\n\nQuestion: ${question}` }
  ];

  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_KEY}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages,
      response_format: { type: 'json_object' }
    })
  });

  const data = await response.json();
  const result = JSON.parse(data.choices[0].message.content);

  // Log to Langfuse
  const traceId = crypto.randomUUID();
  await logToLangfuse(traceId, messages, result, 'deepseek-chat');

  return result;
}

// Send message to content script to move character
async function moveCharacterOnPage(elementId) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { type: 'MOVE_CHARACTER', elementId });
}

// UI handlers
function addMessage(text, role) {
  const container = document.getElementById('chat-container');
  const msg = document.createElement('div');
  msg.className = role === 'user' ? 'msg-user' : 'msg-buddy';
  msg.innerText = text;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

async function handleSend() {
  const input = document.getElementById('user-input');
  const question = input.value.trim();
  if (!question) return;
  input.value = '';

  addMessage(question, 'user');
  addMessage('Thinking...', 'buddy');

  // Get element map from content script
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { type: 'GET_ELEMENTS' }, async (elementMap) => {
    const result = await queryDeepSeek(question, elementMap);

    // Remove thinking bubble
    const msgs = document.querySelectorAll('.msg-buddy');
    msgs[msgs.length - 1].remove();

    addMessage(result.instruction, 'buddy');
    if (result.followUp) addMessage(result.followUp, 'buddy');

    history.push({ role: 'user', content: question });
    history.push({ role: 'assistant', content: JSON.stringify(result) });

    if (result.elementId !== null) moveCharacterOnPage(result.elementId);
  });
}

document.getElementById('send-btn').onclick = handleSend;
document.getElementById('user-input').onkeydown = e => e.key === 'Enter' && handleSend();
```

### Message Handler in content.js
```javascript
// Listen for messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_ELEMENTS') {
    sendResponse(elementMap);
  }
  if (msg.type === 'MOVE_CHARACTER') {
    const target = elementMap.find(e => e.id === msg.elementId);
    if (target) moveCharacter(target.x, target.y);
  }
  return true;
});
```

### Checkpoint ✓
- Popup opens with dark chat UI
- User types question, DeepSeek responds
- Character moves to correct element on page
- Langfuse dashboard shows every query logged

---

## Hour 3 — Character Animation + Polish + Demo
**Clock: 2:30 PM → 3:30 PM**
**Leave 1 hour for video recording and Devpost submission**

### Character Animation (src/content.css)
```css
#sb-buddy {
  position: fixed;
  font-size: 28px;
  bottom: 80px;
  right: 20px;
  transition: left 0.6s cubic-bezier(0.34, 1.56, 0.64, 1),
              top 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
  z-index: 999999;
  cursor: pointer;
  filter: drop-shadow(0 4px 12px rgba(99,102,241,0.5));
}

#sb-bubble {
  position: fixed;
  background: white;
  border: 2px solid #6366f1;
  border-radius: 12px;
  padding: 10px 14px;
  max-width: 260px;
  font-size: 13px;
  line-height: 1.5;
  box-shadow: 0 4px 20px rgba(0,0,0,0.15);
  display: none;
  z-index: 999999;
}

.sb-highlight {
  outline: 3px solid #6366f1 !important;
  outline-offset: 3px !important;
  border-radius: 4px;
}
```

### Character Movement (src/content.js)
```javascript
let currentHighlight = null;

function moveCharacter(x, y) {
  const buddy = document.getElementById('sb-buddy');
  const bubble = document.getElementById('sb-bubble');

  buddy.style.position = 'fixed';
  buddy.style.left = `${x - 14}px`;
  buddy.style.top = `${y - 60}px`;
  buddy.style.bottom = 'auto';
  buddy.style.right = 'auto';

  bubble.style.display = 'block';
  bubble.style.left = `${Math.min(x, window.innerWidth - 280)}px`;
  bubble.style.top = `${y - 130}px`;
  bubble.style.bottom = 'auto';

  if (currentHighlight) currentHighlight.classList.remove('sb-highlight');
  const target = document.elementFromPoint(x, y);
  if (target) {
    target.classList.add('sb-highlight');
    currentHighlight = target;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}
```

### Checkpoint ✓
- Character slides smoothly to element
- Highlight ring appears
- Works on GitHub, Vercel, Linear

---

## OPTIONAL — Animated Pet (Only if ahead of schedule)
**Do this last, after everything else works**

Replace the 👾 emoji with a simple CSS animated creature with personality.

### What It Looks Like
- Small round body with eyes
- Idle animation — bobs up and down gently
- Walking animation — squishes horizontally when moving
- Thinking animation — eyes spin when waiting for DeepSeek
- Pointing animation — arm extends toward target element

### CSS Animation (add to content.css)
```css
#sb-buddy {
  position: fixed;
  width: 44px;
  height: 44px;
  z-index: 999999;
  transition: left 0.6s cubic-bezier(0.34, 1.56, 0.64, 1),
              top 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
}

#sb-body {
  width: 44px;
  height: 44px;
  background: #6366f1;
  border-radius: 50%;
  position: relative;
  animation: idle-bob 2s ease-in-out infinite;
}

#sb-eye-left, #sb-eye-right {
  width: 8px;
  height: 8px;
  background: white;
  border-radius: 50%;
  position: absolute;
  top: 14px;
}
#sb-eye-left { left: 10px; }
#sb-eye-right { right: 10px; }

@keyframes idle-bob {
  0%, 100% { transform: translateY(0px) scaleX(1); }
  50% { transform: translateY(-4px) scaleX(1.05); }
}

@keyframes walking {
  0%, 100% { transform: scaleX(1.1) scaleY(0.9); }
  50% { transform: scaleX(0.9) scaleY(1.1); }
}

@keyframes thinking {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

#sb-body.is-walking { animation: walking 0.3s ease-in-out infinite; }
#sb-body.is-thinking { animation: thinking 0.8s linear infinite; }
```

### HTML Structure (inject in content.js)
```javascript
function injectCharacter() {
  if (document.getElementById('sb-buddy')) return;
  const buddy = document.createElement('div');
  buddy.id = 'sb-buddy';
  buddy.innerHTML = `
    <div id="sb-body">
      <div id="sb-eye-left"></div>
      <div id="sb-eye-right"></div>
    </div>
  `;
  document.body.appendChild(buddy);
  const bubble = document.createElement('div');
  bubble.id = 'sb-bubble';
  document.body.appendChild(bubble);
}
```

### State Switching
```javascript
function setCharacterState(state) {
  const body = document.getElementById('sb-body');
  body.className = '';
  if (state === 'walking') body.classList.add('is-walking');
  if (state === 'thinking') body.classList.add('is-thinking');
  // idle = no class, default bob animation runs
}

// Call these at the right moments
// setCharacterState('thinking') — when waiting for DeepSeek
// setCharacterState('walking') — when moving to element
// setCharacterState('idle') — when done
```

### Time Estimate
- 20 minutes if CSS is clean
- Skip entirely if behind schedule — emoji fallback works fine for demo

---

## Demo Script (3 Minutes)
| Time | Action |
|---|---|
| 0:00 | "I constantly have to ask AI where things are in dev dashboards. It kills flow." |
| 0:20 | Open GitHub in Chrome, show 👾 sitting in corner |
| 0:35 | Open popup — show OpenUI powered dark chat interface |
| 0:45 | Ask: "where do I create a new repo" — character walks to button |
| 1:10 | Ask: "how do I invite a collaborator" — step by step |
| 1:35 | Switch to Firefox — same extension, same experience |
| 1:50 | Open Vercel, ask "where are my environment variables" |
| 2:10 | Show Langfuse dashboard — every query logged live |
| 2:30 | "DOM-based. No screenshots. Instant. Fractions of a cent per query." |
| 2:45 | GitHub repo + Devpost link |

---

## Submission Checklist
- [ ] 3 minute demo video recorded
- [ ] Public GitHub repo with chrome/ and firefox/ folders
- [ ] Devpost submission filled out
- [ ] Guild.ai angle — autonomous agent written up
- [ ] OpenUI angle — generative chat UI written up
- [ ] Langfuse angle — observability written up
- [ ] Chrome and Firefox both shown in demo

---

## Risk Log
| Risk | Mitigation |
|---|---|
| OpenUI CDN not loading in popup | Fall back to plain styled HTML chat |
| Langfuse logs failing | Skip silently, not critical to demo |
| DeepSeek slow | Cap element map at 150 items |
| SPA elements missing | MutationObserver handles it |
| Character wrong position | Fallback to scrollIntoView |
| Firefox CSP blocks fetch | Move API calls to background.js |
| Demo breaks live | Pre-record clean backup video |

---

## Cost Pitch
- DeepSeek: ~$0.000003 per query
- 1M queries/day = $3
- Langfuse: free tier
- OpenUI: open source
- Total infra cost: essentially zero
