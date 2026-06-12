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

// SPA navigation detection: intercept pushState/replaceState and popstate
(function installSpaNavigation() {
  function onUrlChange() {
    setTimeout(async () => {
      console.log('[Staple Step] URL change detected:', window.location.href);
      elementMap = scrapeElements();
      const stored = await new Promise(resolve => {
        api.storage.local.get(['activeSteps', 'activeStepIndex'], resolve);
      });
      if (stored.activeSteps && stored.activeSteps.length > 0) {
        console.log('[Staple Step] active task mid-flow on URL change, sending PAGE_CHANGED_MID_FLOW');
        const runtime = typeof browser !== 'undefined' ? browser.runtime : chrome.runtime;
        runtime.sendMessage({
          type: 'PAGE_CHANGED_MID_FLOW',
          elementMap,
          url: window.location.href,
          activeSteps: stored.activeSteps,
          activeStepIndex: stored.activeStepIndex || 0
        }, () => {});
      }
    }, 1500);
  }

  const originalPushState = history.pushState.bind(history);
  history.pushState = function(...args) {
    originalPushState(...args);
    window.dispatchEvent(new Event('staple:urlchange'));
  };

  const originalReplaceState = history.replaceState.bind(history);
  history.replaceState = function(...args) {
    originalReplaceState(...args);
    window.dispatchEvent(new Event('staple:urlchange'));
  };

  window.addEventListener('popstate', () => {
    window.dispatchEvent(new Event('staple:urlchange'));
  });

  window.addEventListener('staple:urlchange', onUrlChange);
})();

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
  buddy.addEventListener('click', handleBuddyClick);
  document.body.appendChild(buddy);

  const bubble = document.createElement('div');
  bubble.id = 'st-bubble';
  document.body.appendChild(bubble);

  document.addEventListener('click', e => {
    const box = document.getElementById('st-inline-box');
    if (box && box.style.display !== 'none') {
      if (!box.contains(e.target) && e.target.id !== 'st-buddy' && !document.getElementById('st-buddy').contains(e.target)) {
        hideInlineBox();
      }
    }
  });
}

let currentHighlight = null;
let watchTarget = null;

function removeHoverZone() {
  const existing = document.getElementById('sb-hover-zone');
  if (existing) existing.remove();
}

function createHoverZone(el, onEnter) {
  removeHoverZone();
  const rect = el.getBoundingClientRect();
  const pad = 40;
  const zone = document.createElement('div');
  zone.id = 'sb-hover-zone';
  zone.style.cssText = `
    position: fixed;
    left: ${rect.left - pad}px;
    top: ${rect.top - pad}px;
    width: ${rect.width + pad * 2}px;
    height: ${rect.height + pad * 2}px;
    z-index: 2147483646;
    pointer-events: all;
    background: transparent;
  `;
  zone.addEventListener('mouseenter', onEnter);
  document.body.appendChild(zone);
  console.log('[Staple Step] hover zone created at', rect.left - pad, rect.top - pad, 'size', rect.width + pad * 2, 'x', rect.height + pad * 2);
  return zone;
}

function moveCharacter(x, y) {
  const buddy = document.getElementById('st-buddy');
  const bubble = document.getElementById('st-bubble');

  console.log('[Staple Step] moveCharacter to (', x, ',', y, ')');

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

  // Scroll to approximate location first, then find element after scroll settles
  let target = document.elementFromPoint(x, y);
  console.log('[Staple Step] moveCharacter elementFromPoint returned:', target?.tagName, target?.className || target?.id || '');
  if (target && target.id !== 'st-buddy' && target.id !== 'st-bubble') {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('st-highlight');
    currentHighlight = target;
    watchTarget = target;
  }
}

function showBubble(text) {
  const bubble = document.getElementById('st-bubble');
  bubble.style.display = 'block';
  bubble.innerText = text;
}

let inlineSteps = [];
let inlineStepIndex = 0;
let inlineAdvanceResolve = null;

function inlineWaitForAdvance() {
  return new Promise(resolve => {
    inlineAdvanceResolve = resolve;
  });
}

function handleBuddyClick(e) {
  e.stopPropagation();
  if (inlineAdvanceResolve) {
    inlineAdvanceResolve();
    inlineAdvanceResolve = null;
    return;
  }
  const box = document.getElementById('st-inline-box');
  if (box && box.style.display !== 'none') {
    hideInlineBox();
    return;
  }
  showInlineBox();
}

