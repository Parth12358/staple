const api = typeof browser !== 'undefined' ? browser : chrome;
const safeSession = api.storage.session || api.storage.local;

let elementMap = [];
let midFlowSendGuard = false;

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
        if (midFlowSendGuard) { console.log('[Staple Step] midFlowSendGuard active, skipping duplicate PAGE_CHANGED_MID_FLOW'); return; }
        midFlowSendGuard = true;
        setTimeout(() => { midFlowSendGuard = false; }, 15000);
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

  const cat = document.createElement('div');
  cat.id = 'st-cat';
  cat.className = 'state-idle';
  cat.style.backgroundImage = `url('${api.runtime.getURL('cat_sprite.png')}')`;
  buddy.appendChild(cat);

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

  startIdleCleanTimer();
}

let idleCleanTimer = null;

function startIdleCleanTimer() {
  if (idleCleanTimer) clearTimeout(idleCleanTimer);
  scheduleCleanAnimation();
}

function scheduleCleanAnimation() {
  const delay = 15000 + Math.random() * 15000;
  idleCleanTimer = setTimeout(() => {
    const cat = document.getElementById('st-cat');
    if (cat && cat.className === 'state-idle') {
      setCharacterState('clean');
      cat.addEventListener('animationend', function onCleanEnd() {
        cat.removeEventListener('animationend', onCleanEnd);
        if (cat.className === 'state-clean') {
          setCharacterState('idle');
        }
      }, { once: true });
    }
    scheduleCleanAnimation();
  }, delay);
}

let currentHighlight = null;

let walkTransitionEndHandler = null;

function moveCharacter(x, y) {
  const buddy = document.getElementById('st-buddy');
  const bubble = document.getElementById('st-bubble');
  const cat = document.getElementById('st-cat');

  console.log('[Staple Step] moveCharacter to (', x, ',', y, ')');

  const buddyRect = buddy.getBoundingClientRect();
  const currentLeft = buddyRect.left;
  const currentTop = buddyRect.top;
  const currentCenterX = currentLeft + 40;
  const currentCenterY = currentTop + 40;

  // Cancel any in-progress walk: pin at current computed position
  buddy.style.transition = 'none';
  buddy.style.left = `${currentLeft}px`;
  buddy.style.top = `${currentTop}px`;
  buddy.style.bottom = 'auto';
  buddy.style.right = 'auto';
  void buddy.offsetHeight;

  // Set direction before transition starts
  if (x < currentCenterX) {
    cat.style.transform = 'scaleX(-1)';
  } else if (x > currentCenterX) {
    cat.style.transform = 'scaleX(1)';
  }

  setCharacterState('walking');

  // Calculate target position, distance, and transition duration
  const targetLeft = Math.max(5, Math.min(x - 40, window.innerWidth - 85));
  const targetTop = Math.max(5, Math.min(y - 90, window.innerHeight - 85));
  const targetCenterX = targetLeft + 40;
  const targetCenterY = targetTop + 40;
  const dx = targetCenterX - currentCenterX;
  const dy = targetCenterY - currentCenterY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const duration = Math.max(0.15, Math.min(distance / 300, 3.0));

  // Remove previous transitionend listener
  if (walkTransitionEndHandler) {
    buddy.removeEventListener('transitionend', walkTransitionEndHandler);
    walkTransitionEndHandler = null;
  }

  const walkDone = new Promise(resolve => {
    function onWalkEnd(e) {
      if (e.propertyName !== 'left' && e.propertyName !== 'top') return;
      buddy.removeEventListener('transitionend', onWalkEnd);
      if (walkTransitionEndHandler === onWalkEnd) walkTransitionEndHandler = null;
      setCharacterState('paw');
      setTimeout(resolve, 1000);
    }

    if (distance < 1) {
      setCharacterState('paw');
      setTimeout(resolve, 1000);
    } else {
      walkTransitionEndHandler = onWalkEnd;
      buddy.addEventListener('transitionend', onWalkEnd);
    }
  });

  buddy.style.position = 'fixed';
  buddy.style.transition = `left ${duration}s linear, top ${duration}s linear`;
  buddy.style.left = `${targetLeft}px`;
  buddy.style.top = `${targetTop}px`;

  bubble.style.left = `${Math.min(x, window.innerWidth - 280)}px`;
  bubble.style.top = `${Math.max(5, y - 140)}px`;
  bubble.style.bottom = 'auto';

  if (currentHighlight) currentHighlight.classList.remove('st-highlight');

  let target = document.elementFromPoint(x, y);
  console.log('[Staple Step] moveCharacter elementFromPoint returned:', target?.tagName, target?.className || target?.id || '');
  if (target && target.id !== 'st-buddy' && target.id !== 'st-bubble') {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('st-highlight');
    currentHighlight = target;
  }

  return walkDone;
}

