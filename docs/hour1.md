# ScreenBuddy — Hour 1
**Goal: Extension loads on Chrome and Firefox, character injected, DOM scraped**

---

## File Structure to Create
```
screenbuddy/
├── src/
│   ├── content.js
│   ├── content.css
│   ├── background.js
│   └── popup.html
├── chrome/
│   └── manifest.json
├── firefox/
│   └── manifest.json
├── icons/
│   └── icon.png (any 128x128 image for now)
└── build.sh
```

---

## TODO

- [ ] Create folder structure above
- [ ] Create chrome/manifest.json
- [ ] Create firefox/manifest.json
- [ ] Create src/content.js
- [ ] Create src/content.css
- [ ] Create src/background.js
- [ ] Create src/popup.html
- [ ] Create build.sh
- [ ] Run build.sh
- [ ] Load chrome/ as unpacked extension in Chrome
- [ ] Load firefox/ as temporary extension in Firefox
- [ ] Open any website and confirm 👾 appears
- [ ] Open console and confirm element map is logged

---

## chrome/manifest.json
```json
{
  "manifest_version": 3,
  "name": "ScreenBuddy",
  "version": "1.0",
  "description": "AI that walks you through any UI",
  "permissions": ["activeTab", "scripting", "storage", "tabs"],
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

---

## firefox/manifest.json
```json
{
  "manifest_version": 2,
  "name": "ScreenBuddy",
  "version": "1.0",
  "description": "AI that walks you through any UI",
  "permissions": ["activeTab", "storage", "tabs", "<all_urls>"],
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

---

## src/content.js
```javascript
// Cross-browser shim
const api = typeof browser !== 'undefined' ? browser : chrome;

let elementMap = [];

// Scrape all interactive elements and their positions
function scrapeElements() {
  const selectors = [
    'button', 'a', 'input', 'select', 'textarea',
    '[role="button"]', '[role="link"]', '[role="menuitem"]',
    '[role="tab"]', '[role="checkbox"]', '[role="switch"]',
    'nav *', 'header *'
  ].join(', ');

  const elements = document.querySelectorAll(selectors);
  const map = [];

  elements.forEach((el, i) => {
    const rect = el.getBoundingClientRect();
    const label = (
      el.innerText?.trim() ||
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('title') ||
      el.getAttribute('alt') ||
      el.tagName
    );

    if (rect.width > 0 && rect.height > 0 && label && label.length > 0) {
      map.push({
        id: i,
        label: label.slice(0, 80),
        tag: el.tagName,
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2)
      });
    }
  });

  const trimmed = map.slice(0, 150);
  console.log('[ScreenBuddy] Element map:', trimmed);
  return trimmed;
}

// Re-scrape when page changes (SPAs like GitHub, Vercel, Linear)
const observer = new MutationObserver(() => {
  elementMap = scrapeElements();
});
observer.observe(document.body, { childList: true, subtree: true });

// Inject character and speech bubble into page
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

// Move character to coordinates and highlight element
let currentHighlight = null;

function moveCharacter(x, y) {
  const buddy = document.getElementById('sb-buddy');
  const bubble = document.getElementById('sb-bubble');

  setCharacterState('walking');

  buddy.style.position = 'fixed';
  buddy.style.left = `${x - 22}px`;
  buddy.style.top = `${y - 70}px`;
  buddy.style.bottom = 'auto';
  buddy.style.right = 'auto';

  bubble.style.left = `${Math.min(x, window.innerWidth - 280)}px`;
  bubble.style.top = `${y - 140}px`;
  bubble.style.bottom = 'auto';

  setTimeout(() => setCharacterState('idle'), 700);

  if (currentHighlight) currentHighlight.classList.remove('sb-highlight');
  const target = document.elementFromPoint(x, y);
  if (target && target.id !== 'sb-buddy' && target.id !== 'sb-bubble') {
    target.classList.add('sb-highlight');
    currentHighlight = target;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function showBubble(text) {
  const bubble = document.getElementById('sb-bubble');
  bubble.style.display = 'block';
  bubble.innerText = text;
}

// Character animation states
function setCharacterState(state) {
  const body = document.getElementById('sb-body');
  if (!body) return;
  body.className = '';
  if (state === 'walking') body.classList.add('is-walking');
  if (state === 'thinking') body.classList.add('is-thinking');
}

// Listen for messages from popup
const runtime = typeof browser !== 'undefined' ? browser.runtime : chrome.runtime;
runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_ELEMENTS') {
    elementMap = scrapeElements();
    sendResponse(elementMap);
  }
  if (msg.type === 'MOVE_CHARACTER') {
    const target = elementMap.find(e => e.id === msg.elementId);
    if (target) moveCharacter(target.x, target.y);
  }
  if (msg.type === 'SHOW_BUBBLE') {
    showBubble(msg.text);
  }
  if (msg.type === 'SET_STATE') {
    setCharacterState(msg.state);
  }
  return true;
});

// Init
injectCharacter();
elementMap = scrapeElements();
```

---

## src/content.css
```css
#sb-buddy {
  position: fixed;
  width: 44px;
  height: 44px;
  bottom: 80px;
  right: 20px;
  z-index: 2147483647;
  pointer-events: none;
  transition: left 0.6s cubic-bezier(0.34, 1.56, 0.64, 1),
              top 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
}

#sb-body {
  width: 44px;
  height: 44px;
  background: #6366f1;
  border-radius: 50%;
  position: relative;
  animation: sb-idle 2s ease-in-out infinite;
  box-shadow: 0 4px 20px rgba(99, 102, 241, 0.5);
}

#sb-eye-left,
#sb-eye-right {
  width: 8px;
  height: 8px;
  background: white;
  border-radius: 50%;
  position: absolute;
  top: 14px;
}
#sb-eye-left { left: 10px; }
#sb-eye-right { right: 10px; }

@keyframes sb-idle {
  0%, 100% { transform: translateY(0px) scaleX(1); }
  50% { transform: translateY(-5px) scaleX(1.05); }
}

@keyframes sb-walking {
  0%, 100% { transform: scaleX(1.15) scaleY(0.88); }
  50% { transform: scaleX(0.88) scaleY(1.15); }
}

@keyframes sb-thinking {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

#sb-body.is-walking { animation: sb-walking 0.25s ease-in-out infinite; }
#sb-body.is-thinking { animation: sb-thinking 0.7s linear infinite; }

#sb-bubble {
  position: fixed;
  background: #ffffff;
  border: 2px solid #6366f1;
  border-radius: 12px;
  padding: 10px 14px;
  max-width: 260px;
  font-size: 13px;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  line-height: 1.5;
  color: #111;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
  display: none;
  z-index: 2147483646;
  pointer-events: none;
}

.sb-highlight {
  outline: 3px solid #6366f1 !important;
  outline-offset: 3px !important;
  border-radius: 4px !important;
}
```

---

## src/background.js
```javascript
// Placeholder for now — API proxy will go here in Hour 2
console.log('[ScreenBuddy] Background script loaded');
```

---

## src/popup.html
```html
<!DOCTYPE html>
<html>
<head>
  <style>
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
    #sb-header {
      padding: 14px 16px;
      border-bottom: 1px solid #222;
      font-weight: 600;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
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
    .msg-user {
      background: #6366f1;
      border-radius: 12px 12px 2px 12px;
      padding: 8px 12px;
      font-size: 13px;
      align-self: flex-end;
      max-width: 80%;
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
    }
  </style>
</head>
<body>
  <div id="sb-header">👾 ScreenBuddy</div>
  <div id="chat-container">
    <div class="msg-buddy">Hey! Ask me where anything is on this page.</div>
  </div>
  <div id="input-row">
    <input id="user-input" placeholder="Ask ScreenBuddy..." />
    <button id="send-btn">→</button>
  </div>
  <script src="popup.js"></script>
</body>
</html>
```

---

## build.sh
```bash
#!/bin/bash
FILES="content.js content.css background.js popup.html"
for f in $FILES; do
  cp src/$f chrome/$f
  cp src/$f firefox/$f
done
echo "✅ Built for Chrome and Firefox"
```

---

## How to Load the Extension

### Chrome
1. Go to `chrome://extensions`
2. Enable **Developer Mode** top right
3. Click **Load unpacked**
4. Select the `chrome/` folder

### Firefox
1. Go to `about:debugging`
2. Click **This Firefox**
3. Click **Load Temporary Add-on**
4. Select `firefox/manifest.json`

---

## Checkpoint — Hour 1 Done When:
- [ ] 👾 appears bottom right on any website
- [ ] Console shows element map array
- [ ] Popup opens and shows chat UI
- [ ] No console errors

## Hour 2 starts here → DeepSeek + Langfuse + OpenUI
