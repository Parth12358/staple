const api = typeof browser !== 'undefined' ? browser : chrome;

let elementMap = [];

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
  console.log('[Staple] Element map:', trimmed);
  return trimmed;
}

let observer = null;

function startObserver() {
  if (!document.body) return;
  if (observer) observer.disconnect();
  observer = new MutationObserver(() => {
    elementMap = scrapeElements();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function injectCharacter() {
  if (!document.body) return;
  if (document.getElementById('st-buddy')) return;

  const buddy = document.createElement('div');
  buddy.id = 'st-buddy';
  buddy.innerHTML = `
    <div id="st-body">
      <div id="st-eye-left"></div>
      <div id="st-eye-right"></div>
    </div>
  `;
  document.body.appendChild(buddy);

  const bubble = document.createElement('div');
  bubble.id = 'st-bubble';
  document.body.appendChild(bubble);
}

let currentHighlight = null;

function moveCharacter(x, y) {
  const buddy = document.getElementById('st-buddy');
  const bubble = document.getElementById('st-bubble');

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

  if (currentHighlight) currentHighlight.classList.remove('st-highlight');
  const target = document.elementFromPoint(x, y);
  if (target && target.id !== 'st-buddy' && target.id !== 'st-bubble') {
    target.classList.add('st-highlight');
    currentHighlight = target;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function showBubble(text) {
  const bubble = document.getElementById('st-bubble');
  bubble.style.display = 'block';
  bubble.innerText = text;
}

function setCharacterState(state) {
  const body = document.getElementById('st-body');
  if (!body) return;
  body.className = '';
  if (state === 'walking') body.classList.add('is-walking');
  if (state === 'thinking') body.classList.add('is-thinking');
}

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

function init() {
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', init);
    return;
  }
  injectCharacter();
  startObserver();
  elementMap = scrapeElements();
}

init();