function showInlineBox() {
  let box = document.getElementById('st-inline-box');
  let isNew = false;
  if (!box) {
    isNew = true;
    box = document.createElement('div');
    box.id = 'st-inline-box';
    box.innerHTML = `
      <textarea id="st-inline-input" placeholder="Ask Staple..." rows="1"></textarea>
      <button id="st-inline-send">&rarr;</button>
    `;
    document.body.appendChild(box);

    const input = document.getElementById('st-inline-input');
    const sendBtn = document.getElementById('st-inline-send');

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleInlineSubmit();
      }
      if (e.key === 'Escape') {
        hideInlineBox();
      }
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
    sendBtn.addEventListener('click', handleInlineSubmit);
  }

  const buddy = document.getElementById('st-buddy');
  const buddyRect = buddy.getBoundingClientRect();
  const isRightHalf = buddyRect.left > window.innerWidth / 2;

  box.style.top = '';
  box.style.left = '';
  box.style.right = '';
  box.style.bottom = '80px';

  if (isRightHalf) {
    box.style.left = '20px';
  } else {
    box.style.right = '20px';
  }

  box.style.display = 'flex';

  const input = document.getElementById('st-inline-input');
  if (isNew) {
    setTimeout(() => { if (input) input.focus(); }, 100);
  } else {
    if (input) input.focus();
  }
}

function hideInlineBox() {
  const box = document.getElementById('st-inline-box');
  if (box) {
    box.style.display = 'none';
  }
}

async function handleInlineSubmit() {
  const input = document.getElementById('st-inline-input');
  const question = input.value.trim();
  if (!question) return;

  input.value = '';
  input.style.height = 'auto';
  hideInlineBox();

  setCharacterState('thinking');
  showBubble('Thinking...');

  elementMap = scrapeElements();

  runtime.sendMessage({
    type: 'INLINE_QUERY',
    question,
    elementMap
  }, async response => {
    if (!response || !response.success) {
      showBubble(response?.error || 'Something went wrong.');
      setCharacterState('idle');
      return;
    }

    const result = response.result;

    if (!result.steps && result.elementId !== undefined) {
      result.steps = [{ elementId: result.elementId, instruction: result.instruction || 'Here it is.' }];
    }

    if (result.steps && result.steps.length > 0) {
      await executeInlineSteps(result.steps);
    } else {
      showBubble(result.summary || "Here's what I found.");
      setCharacterState('idle');
    }
  });
}

async function executeInlineSteps(steps) {
  inlineSteps = steps;
  inlineStepIndex = 0;
  api.storage.local.set({ activeSteps: steps, activeStepIndex: 0, elementMap });

  for (let i = 0; i < steps.length; i++) {
    inlineStepIndex = i;
    api.storage.local.set({ activeStepIndex: i });
    const step = steps[i];

    if (step.elementId !== null && step.elementId !== undefined) {
      const target = elementMap.find(e => e.id === step.elementId);
      if (target) {
        moveCharacter(target.x, target.y);
      }
      const label = steps.length > 1
        ? `(${i + 1}/${steps.length}) ${step.instruction}`
        : step.instruction;
      showBubble(label);
      setCharacterState('idle');

      if (i < steps.length - 1) {
        await inlineWaitForAdvance();
      }
    } else {
      showBubble(step.instruction);
    }
  }

  showBubble('✅ All done!');
  setTimeout(() => {
    const bubble = document.getElementById('st-bubble');
    bubble.style.display = 'none';
    resetCharacter();
  }, 3000);
  inlineSteps = [];
  inlineStepIndex = 0;
  api.storage.local.remove(['activeSteps', 'activeStepIndex', 'elementMap']);
}

function setCharacterState(state) {
  const body = document.getElementById('st-body');
  if (!body) return;
  body.className = '';
  if (state === 'walking') body.classList.add('is-walking');
  if (state === 'thinking') body.classList.add('is-thinking');
}

function resetCharacter() {
  const buddy = document.getElementById('st-buddy');
  const bubble = document.getElementById('st-bubble');
  if (!buddy) return;

  buddy.style.left = '';
  buddy.style.top = '';
  buddy.style.bottom = '80px';
  buddy.style.right = '20px';

  if (bubble) {
    bubble.style.display = 'none';
    bubble.style.left = '';
    bubble.style.top = '';
  }

  if (currentHighlight) {
    currentHighlight.classList.remove('st-highlight');
    currentHighlight = null;
  }
  watchTarget = null;
  removeHoverZone();

  setCharacterState('idle');
}

const STORAGE_KEY = 'staple_interaction';

