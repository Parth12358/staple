// Fixes applied to this file:
// Fix 1: safeSession shim for Firefox (storage.session unavailable)
// Fix 2: MOVE_CHARACTER/SHOW_BUBBLE/SET_STATE handlers call sendResponse({ done: true })
// Fix 3: watchTarget removed from moveCharacter; handleWatchElement does definitive element lookup post-scroll
// Fix 4: silent abort replaced with failure signal written to safeSession
// Fix 5: static hover zone div replaced with proximity mousemove listener
// Fix 7: MutationObserver disconnected around Staple DOM insertions; Staple elements filtered from scrapeElements
// Fix 8: checkMidFlowResume checks staple_walk_owner before launching inline resume

const api = typeof browser !== 'undefined' ? browser : chrome;

// Fix 1: safeSession shim — falls back to storage.local on Firefox where storage.session is unavailable
const safeSession = {
  get: (keys) => new Promise(resolve => {
    try {
      (api.storage.session || api.storage.local).get(keys, resolve);
    } catch(e) { resolve({}); }
  }),
  set: (data) => new Promise(resolve => {
    try {
      (api.storage.session || api.storage.local).set(data, resolve);
    } catch(e) { resolve(); }
  }),
  remove: (keys) => new Promise(resolve => {
    try {
      (api.storage.session || api.storage.local).remove(keys, resolve);
    } catch(e) { resolve(); }
  })
};

let elementMap = [];

// Fix 7: Staple-owned element IDs used to filter scrapeElements and pause observer during insertions
const STAPLE_IDS = ['st-buddy', 'st-bubble', 'st-inline-box', 'sb-hover-zone'];

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
    // Fix 7: skip any element that is or lives inside a Staple-injected element
    if (el.closest(STAPLE_IDS.map(id => '#' + id).join(', '))) return;

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

// Fix 7: pause observer around a DOM insertion to prevent scrapeElements re-runs on Staple's own nodes
function withObserverPaused(fn) {
  if (observer) observer.disconnect();
  fn();
  if (observer && document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }
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

  // Fix 7: pause observer while injecting Staple's own DOM nodes
  withObserverPaused(() => {
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
  });

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

// Fix 5: proximity listener cleanup function stored here; called by removeHoverZone and resetCharacter
let proximityListenerCleanup = null;

// Fix 5: replace static hover zone div with a document-level mousemove proximity check
function removeHoverZone() {
  // Fix 5: remove old static div if it still exists from a previous session
  const existing = document.getElementById('sb-hover-zone');
  if (existing) existing.remove();

  // Fix 5: tear down the proximity listener
  if (proximityListenerCleanup) {
    proximityListenerCleanup();
    proximityListenerCleanup = null;
  }
}

// Fix 5: attach a mousemove listener that fires onTrigger when the cursor is within 40px of el
function attachProximityListener(el, onTrigger) {
  let triggered = false;
  function onMouseMove(e) {
    if (triggered) return;
    const rect = el.getBoundingClientRect();
    const inZone = (
      e.clientX >= rect.left - 40 &&
      e.clientX <= rect.right + 40 &&
      e.clientY >= rect.top - 40 &&
      e.clientY <= rect.bottom + 40
    );
    if (inZone) {
      triggered = true;
      document.removeEventListener('mousemove', onMouseMove);
      console.log('[Staple Step] proximity trigger fired for element', el.tagName, el.id || el.className);
      onTrigger();
    }
  }
  document.addEventListener('mousemove', onMouseMove);
  console.log('[Staple Step] proximity listener attached — 40px zone around', el.tagName, el.id || el.className);
  return () => document.removeEventListener('mousemove', onMouseMove);
}

// Fix 3: watchTarget removed — moveCharacter no longer sets it; handleWatchElement does its own definitive lookup
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

  // Fix 3: just apply the highlight visually; watchTarget is NOT set here
  let target = document.elementFromPoint(x, y);
  console.log('[Staple Step] moveCharacter elementFromPoint returned:', target?.tagName, target?.className || target?.id || '');
  if (target && !STAPLE_IDS.includes(target.id)) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('st-highlight');
    currentHighlight = target;
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
    // Fix 7: pause observer while injecting the inline box
    withObserverPaused(() => {
      box = document.createElement('div');
      box.id = 'st-inline-box';
      box.innerHTML = `
        <textarea id="st-inline-input" placeholder="Ask Staple..." rows="1"></textarea>
        <button id="st-inline-send">&rarr;</button>
      `;
      document.body.appendChild(box);
    });

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

  // Fix 5: clean up proximity listener on reset
  removeHoverZone();

  setCharacterState('idle');
}