function showBubble(text) {
  const bubble = document.getElementById('st-bubble');
  bubble.style.display = 'block';
  bubble.innerText = text;
}

async function walkHome() {
  const buddy = document.getElementById('st-buddy');
  const cat = document.getElementById('st-cat');
  if (!buddy) return;

  const targetLeft = window.innerWidth - 100;
  const targetTop = window.innerHeight - 160;
  const targetCenterX = targetLeft + 40;

  const buddyRect = buddy.getBoundingClientRect();
  const currentLeft = buddyRect.left;
  const currentTop = buddyRect.top;
  const currentCenterX = currentLeft + 40;
  const currentCenterY = currentTop + 40;

  const dx = targetCenterX - currentCenterX;
  const dy = targetTop + 40 - currentCenterY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const duration = Math.max(0.15, Math.min(distance / 300, 3.0));

  if (cat) cat.style.transform = 'scaleX(1)';

  setCharacterState('walking');

  buddy.style.transition = 'none';
  buddy.style.left = `${currentLeft}px`;
  buddy.style.top = `${currentTop}px`;
  buddy.style.bottom = 'auto';
  buddy.style.right = 'auto';
  void buddy.offsetHeight;

  if (walkTransitionEndHandler) {
    buddy.removeEventListener('transitionend', walkTransitionEndHandler);
    walkTransitionEndHandler = null;
  }

  return new Promise(resolve => {
    function onHomeEnd(e) {
      if (e.propertyName !== 'left' && e.propertyName !== 'top') return;
      buddy.removeEventListener('transitionend', onHomeEnd);
      if (walkTransitionEndHandler === onHomeEnd) walkTransitionEndHandler = null;
      setCharacterState('sleep');
      resolve();
    }

    if (distance < 1) {
      setCharacterState('sleep');
      resolve();
    } else {
      walkTransitionEndHandler = onHomeEnd;
      buddy.addEventListener('transitionend', onHomeEnd);
    }

    buddy.style.transition = `left ${duration}s linear, top ${duration}s linear`;
    buddy.style.left = `${targetLeft}px`;
    buddy.style.top = `${targetTop}px`;
  });
}

let inlineSteps = [];
let inlineStepIndex = 0;
let inlineAdvanceResolve = null;
let inlineTimeout = null;

function inlineWaitForAdvance() {
  return new Promise(resolve => {
    let resolved = false;
    function advance() {
      if (resolved) return;
      resolved = true;
      if (inlineTimeout) { clearTimeout(inlineTimeout); inlineTimeout = null; }
      inlineAdvanceResolve = null;
      resolve();
    }
    inlineAdvanceResolve = advance;
    inlineTimeout = setTimeout(advance, 8000);
  });
}

async function handleBuddyClick(e) {
  e.stopPropagation();
  if (inlineAdvanceResolve) {
    inlineAdvanceResolve();
    return;
  }
  const data = await new Promise(r => safeSession.get(['staple_walk_active'], r));
  if (data && data.staple_walk_active) {
    safeSession.set({ staple_advance_click: Date.now() });
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
  const buddyCenterX = buddyRect.left + 40;
  const isRightHalf = buddyCenterX > window.innerWidth / 2;

  box.style.top = '';
  box.style.bottom = '';
  box.style.left = '';
  box.style.right = '';

  if (isRightHalf) {
    box.style.right = `${window.innerWidth - buddyRect.right}px`;
  } else {
    box.style.left = `${buddyRect.left}px`;
  }

  const spaceAbove = buddyRect.top;
  if (spaceAbove >= 100) {
    box.style.bottom = `${window.innerHeight - buddyRect.top + 10}px`;
  } else {
    box.style.top = `${buddyRect.bottom + 10}px`;
  }

  const boxWidth = 260;
  const clampMargin = 5;
  if (isRightHalf) {
    const rightPx = parseInt(box.style.right) || 0;
    if (rightPx < clampMargin) box.style.right = `${clampMargin}px`;
    if (window.innerWidth - rightPx - boxWidth < 0) {
      box.style.right = `${window.innerWidth - boxWidth - clampMargin}px`;
    }
  } else {
    const leftPx = parseInt(box.style.left) || 0;
    if (leftPx < clampMargin) box.style.left = `${clampMargin}px`;
    if (leftPx + boxWidth > window.innerWidth - clampMargin) {
      box.style.left = `${window.innerWidth - boxWidth - clampMargin}px`;
    }
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
    elementMap,
    url: window.location.href,
    title: document.title
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
      const catMessages = [
        'Meow... I looked everywhere but could not find that. Mrrp.',
        'Mrrrow, this page is a mystery to me. Purr...',
        'Nyaa~ I searched high and low, but nothing matched. Meow.',
        'Mew... your request is too elusive for this kitty. Mrrow.'
      ];
      const buddy = document.getElementById('st-buddy');
      if (buddy) {
        const r = buddy.getBoundingClientRect();
        const bx = Math.min(r.left + 40, window.innerWidth - 280);
        const by = Math.max(5, r.top - 10);
        const bubble = document.getElementById('st-bubble');
        bubble.style.left = `${bx}px`;
        bubble.style.top = `${by}px`;
      }
      showBubble(catMessages[Math.floor(Math.random() * catMessages.length)]);
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
      let walkPromise = null;
      if (target) {
        walkPromise = moveCharacter(target.x, target.y);
      }
      const label = steps.length > 1
        ? `(${i + 1}/${steps.length}) ${step.instruction}`
        : step.instruction;
      showBubble(label);

      if (i < steps.length - 1) {
        await inlineWaitForAdvance();
      } else if (walkPromise) {
        await walkPromise;
      }
    } else {
      showBubble(step.instruction);
    }
  }

  showBubble('✅ All done!');
  await walkHome();
  setTimeout(() => {
    const bubble = document.getElementById('st-bubble');
    bubble.style.display = 'none';
    resetCharacter();
  }, 3000);
  inlineSteps = [];
  inlineStepIndex = 0;
  api.storage.local.remove(['activeSteps', 'activeStepIndex', 'elementMap']);
}