async function handleWatchElement(msg) {
  console.log('[Staple Step] WATCH_ELEMENT received - elementId:', msg.elementId, 'delay:', msg.delay);

  // Prefer the direct DOM reference stored during moveCharacter (avoids stale coordinate lookups)
  let el = watchTarget;
  console.log('[Staple Step] WATCH_ELEMENT - watchTarget:', el?.tagName, el?.className || el?.id || '(none)');

  // Fallback: find by label scan if watchTarget is missing or stale
  if (!el || !document.body.contains(el)) {
    console.log('[Staple Step] WATCH_ELEMENT - watchTarget missing/stale, falling back to label scan');
    const mapTarget = elementMap.find(e => e.id === msg.elementId) ||
      (() => { elementMap = scrapeElements(); return elementMap.find(e => e.id === msg.elementId); })();

    if (mapTarget) {
      const allEls = document.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="switch"], nav *, header *');
      for (const candidate of allEls) {
        const rect = candidate.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const label = (
            candidate.innerText?.trim() ||
            candidate.getAttribute('aria-label') ||
            candidate.getAttribute('placeholder') ||
            candidate.getAttribute('title') ||
            candidate.getAttribute('alt') ||
            candidate.tagName
          );
          if (label && label.slice(0, 80) === mapTarget.label) {
            el = candidate;
            console.log('[Staple Step] WATCH_ELEMENT - found by label match:', el.tagName, label.slice(0, 40));
            break;
          }
        }
      }
    }
  }

  if (!el) {
    console.log('[Staple Step] WATCH_ELEMENT - element not found, aborting');
    return;
  }

  // Scroll into view and wait for layout to settle
  el.scrollIntoView({ behavior: 'instant', block: 'center' });
  await new Promise(r => setTimeout(r, 200));

  const rect = el.getBoundingClientRect();
  console.log('[Staple Step] WATCH_ELEMENT - element rect after scroll:', Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), 'x', Math.round(rect.height));

  let triggered = false;

  function trigger(event) {
    if (triggered) return;
    triggered = true;
    console.log('[Staple Step] WATCH_ELEMENT - trigger FIRED! event:', event.type, 'elementId:', msg.elementId);
    removeHoverZone();

    const delay = msg.delay || 2000;
    console.log('[Staple Step] WATCH_ELEMENT - waiting', delay, 'ms before signalling interaction');
    setTimeout(() => {
      const payload = { elementId: msg.elementId, timestamp: Date.now() };
      console.log('[Staple Step] WATCH_ELEMENT - writing to storage.session:', payload);
      api.storage.session.set({ [STORAGE_KEY]: payload }, () => {
        if (api.runtime.lastError) {
          console.log('[Staple Step] WATCH_ELEMENT - storage.session error:', api.runtime.lastError.message);
        } else {
          console.log('[Staple Step] WATCH_ELEMENT - storage.session write successful');
        }
      });
    }, delay);
  }

  // Attach listeners to the element and up to 3 ancestor levels to catch bubbled events
  const listenTargets = [el];
  let p = el.parentElement;
  for (let i = 0; i < 3 && p; i++, p = p.parentElement) {
    listenTargets.push(p);
  }
  listenTargets.forEach(t => {
    t.addEventListener('mouseenter', trigger);
    t.addEventListener('click', trigger);
  });
  console.log('[Staple Step] WATCH_ELEMENT - listeners attached to', listenTargets.length, 'targets (element + ancestors)');

  // Create a hover zone with 40px padding around the element for easier hover detection
  createHoverZone(el, trigger);
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
  if (msg.type === 'RESET_CHARACTER') {
    resetCharacter();
  }
  if (msg.type === 'WATCH_ELEMENT') {
    handleWatchElement(msg);
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

async function checkMidFlowResume() {
  const data = await new Promise(resolve => {
    api.storage.local.get(['activeSteps', 'activeStepIndex', 'conversationHistory'], resolve);
  });

  if (!data.activeSteps || !data.activeSteps.length) return;
  if (data.activeStepIndex >= data.activeSteps.length) return;

  await new Promise(r => setTimeout(r, 1500));

  elementMap = scrapeElements();

  runtime.sendMessage({
    type: 'PAGE_CHANGED_MID_FLOW',
    elementMap: elementMap,
    url: window.location.href,
    activeSteps: data.activeSteps,
    activeStepIndex: data.activeStepIndex
  }, async response => {
    if (response && response.success && response.result.steps) {
      if (response.result.steps.length > 0) {
        await executeInlineSteps(response.result.steps);
      } else if (response.result.summary) {
        showBubble(response.result.summary);
        setTimeout(() => {
          const bubble = document.getElementById('st-bubble');
          if (bubble) bubble.style.display = 'none';
          resetCharacter();
        }, 3000);
        api.storage.local.remove(['activeSteps', 'activeStepIndex', 'elementMap']);
      }
    } else {
      const step = data.activeSteps[data.activeStepIndex];
      const match = elementMap.find(e =>
        e.label.toLowerCase().includes(step.instruction.toLowerCase().slice(0, 10))
      );
      if (match) {
        moveCharacter(match.x, match.y);
        showBubble(`Continuing: ${step.instruction}`);
      }
    }
  });
}

checkMidFlowResume();