const STORAGE_KEY = 'staple_interaction';

async function handleWatchElement(msg) {
  console.log('[Staple Step] WATCH_ELEMENT received - elementId:', msg.elementId, 'delay:', msg.delay);

  // Fix 3: do a fresh definitive element lookup here instead of relying on watchTarget from moveCharacter
  // First try finding by elementId in the current map
  let mapTarget = elementMap.find(e => e.id === msg.elementId);
  if (!mapTarget) {
    console.log('[Staple Step] WATCH_ELEMENT - elementId not in map, re-scraping');
    elementMap = scrapeElements();
    mapTarget = elementMap.find(e => e.id === msg.elementId);
  }

  let el = null;

  // Fix 3: scan DOM for the element by label match — more reliable than stale coordinate lookup
  if (mapTarget) {
    const allEls = document.querySelectorAll(
      'button, a, input, select, textarea, [role="button"], [role="link"], ' +
      '[role="menuitem"], [role="tab"], [role="checkbox"], [role="switch"], nav *, header *'
    );
    for (const candidate of allEls) {
      if (candidate.closest(STAPLE_IDS.map(id => '#' + id).join(', '))) continue;
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

  if (!el) {
    console.log('[Staple Step] WATCH_ELEMENT - element not found, writing failure signal');
    // Fix 4: write a failure signal so popup.js poll can detect it and advance rather than hanging
    await safeSession.set({
      [STORAGE_KEY]: { elementId: msg.elementId, timestamp: Date.now(), failed: true }
    });
    return;
  }

  // Fix 3: scroll the definitively-found element into view and wait for layout to settle
  el.scrollIntoView({ behavior: 'instant', block: 'center' });
  await new Promise(r => setTimeout(r, 200));

  // Fix 3: re-check rect after scroll so proximity zone is accurate
  const rect = el.getBoundingClientRect();
  console.log('[Staple Step] WATCH_ELEMENT - element rect after scroll:', Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), 'x', Math.round(rect.height));

  let triggered = false;

  function trigger() {
    if (triggered) return;
    triggered = true;
    console.log('[Staple Step] WATCH_ELEMENT - trigger FIRED! elementId:', msg.elementId);
    removeHoverZone();

    const delay = msg.delay || 2000;
    console.log('[Staple Step] WATCH_ELEMENT - waiting', delay, 'ms before signalling interaction');
    setTimeout(async () => {
      const payload = { elementId: msg.elementId, timestamp: Date.now() };
      console.log('[Staple Step] WATCH_ELEMENT - writing to safeSession:', payload);
      await safeSession.set({ [STORAGE_KEY]: payload });
      console.log('[Staple Step] WATCH_ELEMENT - safeSession write complete');
    }, delay);
  }

  // Attach click listener directly on the element and up to 3 ancestors
  const listenTargets = [el];
  let p = el.parentElement;
  for (let i = 0; i < 3 && p; i++, p = p.parentElement) {
    listenTargets.push(p);
  }
  listenTargets.forEach(t => {
    t.addEventListener('mouseenter', trigger);
    t.addEventListener('click', trigger);
  });
  console.log('[Staple Step] WATCH_ELEMENT - click+mouseenter listeners attached to', listenTargets.length, 'targets');

  // Fix 5: replace static hover zone with proximity mousemove listener
  removeHoverZone();
  proximityListenerCleanup = attachProximityListener(el, trigger);
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
    // Fix 2: signal completion so popup.js can await this before sending WATCH_ELEMENT
    sendResponse({ done: true });
  }
  if (msg.type === 'SHOW_BUBBLE') {
    showBubble(msg.text);
    // Fix 2: signal completion
    sendResponse({ done: true });
  }
  if (msg.type === 'SET_STATE') {
    setCharacterState(msg.state);
    // Fix 2: signal completion
    sendResponse({ done: true });
  }
  if (msg.type === 'RESET_CHARACTER') {
    resetCharacter();
    sendResponse({ done: true });
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
    api.storage.local.get(['activeSteps', 'activeStepIndex', 'conversationHistory', 'staple_walk_owner'], resolve);
  });

  if (!data.activeSteps || !data.activeSteps.length) return;
  if (data.activeStepIndex >= data.activeSteps.length) return;

  // Fix 8: if the popup owns the walk, do not start a competing inline resume
  if (data.staple_walk_owner === 'popup') {
    console.log('[Staple Step] checkMidFlowResume - walk owned by popup, skipping inline resume');
    return;
  }

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