let idleSleepTimer = null;

function setCharacterState(state) {
  const cat = document.getElementById('st-cat');
  if (!cat) return;
  const stateMap = {
    idle: 'state-idle',
    walking: 'state-walking',
    thinking: 'state-thinking',
    paw: 'state-paw',
    sleep: 'state-sleep',
    clean: 'state-clean'
  };
  cat.className = stateMap[state] || 'state-idle';

  if (idleSleepTimer) { clearTimeout(idleSleepTimer); idleSleepTimer = null; }

  if (state === 'idle') {
    idleSleepTimer = setTimeout(() => {
      if (cat.className === 'state-idle') {
        if (idleCleanTimer) { clearTimeout(idleCleanTimer); idleCleanTimer = null; }
        cat.className = 'state-sleep';
      }
    }, 5000);
  }

  if (state === 'paw') {
    cat.addEventListener('animationend', function onPawEnd() {
      cat.removeEventListener('animationend', onPawEnd);
      if (cat.className === 'state-paw') {
        setCharacterState('idle');
      }
    }, { once: true });
  }
}

function resetCharacter() {
  const buddy = document.getElementById('st-buddy');
  const bubble = document.getElementById('st-bubble');
  const cat = document.getElementById('st-cat');
  if (!buddy) return;

  if (walkTransitionEndHandler) {
    buddy.removeEventListener('transitionend', walkTransitionEndHandler);
    walkTransitionEndHandler = null;
  }
  buddy.style.transition = '';
  buddy.style.left = '';
  buddy.style.top = '';
  buddy.style.bottom = '80px';
  buddy.style.right = '20px';

  if (cat) cat.style.transform = 'scaleX(1)';

  if (bubble) {
    bubble.style.display = 'none';
    bubble.style.left = '';
    bubble.style.top = '';
  }

  if (currentHighlight) {
    currentHighlight.classList.remove('st-highlight');
    currentHighlight = null;
  }

  setCharacterState('idle');
  startIdleCleanTimer();
}

const runtime = typeof browser !== 'undefined' ? browser.runtime : chrome.runtime;
runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_ELEMENTS') {
    elementMap = scrapeElements();
    sendResponse({ elementMap, url: window.location.href, title: document.title });
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
  if (msg.type === 'WALK_HOME') {
    walkHome().then(() => sendResponse(true));
    return true;
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

  if (midFlowSendGuard) { console.log('[Staple Step] checkMidFlowResume - guard active, skipping'); return; }
  midFlowSendGuard = true;
  setTimeout(() => { midFlowSendGuard = false; }, 15000);

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

window.addEventListener('resize', () => {
  const buddy = document.getElementById('st-buddy');
  if (!buddy || !buddy.style.left || !buddy.style.top) return;
  const buddyLeft = parseInt(buddy.style.left);
  const buddyTop = parseInt(buddy.style.top);
  if (isNaN(buddyLeft) || isNaN(buddyTop)) return;
  buddy.style.left = `${Math.max(5, Math.min(buddyLeft, window.innerWidth - 85))}px`;
  buddy.style.top = `${Math.max(5, Math.min(buddyTop, window.innerHeight - 85))}px`;
  const bubble = document.getElementById('st-bubble');
  if (bubble && bubble.style.top) {
    const bubbleTop = parseInt(bubble.style.top);
    if (!isNaN(bubbleTop)) {
      bubble.style.top = `${Math.max(5, bubbleTop)}px`;
    }
  }
});
